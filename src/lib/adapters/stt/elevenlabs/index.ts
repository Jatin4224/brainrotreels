/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: elevenLabsSttAdapter, SCRIBE, PROVIDER_ISOLATION,
 *   RAW_REST_NOT_AN_SDK, WORDS_ONLY_NO_SPACING, PERMANENT_VS_TRANSIENT_FAILURE,
 *   TRANSCRIPT_IS_NOT_THE_SCRIPT
 *
 * WHAT:  The ElevenLabs Scribe implementation of SttAdapter.
 *
 * WHY:   RAW_REST_NOT_AN_SDK, the same decision as the TTS adapter next door
 *        and for the same reasons: one endpoint, no SDK dependency carried
 *        into a worker that may never align anything, and a fence on the
 *        CREDENTIAL rather than on an import.
 *
 *        THE AUDIO IS FETCHED HERE AND POSTED AS A FILE, rather than handed
 *        to the provider as a URL. The provider's URL ingest only accepts
 *        certain cloud-storage forms, and this app's audio lives behind a
 *        signed URL from whichever storage adapter is selected — so passing
 *        the URL would make the alignment work or fail depending on the
 *        storage provider, which is precisely the coupling the seams exist
 *        to prevent. A narration line is seconds of mp3; the download is
 *        cheap and the behaviour is identical everywhere.
 *
 *        WORDS_ONLY_NO_SPACING. Scribe returns `spacing` and `audio_event`
 *        entries interleaved with the words. They are dropped: a caption
 *        built from them would show an empty card for every pause and a card
 *        reading "(laughter)" for every sound the model recognised. Only
 *        `word` entries are timing evidence.
 *
 *        TRANSCRIPT_IS_NOT_THE_SCRIPT — what comes back here is what the
 *        model heard. It is matched to the customer's own text by
 *        `reconcileToScript`, outside this adapter, and must never be stored
 *        as the script.
 * WHERE: Loaded by ../index.ts through a dynamic import.
 */

import "server-only";

import type { HeardWord } from "@/lib/alignment";
import { SttError, type SttAdapter, type SttAlignArgs } from "../types";
import { ELEVENLABS_API_BASE, scribeConfig, type ScribeConfig } from "./config";

/**
 * SOURCE OF TRUTH KEYWORDS: ALIGNMENT_TIMEOUT_MS
 *
 * A narration line is a sentence or two, so an alignment that has not
 * returned in two minutes is stuck rather than slow. Longer than the TTS
 * timeout because transcription is billed per minute of audio and the model
 * genuinely takes longer on a long line; short enough that a wedged request
 * does not hold a workflow step to its own ceiling.
 */
const ALIGNMENT_TIMEOUT_MS = 120_000;

/** Downloading the line's own audio from storage. It is seconds of mp3. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

export const elevenLabsSttAdapter: SttAdapter = {
  id: "elevenlabs",

  async align(args: SttAlignArgs): Promise<HeardWord[]> {
    const config = scribeConfig();

    const audio = await downloadAudio(args.audioUrl);

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)]), "line.mp3");
    form.append("model_id", config.model);
    /* Word-level timings are the entire reason this call exists. */
    form.append("timestamps_granularity", "word");
    /* Diarisation is off deliberately — the speaker is known from the
     * narration line (NO DIARISATION IN THE CONTRACT on SttAdapter), and
     * asking for it is a slower, pricier call for a worse answer. */
    form.append("diarize", "false");

    const response = await request(
      `${ELEVENLABS_API_BASE}/speech-to-text`,
      {
        method: "POST",
        headers: { "xi-api-key": config.apiKey },
        body: form,
      },
      ALIGNMENT_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw await toSttError(response, "alignment");
    }

    const body: unknown = await response.json();
    return readWords(body, config);
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: readWords, WORDS_ONLY_NO_SPACING
 *
 * WHAT:  The `word` entries of a Scribe response, in order.
 * WHY:   Every field is checked rather than cast. A response that changed
 *        shape would otherwise produce `NaN` timings, which flow all the way
 *        into the document and come out as captions that never appear — a
 *        failure with no error anywhere near its cause.
 *
 *        An EMPTY word list is not thrown on. Silence, or audio the model
 *        could not read, legitimately transcribes to nothing, and the caller
 *        degrades that line rather than failing the narration.
 * WHERE: align.
 */
