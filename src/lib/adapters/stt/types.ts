/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: SttAdapter, SttAlignArgs, SttError,
 *   STT_PROVIDER_IDS, SttProviderId, HeardWord, ALIGNMENT_IS_A_SINGLE_POINT,
 *   TRANSCRIPT_IS_NOT_THE_SCRIPT, PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  The contract for turning an audio file into word-level timings.
 *
 * WHY:   ALIGNMENT_IS_A_SINGLE_POINT OF FAILURE, which is the phase's own
 *        reason for insisting this seam be "genuinely provider-shaped". Word
 *        timings drive the captions AND every motion anchor in Phase 16 AND
 *        the Reddit card's reveal in Phase 12 — so the day this provider is
 *        slow, expensive or retired, a second one has to drop in without a
 *        caller changing. The interface is therefore ONE METHOD taking a URL
 *        and the text, and returning words: nothing in it is shaped like any
 *        particular vendor's response.
 *
 *        TRANSCRIPT_IS_NOT_THE_SCRIPT. This contract returns what the model
 *        HEARD — `HeardWord`, not `WordToken` — and it is a different type on
 *        purpose. A `WordToken` is a word IN THE DOCUMENT, indexed, spelled
 *        as the customer wrote it; a heard word is evidence about timing. The
 *        two being the same type is exactly how a transcript ends up stored
 *        as the script, with the model's spelling and no capitals, and
 *        nothing errors because the words are perfectly well-formed.
 *        `reconcileToScript` in src/lib/alignment/ is the one place the
 *        conversion happens.
 *
 *        `scriptText` is passed in even though the matching happens outside
 *        the adapter, because providers accept it as a BIAS — a hint that
 *        improves the transcript before any matching is needed. A provider
 *        that cannot use it ignores it, which costs nothing; not having it in
 *        the contract would mean changing every caller to add it later.
 *
 *        NO DIARISATION IN THE CONTRACT. Speaker attribution comes from the
 *        NARRATION LINE being aligned — this app already knows which speaker
 *        said which line, because it chose the voice and synthesised it.
 *        Asking a model to re-derive that from the audio is paying for a
 *        worse answer to a question that is already answered.
 * WHERE: Implemented by ./elevenlabs. Reached through getSttAdapter() in
 *        ./index. Called ONLY from the align workflow — never from a router,
 *        because an alignment is a provider round-trip with a bill attached
 *        and a tRPC mutation runs inside a 10-second transaction.
 */

import type { HeardWord } from "@/lib/alignment";

export type { HeardWord };

/**
 * SOURCE OF TRUTH KEYWORDS: SttAlignArgs
 *
 * WHAT:  One recording to align.
 * WHY:   A URL rather than a Buffer. The audio is already an Asset in object
 *        storage with a signing helper, so passing bytes would mean every
 *        caller downloads a file the adapter may be able to hand straight to
 *        the provider — and it would put a megabyte of audio into a workflow
 *        step's serialised arguments, which is the one thing step payloads
 *        must not hold.
 * WHERE: The single argument of SttAdapter.align.
 */
export interface SttAlignArgs {
  /** A signed, time-limited URL the provider or the adapter can read. */
  audioUrl: string;
  /** The text that was spoken, as a transcription bias. */
  scriptText: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: SttError, PERMANENT_VS_TRANSIENT_FAILURE,
 *   DEGRADE_NEVER_FAIL
 *
 * WHAT:  An alignment that failed, carrying whether a retry could help.
 * WHY:   The same distinction as every other seam here, with one difference
 *        that matters: a permanent STT failure does NOT fail the pipeline. It
 *        ends in an evenly distributed, degraded alignment and a video the
 *        customer can still watch (DEGRADE_NEVER_FAIL). So the flag decides
 *        whether to retry before degrading, not whether to give up — which is
 *        why a mis-classification here is cheap in one direction and merely
 *        slow in the other.
 * WHERE: Thrown by ./elevenlabs; caught in the align workflow.
 */
export class SttError extends Error {
  readonly detail: string;
  readonly permanent: boolean;
  readonly quotaExceeded: boolean;

  constructor(
    message: string,
    options: {
      detail?: string;
      permanent?: boolean;
      quotaExceeded?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "SttError";
    this.detail = options.detail ?? "";
    this.permanent = options.permanent ?? false;
    this.quotaExceeded = options.quotaExceeded ?? false;
  }
}

export interface SttAdapter {
  readonly id: SttProviderId;

  /**
   * Word-level timings for one recording, in the order they were spoken.
   *
   * Returns what was HEARD. The caller matches it back to the script — see
   * TRANSCRIPT_IS_NOT_THE_SCRIPT in the file header.
   */
  align(args: SttAlignArgs): Promise<HeardWord[]>;
}

export const STT_PROVIDER_IDS = ["elevenlabs"] as const;

export type SttProviderId = (typeof STT_PROVIDER_IDS)[number];
