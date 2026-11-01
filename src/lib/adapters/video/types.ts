/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: VideoAdapter, VideoGenerateArgs, VideoStartResult,
 *   VideoPollResult, VideoError, VIDEO_FETCH_ERRORS, VideoFetchError,
 *   VIDEO_PROVIDER_IDS, VideoProviderId, START_AND_POLL_NOT_GENERATE,
 *   MODEL_VERSION_IS_RETURNED_NOT_ASSUMED, PROMPT_IS_ALREADY_MODERATED,
 *   A_URL_NOT_BYTES, NOT_CONFIGURED_IS_A_CASE
 *
 * WHAT:  The contract for turning one prompt into one video clip.
 *
 * WHY:   START_AND_POLL_NOT_GENERATE, and this is the one place the video seam
 *        differs in shape from its sibling `ImageAdapter`. An image model
 *        answers in seconds and `generate()` can wait; a video model takes
 *        minutes, so a single awaited call would have to hold a request open
 *        for the whole generation. The phase file says it outright — "poll in
 *        SEPARATE STEPS with sleeps between; polling inside one step times
 *        out" — and the two-method shape is what makes that possible: each
 *        poll is its own durable step, and the waiting happens between them
 *        where a worker is not blocked.
 *
 *        It is the same split `RenderAdapter` makes (`start` + `getProgress`)
 *        and for the same reason, which is worth noticing: the two slowest
 *        operations in the product both outlive a request, and both are
 *        modelled as "hand it over, then ask".
 *
 *        A_URL_NOT_BYTES. A finished poll returns a URL rather than a buffer.
 *        A clip is tens of megabytes; carrying it through a workflow step
 *        would mean holding it in memory and serialising it into the step's
 *        result on every replay. The caller streams it from the URL into
 *        storage, exactly as the library ingest does with a remote source.
 *
 *        MODEL_VERSION_IS_RETURNED_NOT_ASSUMED, as in the image seam. The
 *        version comes back from the provider rather than from our config,
 *        because a provider resolves an alias, rolls a model forward or serves
 *        a snapshot — and the audit column means "which model made this", not
 *        "which model did we ask for". The phase's step 4 requires it on the
 *        asset.
 *
 *        PROMPT_IS_ALREADY_MODERATED. This seam does NOT classify its prompt.
 *        The phase's step 3 requires moderation before the model call and
 *        requires it to FAIL CLOSED; that happens in the caller, through the
 *        existing moderation seam, for the same reason the image and TTS seams
 *        leave it there — a decision that has to be RECORDED belongs with the
 *        service that owns the record, and an adapter that quietly classified
 *        would be a second, unrecorded safety decision.
 *
 *        NOT_CONFIGURED_IS_A_CASE, not an error. A deployment with no video
 *        credential is normal and the screen says so; callers read
 *        `configured` rather than catching an exception per attempt.
 * WHERE: Implemented by ./replicate. Reached through getVideoAdapter() in
 *        ./index. Called ONLY from src/inngest/functions/footage-generate.ts —
 *        never from a router, because starting a generation is the most
 *        expensive action in the product and the gates that authorise it live
 *        in the procedure layer.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: VIDEO_FETCH_ERRORS, VideoFetchError,
 *   REFUSED_IS_NOT_FAILED
 *
 * Why a generation did not produce a clip. The set mirrors the image seam's,
 * with one addition that matters for video: `refused`.
 *
 * REFUSED_IS_NOT_FAILED. Video providers run their own safety classifier and
 * decline prompts ours allowed — a likeness, a trademark, something they read
 * differently. That is not an outage and not our bug: it is a decision the
 * CUSTOMER can act on by rewording, and it must not be retried, because the
 * answer will be the same and each attempt may be billed. Collapsing it into
 * `failed` would produce three identical refusals and a support ticket.
 */
export const VIDEO_FETCH_ERRORS = [
  /** The credential is wrong or absent. */
  "unauthorized",
  /** The provider is rate limiting us. Worth retrying. */
  "rate_limited",
  /** The provider is down or timed out. Worth retrying. */
  "unavailable",
  /** The provider declined the prompt. NOT worth retrying — see above. */
  "refused",
  /** The generation ran and failed, or returned something unusable. */
  "failed",
] as const;

export type VideoFetchError = (typeof VIDEO_FETCH_ERRORS)[number];

