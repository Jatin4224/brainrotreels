/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: TtsAdapter, TtsSynthesizeArgs, TtsResult,
 *   TTS_PROVIDER_IDS, TtsProviderId, TtsError, BACKUP_MODEL_INSIDE_THE_ADAPTER,
 *   DURATION_IS_MEASURED_NOT_CLAIMED, NO_VOICE_CLONING
 *
 * WHAT:  The contract for turning a line of text into spoken audio.
 *
 * WHY:   BACKUP_MODEL_INSIDE_THE_ADAPTER is the phase's own requirement and
 *        the reason the fallback is NOT a workflow concern: on a model
 *        failure the adapter tries its backup before failing, so a workflow
 *        step sees one call that either produced audio or did not. Putting the
 *        retry in the workflow instead would mean every future caller — the
 *        fan-out, `line.resynth`, Phase 12's dialogue — reimplements the same
 *        fallback, and the first one to forget produces a failed render on a
 *        transient model outage.
 *
 *        DURATION_IS_MEASURED_NOT_CLAIMED. The adapter returns the audio and
 *        a duration, but the caller OVERWRITES that duration with one measured
 *        by ffmpeg after loudness normalisation. The provider's figure is an
 *        estimate and the timeline positions every other element against these
 *        numbers — captions, cuts, the music bed — so an estimate here
 *        desynchronises the whole video by a growing amount. The field exists
 *        because it is free and useful for a progress estimate; it is not what
 *        gets stored. Grep the same keyword in the TTS workflow.
 *
 *        NO_VOICE_CLONING. `voiceId` is a LICENSED catalogue voice, never a
 *        clone. There is deliberately no `createVoice`, no `cloneVoice` and no
 *        audio-input parameter anywhere in this contract — the phase states it
 *        as a legal position, and a contract that cannot express cloning
 *        cannot accidentally grow it.
 *
 *        The interface is ONE METHOD. No streaming, no SSML, no voice
 *        management. Everything this product needs is "say this line in that
 *        voice", and a richer surface would be an abstraction over the part of
 *        TTS providers that differs most.
 * WHERE: Implemented by ./elevenlabs. Reached through getTtsAdapter() in
 *        ./index. Called ONLY from the TTS workflow steps — never from a
 *        router, because a synthesis is a provider round-trip with a bill
 *        attached and a mutation runs inside a 10-second transaction.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: TtsSynthesizeArgs
 *
 * WHAT:  One line to speak.
 * WHY:   `voiceId` is the PROVIDER's id, resolved from the catalogue by the
 *        caller — the adapter never reads the database. That is what keeps it
 *        swappable: a second provider has entirely different voice ids, and
 *        the mapping lives in the `Voice` row rather than in provider code.
 * WHERE: The single argument of TtsAdapter.synthesize.
 */
export interface TtsSynthesizeArgs {
  text: string;
  /** The PROVIDER's voice id, from `Voice.providerVoiceId`. */
  voiceId: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: TtsResult, DURATION_IS_MEASURED_NOT_CLAIMED
 *
 * WHAT:  The audio, and what the provider claims about it.
 * WHY:   `durationSec` is the PROVIDER's estimate and is explicitly not what
 *        the timeline uses — see the file header. `modelUsed` is carried so a
 *        fallback is visible in a log line rather than silent: a sudden run of
 *        backup-model audio is the signal that the primary is unhealthy, and
 *        without this field the only symptom is a change in how the narration
 *        sounds.
 * WHERE: Returned by synthesize; consumed by the TTS workflow.
 */
export interface TtsResult {
  audio: Buffer;
  /** The provider's estimate. Overwritten by a measured value. */
  durationSec: number;
  contentType: string;
  /** Which model produced this — the primary, or the backup. */
  modelUsed: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: TtsError, PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  A synthesis that failed, carrying whether a retry could help.
 * WHY:   The same distinction, for the same reason, as MediaProcessingError,
 *        RenderProviderError and LlmError. Here the stakes are per LINE: a
 *        permanent failure marks that line failed and leaves the rest of the
 *        narration intact, while a transient one is retried. Getting it
 *        backwards means either a whole script refusing to synthesise because
 *        of one blip, or four paid attempts at a line whose voice id no longer
 *        exists.
 *
 *        `quotaExceeded` is named separately because it is the one a CUSTOMER
 *        can act on — or rather, the one an operator must: the provider
 *        account is out of characters, and every line will fail identically
 *        until it is topped up. Reporting that as a generic failure sends
 *        somebody looking at the script.
 * WHERE: Thrown by ./elevenlabs; caught in the TTS workflow.
 */
export class TtsError extends Error {
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
    this.name = "TtsError";
    this.detail = options.detail ?? "";
    this.permanent = options.permanent ?? false;
    this.quotaExceeded = options.quotaExceeded ?? false;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: TtsCatalogueVoice, CATALOGUE_SYNC
 *
 * WHAT:  One voice as the PROVIDER describes it.
 * WHY:   CATALOGUE_SYNC. The operator's licensed library is pulled from the
 *        provider and mapped onto `Voice` rows — which is how the catalogue
 *        gets populated without a seed file and without anybody typing forty
 *        voice ids by hand (the phase forbids an agent-written seed, and the
 *        ids only exist in a real account anyway).
 *
 *        The labels are raw strings here, NOT this app's enums, because they
 *        are whatever the provider says. Mapping them onto `VOICE_ACCENTS` and
 *        friends is the service's job, and it has to be lossy — see
 *        `other` in that union.
 * WHERE: Returned by listCatalogue; consumed by voices.service.
 */
export interface TtsCatalogueVoice {
  providerVoiceId: string;
  name: string;
  /** Provider labels, verbatim. e.g. `{ gender: 'female', accent: 'british' }` */
  labels: Record<string, string>;
  /** A provider-hosted sample, if it offers one. */
  previewUrl?: string | undefined;
}

export interface TtsAdapter {
  readonly id: TtsProviderId;

  /**
   * Speaks one line. Falls back to the backup model on a model failure before
   * throwing — see BACKUP_MODEL_INSIDE_THE_ADAPTER.
   */
  synthesize(args: TtsSynthesizeArgs): Promise<TtsResult>;

  /**
   * The operator's licensed voices, for the catalogue sync. Separate from
   * synthesis because it is an ADMIN read — it runs from the portal, not from
   * a tenant's generation.
   */
  listCatalogue(): Promise<TtsCatalogueVoice[]>;
}

export const TTS_PROVIDER_IDS = ["elevenlabs"] as const;

export type TtsProviderId = (typeof TTS_PROVIDER_IDS)[number];
