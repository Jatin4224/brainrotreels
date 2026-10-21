/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: elevenLabsTtsAdapter, BACKUP_MODEL_INSIDE_THE_ADAPTER,
 *   PROVIDER_ISOLATION, PERMANENT_VS_TRANSIENT_FAILURE, NO_VOICE_CLONING,
 *   RAW_REST_NOT_AN_SDK
 *
 * WHAT:  The ElevenLabs implementation of TtsAdapter.
 *
 * WHY:   BACKUP_MODEL_INSIDE_THE_ADAPTER, the phase's step 1. A failure
 *        attributable to the MODEL — a 5xx from the synthesis endpoint, a
 *        model that is overloaded or has been retired — retries once on the
 *        backup model before throwing. Not every failure: a bad voice id, a
 *        bad key and an exhausted quota all fail identically on the backup, so
 *        retrying those is a second wasted call and a doubled bill on the one
 *        that costs money.
 *
 *        RAW_REST_NOT_AN_SDK. This talks to the REST API with `fetch` rather
 *        than pulling the vendor SDK. The surface used here is two endpoints
 *        and the SDK's value is mostly in the streaming and voice-management
 *        APIs this contract deliberately does not expose — so the dependency
 *        would be carried for types we already have. It also keeps the bundle
 *        out of a worker that may never synthesise anything.
 *
 *        The consequence is that the eslint fence cannot be an import
 *        restriction, because there is no import to restrict. It is a fence on
 *        the CREDENTIAL instead: reading `ELEVENLABS_API_KEY` outside this
 *        folder is a lint error, which is the thing actually worth confining.
 *
 *        NO_VOICE_CLONING: this file calls exactly two endpoints — synthesis
 *        and the voice list. There is no code path here that creates, clones
 *        or uploads a voice, and none should be added.
 * WHERE: Loaded by ../index.ts through a dynamic import.
 */

import "server-only";

import {
  TtsError,
  type TtsAdapter,
  type TtsCatalogueVoice,
  type TtsResult,
  type TtsSynthesizeArgs,
} from "../types";
import {
  ELEVENLABS_API_BASE,
  elevenLabsConfig,
  type ElevenLabsConfig,
} from "./config";

/**
 * SOURCE OF TRUTH KEYWORDS: SYNTHESIS_TIMEOUT_MS
 *
 * A line is a sentence or two, so a synthesis that has not returned in ninety
 * seconds is not slow, it is stuck. Long enough to survive a cold model, short
 * enough that a wedged request does not hold a workflow step to its own
 * five-minute ceiling.
 */
const SYNTHESIS_TIMEOUT_MS = 90_000;

/** The catalogue is one small JSON response; it has no excuse to be slow. */
const CATALOGUE_TIMEOUT_MS = 30_000;