function readWords(body: unknown, config: ScribeConfig): HeardWord[] {
  if (!isRecord(body) || !Array.isArray(body["words"])) {
    throw new SttError(
      "The captions could not be timed. This will be retried automatically.",
      {
        detail: `[stt/elevenlabs] ${config.model} returned no word list`,
        permanent: false,
      },
    );
  }

  const words: HeardWord[] = [];
  for (const entry of body["words"]) {
    if (!isRecord(entry)) continue;
    if (entry["type"] !== undefined && entry["type"] !== "word") continue;

    const text = entry["text"];
    const start = entry["start"];
    const end = entry["end"];
    if (
      typeof text !== "string" ||
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isFinite(start) ||
      !Number.isFinite(end)
    ) {
      continue;
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) continue;

    words.push({ w: trimmed, s: start, e: Math.max(end, start) });
  }

  return words;
}

/**
 * SOURCE OF TRUTH KEYWORDS: downloadAudio
 *
 * WHAT:  The line's audio bytes from its signed URL.
 * WHY:   A failure here is TRANSIENT and reported as an STT failure rather
 *        than thrown raw, so the one caller has a single error type to
 *        classify. An expired signed URL is the realistic case and it is
 *        genuinely retryable — the workflow signs a fresh one on the retry.
 * WHERE: align.
 */
async function downloadAudio(url: string): Promise<ArrayBuffer> {
  const response = await request(url, { method: "GET" }, DOWNLOAD_TIMEOUT_MS);

  if (!response.ok) {
    throw new SttError(
      "The narration audio could not be read. This will be retried automatically.",
      {
        detail: `[stt/elevenlabs] download failed: ${response.status} ${response.statusText}`,
        permanent: false,
      },
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new SttError("That line's audio is empty.", {
      detail: "[stt/elevenlabs] the signed URL returned zero bytes",
      permanent: true,
    });
  }
  return buffer;
}

/**
 * SOURCE OF TRUTH KEYWORDS: toSttError, PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  Classifies an HTTP failure as permanent, transient or a quota wall.
 * WHY:   Branches on STATUS, not on message text, which is the provider's to
 *        change:
 *
 *          401/403  the key is wrong or revoked — every line fails the same
 *          404      the model id does not exist — a retired model
 *          422/400  the audio or the parameters are unusable
 *          429      rate limited, or OUT OF MINUTES. The body distinguishes
 *                   them; one clears by waiting, the other needs an operator
 *          5xx      the service — worth a retry
 *
 *        The default is TRANSIENT, like the TTS seam: the downside of a retry
 *        is one extra call, and the downside of giving up early is a
 *        degraded alignment on a provider that was merely having a moment.
 * WHERE: align.
 */
async function toSttError(response: Response, what: string): Promise<SttError> {
  const body = await response.text().catch(() => "");
  const detail = `[stt/elevenlabs] ${what} failed: ${response.status} ${response.statusText} ${body.slice(0, 300)}`;

  if (response.status === 401 || response.status === 403) {
    return new SttError(
      "Caption timing is not configured. Please contact support.",
      { detail, permanent: true },
    );
  }

  if (response.status === 404) {
    return new SttError(
      "The caption timing service is unavailable. Please contact support.",
      { detail, permanent: true },
    );
  }

  if (response.status === 400 || response.status === 422) {
    return new SttError("That line's audio could not be timed.", {
      detail,
      permanent: true,
    });
  }

  if (response.status === 429) {
    const quota = /quota|limit|exceeded/i.test(body);
    return new SttError(
      quota
        ? "The caption timing service is out of capacity. Please contact support."
        : "The caption timing service is busy. This will be retried automatically.",
      { detail, permanent: quota, quotaExceeded: quota },
    );
  }

  return new SttError(
    "The captions could not be timed. This will be retried automatically.",
    { detail, permanent: false },
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: request, TIMEOUT_IS_NOT_OPTIONAL
 *
 * WHAT:  A fetch with a hard timeout.
 * WHY:   TIMEOUT_IS_NOT_OPTIONAL — `fetch` has no default timeout, so a
 *        wedged connection holds a workflow step until the step's own
 *        ceiling, at which point the step retries and wedges again. An
 *        explicit abort turns that into one clean, classifiable failure.
 * WHERE: Both requests above.
 */
async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SttError(
        "The caption timing service took too long. This will be retried automatically.",
        {
          detail: `[stt/elevenlabs] timed out after ${timeoutMs}ms`,
          permanent: false,
        },
      );
    }
    throw new SttError(
      "The caption timing service could not be reached. This will be retried automatically.",
      {
        detail: `[stt/elevenlabs] ${error instanceof Error ? error.message : String(error)}`,
        permanent: false,
      },
    );
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
