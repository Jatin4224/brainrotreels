/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ImageAdapter, ImageGenerateResult, ImageError,
 *   IMAGE_FETCH_ERRORS, ImageFetchError, IMAGE_PROVIDER_IDS, ImageProviderId,
 *   GENERATE_IS_ONE_METHOD, MODEL_VERSION_IS_RETURNED_NOT_ASSUMED,
 *   CONTENT_TYPE_COMES_FROM_THE_PROVIDER, PROMPT_IS_ALREADY_MODERATED
 *
 * WHAT:  The contract for turning one image prompt into one still.
 *
 * WHY:   GENERATE_IS_ONE_METHOD, like every other seam here. No editing, no
 *        variations, no inpainting, no upscaling, no batch: this product asks
 *        an image model for a single vertical still and nothing else. Each of
 *        those extra verbs is where providers differ most, and "fill this
 *        prompt" is where they differ least — the same argument
 *        `LlmAdapter.generate` makes for keeping itself to one method.
 *
 *        MODEL_VERSION_IS_RETURNED_NOT_ASSUMED. The result carries the model
 *        version the provider actually served, and it is REQUIRED. The phase
 *        asks for it on the asset row for auditing, and the reason it comes
 *        back from the call rather than being read from config is that the two
 *        genuinely differ: a provider resolves an alias, rolls a model forward,
 *        or serves a snapshot. A version copied from our own env var is a
 *        record of what we asked for, which is not what the question "which
 *        model drew this" means.
 *
 *        CONTENT_TYPE_COMES_FROM_THE_PROVIDER, which is a widening of the
 *        phase's own contract and a deliberate one. The phase writes
 *        `Promise<{ image: Buffer; modelVersion: string }>`, and that is one
 *        field short of usable: the bytes become an `Asset` with a
 *        `contentType` and a storage key with an extension, and the only other
 *        way to get one is to sniff magic numbers — which is a second,
 *        worse copy of a fact the provider already stated.
 *
 *        PROMPT_IS_ALREADY_MODERATED. This seam does NOT classify its prompt.
 *        The phase's step 7 requires moderation before the model call, and that
 *        happens in the caller (src/services/visuals.service.ts) through the
 *        existing moderation seam, for the same reason the TTS seam does not
 *        moderate its text: a decision that has to be RECORDED belongs with the
 *        service that owns the record, and an adapter that silently classified
 *        would be a second, unrecorded safety decision. An adapter must not be
 *        callable in a way that skips it, which is what keeps that check in one
 *        place rather than two.
 *
 *        No client half: a browser never calls an image model, and an endpoint
 *        that let one would be an open proxy with a per-image bill attached.
 * WHERE: Implemented by ./openai. Reached through getImageAdapter() in
 *        ./index. Consumed by src/services/visuals.service.ts.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: ImageGenerateResult,
 *   MODEL_VERSION_IS_RETURNED_NOT_ASSUMED
 *
 * WHAT:  One generated still, and what made it.
 * WHY:   See the file header. `image` is raw bytes rather than a URL, because a
 *        provider's hosted URL expires and the phase's step 5 requires the
 *        bytes to go through `asset.ingest` into our own bucket — "never
 *        reference a provider's hotlink from a timeline".
 * WHERE: Returned by `ImageAdapter.generate`.
 */
export interface ImageGenerateResult {
  image: Buffer;
  /** What the provider says it served. See the file header. */
  modelVersion: string;
  /** e.g. `image/png`. See CONTENT_TYPE_COMES_FROM_THE_PROVIDER. */
  contentType: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: IMAGE_FETCH_ERRORS, ImageFetchError,
 *   REFUSAL_IS_ITS_OWN_CASE, NOT_CONFIGURED_IS_A_CASE
 *
 * WHAT:  Why an image could not be generated.
 *
 * WHY:   Four cases, and two of them are worth naming rather than folding into
 *        "unavailable".
 *
 *        NOT_CONFIGURED_IS_A_CASE, as in the stock seam: with no credential
 *        this seam is simply off, which the phase requires to be a complete and
 *        expected state. An unconfigured deployment must not look like an
 *        outage in the logs.
 *
 *        REFUSAL_IS_ITS_OWN_CASE. An image model refusing a prompt is the one
 *        failure here the CUSTOMER can act on, and it is not the same as our
 *        own moderation refusing it: ours happens first, is recorded, and names
 *        a category (`moderateText`). A provider refusal is a second opinion
 *        from somebody else's policy, arriving after we already approved — so
 *        it gets its own value, the chain falls through to the backdrop, and
 *        the swap UI can say "the model would not draw this" rather than "image
 *        generation failed".
 * WHERE: `ImageError.reason`.
 */
export const IMAGE_FETCH_ERRORS = [
  "not_configured",
  "refused",
  "rate_limited",
  "unavailable",
] as const;

export type ImageFetchError = (typeof IMAGE_FETCH_ERRORS)[number];

/**
 * SOURCE OF TRUTH KEYWORDS: ImageError, PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  A generation that failed, carrying which case it was.
 * WHY:   PERMANENT_VS_TRANSIENT_FAILURE, DERIVED from the reason as in every
 *        other adapter here: a refused prompt and a missing key do not improve
 *        on a retry, and each attempt is BILLED. `message` is customer-facing
 *        and `detail` is for the operator — the same split `LlmError` draws,
 *        and for the same reason: a provider's internal message must not reach
 *        a screen by being the easiest thing to hand.
 * WHERE: Thrown by the adapter; caught in src/services/visuals.service.ts,
 *        which lets the chain move on (FALLBACK_CHAIN_IS_THE_POINT).
 */
export class ImageError extends Error {
  readonly reason: ImageFetchError;
  readonly detail: string;

  constructor(reason: ImageFetchError, message: string, detail = "") {
    super(message);
    this.name = "ImageError";
    this.reason = reason;
    this.detail = detail;
  }

  get transient(): boolean {
    return this.reason === "rate_limited" || this.reason === "unavailable";
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: ImageGenerateOptions, ASPECT_IS_NOT_A_SUGGESTION
 *
 * WHAT:  The shape to draw.
 * WHY:   ASPECT_IS_NOT_A_SUGGESTION. `aspect` is required and has ONE value,
 *        for the reason PORTRAIT_IS_NOT_A_FILTER gives in the stock seam: this
 *        product's output is 9:16, and a square still letterboxed into a
 *        vertical frame wastes half of it. Spelling it out in the signature
 *        means widening it is a deliberate edit here rather than an accident at
 *        a callsite.
 * WHERE: The second argument of `generate`.
 */
export interface ImageGenerateOptions {
  aspect: "9:16";
}

export interface ImageAdapter {
  readonly id: ImageProviderId;

  /**
   * Whether this deployment can generate at all. False when the credential is
   * absent, which is a NORMAL state — see NOT_CONFIGURED_IS_A_CASE. Callers
   * check this rather than catching an error per block, which would be an
   * exception as control flow at scale.
   */
  readonly configured: boolean;

  /** Throws `ImageError` for every documented failure. */
  generate(
    prompt: string,
    opts: ImageGenerateOptions,
  ): Promise<ImageGenerateResult>;
}

export const IMAGE_PROVIDER_IDS = ["openai"] as const;

export type ImageProviderId = (typeof IMAGE_PROVIDER_IDS)[number];