export const elevenLabsTtsAdapter: TtsAdapter = {
  id: "elevenlabs",

  async synthesize(args: TtsSynthesizeArgs): Promise<TtsResult> {
    const config = elevenLabsConfig();

    const text = args.text.trim();
    if (text.length === 0) {
      /* Permanent and cheap to catch here: an empty line is a bug upstream in
       * the splitter, and sending it would bill a request for silence. */
      throw new TtsError("There is nothing to say on that line.", {
        detail: "[tts/elevenlabs] refused an empty line",
        permanent: true,
      });
    }

    try {
      return await callSynthesis(config, config.model, args.voiceId, text);
    } catch (error) {
      const primaryFailure = error instanceof TtsError ? error : null;

      /* BACKUP_MODEL_INSIDE_THE_ADAPTER — only for failures the backup could
       * plausibly survive. A permanent failure (bad voice, bad key, quota)
       * fails identically on the backup, so retrying is a wasted call and, on
       * the quota case, a doubled bill. */
      const worthRetrying =
        primaryFailure !== null &&
        !primaryFailure.permanent &&
        !primaryFailure.quotaExceeded &&
        config.backupModel !== config.model;

      if (!worthRetrying) throw error;

      console.warn(
        `[tts/elevenlabs] ${config.model} failed, trying ${config.backupModel}: ${primaryFailure.detail}`,
      );

      try {
        return await callSynthesis(
          config,
          config.backupModel,
          args.voiceId,
          text,
        );
      } catch (backupError) {
        /* Both models failed. Surfaced as the BACKUP's error, with the
         * primary's detail attached — an operator reading this needs to know
         * the fallback ran and also failed, not just that something did. */
        const detail =
          backupError instanceof TtsError ? backupError.detail : String(backupError);
        throw new TtsError(
          "That line could not be recorded. Please try again shortly.",
          {
            detail: `[tts/elevenlabs] both models failed. primary: ${primaryFailure.detail} | backup: ${detail}`,
            permanent: false,
          },
        );
      }
    }
  },

  async listCatalogue(): Promise<TtsCatalogueVoice[]> {
    const config = elevenLabsConfig();

    const response = await request(
      `${ELEVENLABS_API_BASE}/voices`,
      { method: "GET", headers: { "xi-api-key": config.apiKey } },
      CATALOGUE_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw await toTtsError(response, "listing voices");
    }

    const body: unknown = await response.json();
    const voices = isRecord(body) && Array.isArray(body["voices"]) ? body["voices"] : [];

    const catalogue: TtsCatalogueVoice[] = [];
    for (const entry of voices) {
      if (!isRecord(entry)) continue;

      const providerVoiceId = entry["voice_id"];
      const name = entry["name"];
      if (typeof providerVoiceId !== "string" || typeof name !== "string") {
        continue;
      }

      /* Labels are whatever the provider says — raw strings, mapped onto this
       * app's enums by the service. See CATALOGUE_SYNC on TtsCatalogueVoice. */
      const rawLabels = entry["labels"];
      const labels: Record<string, string> = {};
      if (isRecord(rawLabels)) {
        for (const [key, value] of Object.entries(rawLabels)) {
          if (typeof value === "string") labels[key] = value;
        }
      }

      const previewUrl = entry["preview_url"];

      catalogue.push({
        providerVoiceId,
        name,
        labels,
        ...(typeof previewUrl === "string" && previewUrl.length > 0
          ? { previewUrl }
          : {}),
      });
    }

    return catalogue;
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: callSynthesis, DURATION_IS_MEASURED_NOT_CLAIMED
 *
 * WHAT:  One synthesis request against one model.
 * WHY:   Extracted so the primary and the backup are provably the same call
 *        with a different model id — a copy-pasted second request is how the
 *        fallback ends up using different settings and sounding different.
 *
 *        The returned `durationSec` is ESTIMATED from the audio size, and the
 *        estimate is deliberately crude because it is thrown away: the caller
 *        measures the real duration with ffmpeg after loudness normalisation
 *        (DURATION_IS_MEASURED_NOT_CLAIMED). It exists so a progress display
 *        has something before the measurement runs.
 * WHERE: Both branches of synthesize.
 */
async function callSynthesis(
  config: ElevenLabsConfig,
  model: string,
  voiceId: string,
  text: string,
): Promise<TtsResult> {
  const response = await request(
    `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: model,
        /* Left at the provider's defaults deliberately. Tuning stability and
         * similarity per line is a quality knob with no measurement behind it
         * yet, and a setting that varies per call makes two takes of the same
         * line sound different — which the textHash cache then hides. */
        output_format: config.outputFormat,
      }),
    },
    SYNTHESIS_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw await toTtsError(response, `synthesis on ${model}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());

  if (audio.byteLength === 0) {
    throw new TtsError("That line came back silent. Please try again.", {
      detail: `[tts/elevenlabs] ${model} returned an empty body`,
      permanent: false,
    });
  }

  return {
    audio,
    durationSec: estimateMp3Seconds(audio.byteLength, config.bitrateKbps),
    contentType: "audio/mpeg",
    modelUsed: model,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: toTtsError, PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  Classifies an HTTP failure as permanent, transient or a quota wall.
 * WHY:   Branches on STATUS, not on message text, which is the provider's to
 *        change. The classification decides whether a customer waits:
 *
 *          401/403  the key is wrong or revoked — every line fails the same
 *          404      the voice id does not exist — the catalogue is stale
 *          422      the request is malformed — the text or settings are wrong
 *          429      rate limited, or OUT OF CHARACTERS. The body distinguishes
 *                   them, and the difference matters: one clears by waiting,
 *                   the other needs an operator to top up the account.
 *          5xx      the model or the service — worth the backup, then a retry
 *
 *        The default is TRANSIENT here, unlike the LLM adapter where it is
 *        permanent. The asymmetry is deliberate: a TTS failure costs one line
 *        of a script that is otherwise fine and the retry is cheap, whereas a
 *        failed script generation wastes a long, expensive call.
 * WHERE: Both endpoints above.
 */
async function toTtsError(response: Response, what: string): Promise<TtsError> {
  const body = await response.text().catch(() => "");
  const detail = `[tts/elevenlabs] ${what} failed: ${response.status} ${response.statusText} ${body.slice(0, 300)}`;

  if (response.status === 401 || response.status === 403) {
    return new TtsError(
      "Narration is not configured. Please contact support.",
      { detail, permanent: true },
    );
  }

  if (response.status === 404) {
    return new TtsError(
      "That voice is no longer available. Pick another one.",
      { detail, permanent: true },
    );
  }

  if (response.status === 422 || response.status === 400) {
    return new TtsError("That line could not be recorded as written.", {
      detail,
      permanent: true,
    });
  }

  if (response.status === 429) {
    /* A rate limit clears by waiting; an exhausted character quota does not,
     * and sending every remaining line at it is a long sequence of identical
     * failures. The body is the only thing that tells them apart. */
    const quota = /quota|character.?limit|exceeded/i.test(body);
    return new TtsError(
      quota
        ? "The narration service is out of capacity. Please contact support."
        : "The narration service is busy. This will be retried automatically.",
      { detail, permanent: quota, quotaExceeded: quota },
    );
  }

  return new TtsError(
    "That line could not be recorded. This will be retried automatically.",
    { detail, permanent: false },
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: request, TIMEOUT_IS_NOT_OPTIONAL
 *
 * WHAT:  A fetch with a hard timeout.
 * WHY:   TIMEOUT_IS_NOT_OPTIONAL. `fetch` has no default timeout, so a wedged
 *        connection holds a workflow step until the step's own ceiling — at
 *        which point the step retries and wedges again. An explicit abort
 *        turns that into one clean, classifiable failure.
 * WHERE: Both endpoints above.
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
      throw new TtsError(
        "The narration service took too long. This will be retried automatically.",
        {
          detail: `[tts/elevenlabs] timed out after ${timeoutMs}ms`,
          permanent: false,
        },
      );
    }
    throw new TtsError(
      "The narration service could not be reached. This will be retried automatically.",
      {
        detail: `[tts/elevenlabs] ${error instanceof Error ? error.message : String(error)}`,
        permanent: false,
      },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: estimateMp3Seconds, DURATION_IS_MEASURED_NOT_CLAIMED
 *
 * WHAT:  A rough duration from the file size and the bitrate.
 * WHY:   Only valid for CONSTANT-bitrate MP3, which is what the configured
 *        output format requests — and it is wrong by a little even then,
 *        because of the ID3 header. That is acceptable precisely because this
 *        number is not stored: the caller measures the real one with ffmpeg.
 *        It exists so something can be shown while that measurement runs.
 * WHERE: callSynthesis.
 */
function estimateMp3Seconds(bytes: number, bitrateKbps: number): number {
  const bytesPerSecond = (bitrateKbps * 1000) / 8;
  if (bytesPerSecond <= 0) return 0;
  return Math.round((bytes / bytesPerSecond) * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
