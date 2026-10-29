/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: StockAdapter, StockResult, StockError,
 *   STOCK_FETCH_ERRORS, StockFetchError, STOCK_PROVIDER_IDS, StockProviderId,
 *   SEARCH_IS_ONE_METHOD, LICENCE_IS_NEVER_INFERRED, PORTRAIT_IS_NOT_A_FILTER,
 *   EMPTY_IS_NOT_A_FAILURE
 *
 * WHAT:  The contract for turning a short search query into stock clips this
 *        product may legally use.
 *
 * WHY:   SEARCH_IS_ONE_METHOD, like every other seam here. A stock library has
 *        collections, curated feeds, photo search, user profiles and a dozen
 *        other endpoints, and this product asks it exactly one question: what
 *        portrait clips match these words. A richer interface would be surface
 *        nothing uses and a far larger terms-of-service footprint — the same
 *        argument `RedditAdapter.fetchThread` makes.
 *
 *        LICENCE_IS_NEVER_INFERRED, and it is the decision this seam exists
 *        around. Every result MUST carry the licence its provider states, as a
 *        required field, because the phase is explicit that "a stock clip whose
 *        provenance is unrecorded is unusable the moment anyone asks" — and a
 *        licence the adapter guessed, defaulted or left empty is worse than no
 *        clip at all. An implementation that cannot say what licence a result
 *        is under must not return it.
 *
 *        PORTRAIT_IS_NOT_A_FILTER, which is why `orientation` is a required
 *        option fixed at `'portrait'` rather than something a caller may omit.
 *        This product's output is 9:16; a landscape clip cropped to vertical
 *        loses two thirds of the frame and almost always the subject with it.
 *        The option is spelled out in the signature so a second caller cannot
 *        quietly ask for everything and get a wall of letterboxed footage, and
 *        it is an enum of ONE value so widening it is a deliberate edit here
 *        rather than an accident at a callsite.
 *
 *        EMPTY_IS_NOT_A_FAILURE. A search that matched nothing returns an empty
 *        array, never an error. The whole point of the phase's chain is that
 *        each step may come up empty and the next one takes over
 *        (FALLBACK_CHAIN_IS_THE_POINT in src/lib/types/visual.ts), so an
 *        implementation that threw on no results would turn "no clip for this
 *        paragraph" into a failed generation.
 *
 *        No client half, like the Reddit seam: a browser never searches a stock
 *        library, and an endpoint that let one would be an open proxy with our
 *        API key's shared quota behind it.
 * WHERE: Implemented by ./pexels. Reached through getStockAdapter() in
 *        ./index. Consumed by src/services/visuals.service.ts.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: StockResult, PROVENANCE_IS_NOT_OPTIONAL,
 *   TWO_URLS_NOT_ONE
 *
 * WHAT:  One clip, as this product uses it.
 *
 * WHY:   Exactly the fields a video and an audit need, and nothing more — no
 *        tags, no uploader id, no view counts. Every extra field is one more
 *        piece of somebody else's data we would be storing for no consumer.
 *
 *        TWO_URLS_NOT_ONE. `previewUrl` is a small file a browser shows in the
 *        swap grid; `downloadUrl` is the master the ingest pulls into our own
 *        bucket. One field would mean either ingesting a thumbnail or making a
 *        twelve-tile picker fetch a hundred megabytes.
 *
 *        `durationSec` is optional and that is honest rather than lazy: not
 *        every provider reports it, and the value decides whether a clip can be
 *        LOOPED to a block's length (LOOP_IS_A_MODULO). A caller must be able to
 *        see that it is missing rather than discovering it at render time — the
 *        same reasoning as `ResolvedBackgroundInput.durationSec`.
 * WHERE: Returned by `StockAdapter.search`.
 */