export class VideoError extends Error {
  readonly reason: VideoFetchError;
  readonly detail: string;

  constructor(reason: VideoFetchError, message: string, detail = "") {
    super(message);
    this.name = "VideoError";
    this.reason = reason;
    this.detail = detail;
  }

  /** Whether waiting and asking again could plausibly give a different answer. */
  get transient(): boolean {
    return this.reason === "rate_limited" || this.reason === "unavailable";
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: VideoGenerateArgs, ASPECT_IS_NOT_A_SUGGESTION,
 *   DURATION_IS_WHAT_IS_BILLED
 *
 * WHAT:  What to generate.
 *
 * WHY:   ASPECT_IS_NOT_A_SUGGESTION, as in the image seam: this product makes
 *        vertical short-form video, so a provider that cannot produce the
 *        requested shape must fail rather than return something that will be
 *        letterboxed into a phone frame.
 *
 *        DURATION_IS_WHAT_IS_BILLED, by us and by the provider, which is why
 *        it is required and why the caller holds credits against it before
 *        this is called. A provider that only offers fixed lengths rounds UP
 *        to one it supports and says so in the result, so the customer is
 *        never charged for less than they receive.
 * WHERE: The single argument of VideoAdapter.start.
 */
export interface VideoGenerateArgs {
  /** Already moderated — see PROMPT_IS_ALREADY_MODERATED. */
  prompt: string;
  durationSec: number;
  /** One value today, and required so a widening is a compile error. */
  aspect: "9:16";
}

/**
 * SOURCE OF TRUTH KEYWORDS: VideoStartResult, THE_JOB_ID_IS_THE_PROVIDERS
 *
 * What the provider gives back the instant it accepts the work. The id is
 * THEIRS and is stored on our row, which is what lets a replayed workflow step
 * ask about a generation it already started rather than paying for a second
 * one.
 */
export interface VideoStartResult {
  jobId: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: VideoPollResult, STATUS_IS_OUR_VOCABULARY,
 *   A_URL_NOT_BYTES
 *
 * WHAT:  Where one generation has got to.
 *
 * WHY:   STATUS_IS_OUR_VOCABULARY — three states, not the provider's twelve.
 *        A provider reporting `starting`, `booting`, `processing` and
 *        `succeeded` collapses them inside its own folder, which is the whole
 *        value of the seam: the workflow branches on three cases and a
 *        provider swap cannot add a fourth.
 *
 *        `url` and `modelVersion` are present only on `completed`, and are
 *        nullable rather than absent so the shape does not change between
 *        polls — a workflow step's result crosses a JSON boundary, and a
 *        field that appears halfway through is a field somebody reads as
 *        undefined on a replay.
 */
export interface VideoPollResult {
  status: "pending" | "completed" | "failed";
  /** Where the finished clip is. Null until `completed`. See A_URL_NOT_BYTES. */
  url: string | null;
  /** What the provider says it served. Null until `completed`. */
  modelVersion: string | null;
  /** The seconds actually produced, which may exceed what was asked for. */
  durationSec: number | null;
  /** Readable reason, on `failed` only. */
  error: string | null;
}

export interface VideoAdapter {
  readonly id: VideoProviderId;

  /**
   * Whether this deployment can generate at all. False when the credential is
   * absent, which is a NORMAL state — see NOT_CONFIGURED_IS_A_CASE.
   */
  readonly configured: boolean;

  /**
   * Hands the prompt over and returns as soon as it is accepted. Does NOT wait
   * for the clip — see START_AND_POLL_NOT_GENERATE. Throws `VideoError`.
   */
  start(args: VideoGenerateArgs): Promise<VideoStartResult>;

  /** Where one already-started generation has got to. Throws `VideoError`. */
  poll(jobId: string): Promise<VideoPollResult>;
}

/**
 * SOURCE OF TRUTH KEYWORDS: VIDEO_PROVIDER_IDS, VideoProviderId
 *
 * The providers this product knows how to talk to. One today; the phase file
 * names two candidates ("ship fal.ai or Replicate") and the seam is what makes
 * the second a folder rather than a rewrite.
 */
export const VIDEO_PROVIDER_IDS = ["replicate"] as const;

export type VideoProviderId = (typeof VIDEO_PROVIDER_IDS)[number];
