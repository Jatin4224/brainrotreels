/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: elevenLabsConfig, isElevenLabsConfigured,
 *   ELEVENLABS_API_KEY, ELEVENLABS_MODEL, ELEVENLABS_BACKUP_MODEL,
 *   LAZY_CONFIG, BACKUP_MODEL_INSIDE_THE_ADAPTER, CREDENTIAL_IS_FENCED
 *
 * WHAT:  Everything the ElevenLabs adapter needs from the environment.
 *
 * WHY:   CREDENTIAL_IS_FENCED. This module is the ONLY place in the codebase
 *        allowed to read `ELEVENLABS_API_KEY`, and eslint enforces it. The
 *        usual provider fence is an import restriction, but this adapter talks
 *        to a REST API with `fetch` and has no SDK to restrict — so the fence
 *        is on the credential itself, which is the thing actually worth
 *        confining. A key read anywhere else is a key that can end up in a
 *        page bundle.
 *
 *        LAZY_CONFIG, matching the R2, Stripe and Anthropic clients: nothing
 *        throws at import. Narration is optional until somebody generates, and
 *        a module-scope throw would crash the setup checklist — the one screen
 *        whose job is to report which variables are missing.
 *
 *        BACKUP_MODEL_INSIDE_THE_ADAPTER: both models are configurable, and
 *        the backup defaults to a DIFFERENT family from the primary rather
 *        than a smaller version of it. A backup that shares the primary's
 *        failure mode is not a backup — if the multilingual model is having a
 *        bad hour, so is every variant of it, and the fallback buys one more
 *        failed call.
 * WHERE: ./index.ts, on every request.
 */

import { assertTtsProviderActive } from "../provider";

assertTtsProviderActive("elevenlabs");

export const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

/**
 * SOURCE OF TRUTH KEYWORDS: DEFAULT_MODEL, DEFAULT_BACKUP_MODEL
 *
 * The primary is the provider's quality-oriented multilingual model; the
 * backup is the faster turbo family. Different families on purpose — see
 * BACKUP_MODEL_INSIDE_THE_ADAPTER above. Both are overridable so an operator
 * can move off a model the provider retires without a deploy, which is a
 * thing TTS providers do on short notice.
 */
const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_BACKUP_MODEL = "eleven_turbo_v2_5";

/**
 * MP3 at 128kbps, 44.1kHz. Constant bitrate, because the duration estimate in
 * the adapter assumes it — and because the ingest pipeline normalises loudness
 * afterwards anyway, so a higher rate here is bytes spent on something that
 * gets re-encoded. The real duration is measured, not derived from this.
 */
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_BITRATE_KBPS = 128;

export interface ElevenLabsConfig {
  apiKey: string;
  model: string;
  backupModel: string;
  outputFormat: string;
  bitrateKbps: number;
}

export function isElevenLabsConfigured(): boolean {
  return Boolean(process.env["ELEVENLABS_API_KEY"]?.trim());
}

export function elevenLabsConfig(): ElevenLabsConfig {
  const apiKey = process.env["ELEVENLABS_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error(
      "[tts/elevenlabs] ELEVENLABS_API_KEY is not set. Narration is unavailable until it is configured.",
    );
  }

  const model = process.env["ELEVENLABS_MODEL"]?.trim() || DEFAULT_MODEL;
  const backupModel =
    process.env["ELEVENLABS_BACKUP_MODEL"]?.trim() || DEFAULT_BACKUP_MODEL;

  const outputFormat =
    process.env["ELEVENLABS_OUTPUT_FORMAT"]?.trim() || DEFAULT_OUTPUT_FORMAT;

  /* Derived from the format rather than configured separately, so the two
   * cannot disagree — a bitrate that does not match the format makes every
   * duration estimate wrong in the same direction. */
  const bitrateKbps = bitrateFromFormat(outputFormat);

  return { apiKey, model, backupModel, outputFormat, bitrateKbps };
}

/**
 * SOURCE OF TRUTH KEYWORDS: bitrateFromFormat
 *
 * WHAT:  The kbps implied by a provider output-format string.
 * WHY:   The format names encode it (`mp3_44100_128`), so parsing is more
 *        honest than a second setting that can drift. An unrecognised format
 *        falls back to the default rather than throwing: the estimate it feeds
 *        is discarded by the caller anyway (DURATION_IS_MEASURED_NOT_CLAIMED),
 *        so a wrong guess here costs nothing, while refusing to synthesise
 *        over it would block narration for a format that works fine.
 * WHERE: elevenLabsConfig.
 */
function bitrateFromFormat(format: string): number {
  const parsed = Number(format.split("_").pop());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BITRATE_KBPS;
}