export interface StockResult {
  /** The provider's OWN id for this clip. Half of the provenance record. */
  providerId: string;
  previewUrl: string;
  downloadUrl: string;
  /** The licence NAME as the provider states it. Required — never inferred. */
  license: string;
  /**
   * Who to credit, where the licence asks for it.
   *
   * `| undefined` is written out on each of these rather than relying on `?`
   * alone, because `exactOptionalPropertyTypes` is on: without it, a value
   * parsed out of a zod `.optional()` — which is what the candidate schema in
   * src/lib/types/visual.ts produces — is not assignable here, and the honest
   * fix is for the contract to say that absent and undefined are the same
   * thing rather than for every caller to re-spread the object.
   */
  attribution?: string | undefined;
  durationSec?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: STOCK_FETCH_ERRORS, StockFetchError,
 *   NOT_CONFIGURED_IS_A_CASE
 *
 * WHAT:  Why a search could not be performed.
 *
 * WHY:   A closed union rather than a message, so the CALLER chooses the copy —
 *        the same decision as `REDDIT_FETCH_ERRORS`, and here there are only
 *        three cases that matter because a search has far less to go wrong than
 *        a thread fetch.
 *
 *        NOT_CONFIGURED_IS_A_CASE, and it is the one that earns the union. With
 *        no `STOCK_API_KEY` this seam is simply off, which the phase requires to
 *        be a complete and expected state — "with `STOCK_API_KEY` and the image
 *        model both unset, a video must still render end to end, just plainer".
 *        Collapsing it into `unavailable` would make an unconfigured deployment
 *        look like a provider outage in the logs, and the two need completely
 *        different responses from an operator.
 * WHERE: `StockError.reason`.
 */
export const STOCK_FETCH_ERRORS = [
  "not_configured",
  "rate_limited",
  "unavailable",
] as const;

export type StockFetchError = (typeof STOCK_FETCH_ERRORS)[number];

/**
 * SOURCE OF TRUTH KEYWORDS: StockError, PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  A search that could not be performed, carrying which case it was.
 *
 * WHY:   PERMANENT_VS_TRANSIENT_FAILURE, the same distinction every other
 *        adapter here draws and DERIVED from the reason rather than passed
 *        separately: an unconfigured key does not become configured on a retry
 *        and a rate limit clears. Deriving it means a new reason cannot be
 *        added without deciding which kind it is.
 *
 *        `detail` is for the operator and is never rendered — it carries the
 *        status code and the query, and the query is the customer's own words
 *        echoed back, which belongs in a log rather than in a refusal.
 * WHERE: Thrown by the adapter; caught in src/services/visuals.service.ts,
 *        which treats EVERY failure as "no candidates" and lets the chain move
 *        on (FALLBACK_CHAIN_IS_THE_POINT).
 */
export class StockError extends Error {
  readonly reason: StockFetchError;
  readonly detail: string;

  constructor(reason: StockFetchError, detail = "") {
    super(`[stock] ${reason}${detail.length > 0 ? `: ${detail}` : ""}`);
    this.name = "StockError";
    this.reason = reason;
    this.detail = detail;
  }

  /** Only a rate limit and an unrecognised answer can improve by waiting. */
  get transient(): boolean {
    return this.reason === "rate_limited" || this.reason === "unavailable";
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: StockSearchOptions, PORTRAIT_IS_NOT_A_FILTER
 *
 * WHAT:  How a search is narrowed.
 * WHY:   See PORTRAIT_IS_NOT_A_FILTER in the file header for why `orientation`
 *        is required and has one value. `minDurationSec` is optional because a
 *        caller that does not care must not have to pass a zero, and the
 *        product's own floor lives with the product (VISUAL_MIN_CLIP_SECONDS)
 *        rather than in the seam.
 * WHERE: The second argument of `search`.
 */
export interface StockSearchOptions {
  orientation: "portrait";
  minDurationSec?: number;
  /** How many results to ask for. The provider may return fewer. */
  limit?: number;
}

export interface StockAdapter {
  readonly id: StockProviderId;

  /**
   * Whether this deployment can search at all. False when the credential is
   * absent, which is a NORMAL state — see NOT_CONFIGURED_IS_A_CASE. Callers
   * check this rather than catching a `not_configured` error on every block of
   * every script, which would be an exception as control flow at scale.
   */
  readonly configured: boolean;

  /**
   * Best matches first, or an empty array. Throws `StockError` only when the
   * search could not be PERFORMED — never because it matched nothing
   * (EMPTY_IS_NOT_A_FAILURE).
   */
  search(query: string, opts: StockSearchOptions): Promise<StockResult[]>;
}

export const STOCK_PROVIDER_IDS = ["pexels"] as const;

export type StockProviderId = (typeof STOCK_PROVIDER_IDS)[number];
