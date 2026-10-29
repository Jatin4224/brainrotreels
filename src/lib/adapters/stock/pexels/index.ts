/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: pexelsStockAdapter, search, pickRendition,
 *   RESPONSE_SHAPE_IS_PARSED, ONE_RENDITION_IS_CHOSEN_HERE,
 *   RESPECT_THE_RATE_LIMIT, EMPTY_IS_NOT_A_FAILURE, NO_UNBOUNDED_PROVIDER_CALL
 *
 * WHAT:  The Pexels implementation of StockAdapter: a portrait video search,
 *        mapped to `StockResult` with its licence attached.
 *
 * WHY:   RESPONSE_SHAPE_IS_PARSED. The answer is parsed with a zod schema
 *        rather than indexed, exactly as the Reddit listing is: a chain like
 *        `json.videos[0].video_files[0].link` is three assumptions about
 *        somebody else's API in one expression, and when one of them changes
 *        the failure is a TypeError inside a workflow step rather than a
 *        readable refusal. Unknown fields pass through rather than failing the
 *        parse — refusing a search because the API grew a field would be an
 *        outage we chose.
 *
 *        ONE_RENDITION_IS_CHOSEN_HERE. A Pexels video carries several files at
 *        different sizes, and choosing between them is PROVIDER KNOWLEDGE: the
 *        shape of that array, what `quality` means and which file types play
 *        are facts about Pexels. So `pickRendition` lives in this folder, while
 *        choosing between WHOLE CLIPS lives in src/lib/visuals/select.ts, which
 *        is pure and testable with no key. Getting that boundary wrong is how a
 *        product rule ends up in a vendor folder.
 *
 *        The rendition is capped at the master's own height rather than always
 *        taking the biggest: the ingest transcodes to a 1080-wide vertical
 *        master anyway (VERTICAL_MASTER), so a 4K download is bandwidth and
 *        transcode time spent to throw pixels away.
 *
 *        EMPTY_IS_NOT_A_FAILURE — a search that matched nothing returns `[]`.
 *        See the contract's own note: the phase's chain depends on it.
 *
 *        RESPECT_THE_RATE_LIMIT. Pexels publishes an hourly quota in response
 *        headers, shared by every workspace on this deployment, and a low
 *        remaining count is logged so an operator sees the wall coming rather
 *        than discovering it in a customer's plain-looking video.
 *
 *        NO_UNBOUNDED_PROVIDER_CALL: one timeout, as in every other adapter. A
 *        search sits inside a workflow step that a customer is watching.
 * WHERE: Loaded by ../index.ts through a dynamic import.
 */

import "server-only";

import { z } from "zod";

import {
  StockError,
  type StockAdapter,
  type StockResult,
  type StockSearchOptions,
} from "../types";
import {
  PEXELS_API_BASE,
  PEXELS_LICENSE,
  isPexelsConfigured,
  pexelsConfig,
} from "./config";

/** A search is one request; the budget is a page load, not a job. */
const REQUEST_TIMEOUT_MS = 10_000;

/** What the ingest's vertical master is, so a larger download is waste. */
const TARGET_HEIGHT = 1_920;

/** Pexels caps `per_page` at 80; this product never wants near that. */
const DEFAULT_LIMIT = 12;

/**
 * SOURCE OF TRUTH KEYWORDS: videoFileSchema, pexelsVideoSchema,
 *   RESPONSE_SHAPE_IS_PARSED
 *
 * WHAT:  The two response shapes this adapter reads.
 * WHY:   Only the fields used, each `.optional()` where the API legitimately
 *        omits it. No `.strict()` — see RESPONSE_SHAPE_IS_PARSED in the header
 *        for why that is the opposite choice from the model-output schemas.
 */
const videoFileSchema = z.object({
  link: z.string().optional(),
  file_type: z.string().optional(),
  quality: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
});

const pexelsVideoSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  duration: z.number().nullish(),
  url: z.string().optional(),
  user: z.object({ name: z.string().optional() }).optional(),
  video_files: z.array(videoFileSchema).optional(),
  video_pictures: z
    .array(z.object({ picture: z.string().optional() }))
    .optional(),
});

const searchResponseSchema = z.object({
  videos: z.array(pexelsVideoSchema).optional(),
});

export const pexelsStockAdapter: StockAdapter = {
  id: "pexels",

  /* Read at module scope rather than per call: the key does not appear while
   * a process is running, and `configured` is checked on every block of every
   * script (NOT_CONFIGURED_IS_A_CASE). */
  configured: isPexelsConfigured(),

  async search(
    query: string,
    opts: StockSearchOptions,
  ): Promise<StockResult[]> {
    if (!isPexelsConfigured()) {
      throw new StockError("not_configured", "STOCK_API_KEY is not set");
    }

    const config = pexelsConfig();
    const limit = Math.max(1, Math.min(80, opts.limit ?? DEFAULT_LIMIT));

    const params = new URLSearchParams({
      query,
      orientation: opts.orientation,
      per_page: String(limit),
      /* `small` keeps the candidate renditions near the master's own size.
       * The field narrows the FILES offered, not the clips matched. */
      size: "medium",
    });

    const response = await withTimeout((signal) =>
      fetch(`${PEXELS_API_BASE}/videos/search?${params.toString()}`, {
        signal,
        headers: {
          authorization: config.apiKey,
          accept: "application/json",
        },
      }),
    );

    reportRateLimit(response);

    if (response.status === 429) {
      throw new StockError(
        "rate_limited",
        `${response.status} ${response.statusText}`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      /* A revoked or mistyped key. Not transient, and not something a customer
       * caused — it presents to them as plainer footage, which is why the
       * caller treats every stock failure as "no candidates". */
      throw new StockError(
        "not_configured",
        `${response.status} ${response.statusText} — the key was refused`,
      );
    }
    if (!response.ok) {
      throw new StockError(
        "unavailable",
        `${response.status} ${response.statusText}`,
      );
    }

    const parsed = searchResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new StockError(
        "unavailable",
        `search response did not parse: ${parsed.error.message}`,
      );
    }

    const minDuration = opts.minDurationSec ?? 0;
    const results: StockResult[] = [];

    for (const video of parsed.data.videos ?? []) {
      const rendition = pickRendition(video.video_files ?? []);
      /* A clip with no playable mp4 is not a clip we can use, and skipping it
       * is better than returning a candidate the ingest would fail on. */
      if (rendition === null) continue;

      const durationSec =
        typeof video.duration === "number" && video.duration > 0
          ? video.duration
          : undefined;
      if (durationSec !== undefined && durationSec < minDuration) continue;

      const providerId = video.id === undefined ? "" : String(video.id);
      if (providerId.length === 0) continue;

      const preview = video.video_pictures?.[0]?.picture;

      results.push({
        providerId,
        /* No poster frame is not a reason to drop a clip; the grid falls back
         * to the clip itself, and the ingest produces a real thumbnail. */
        previewUrl: preview ?? rendition.link,
        downloadUrl: rendition.link,
        /* LICENCE_IS_A_CONSTANT_NOT_A_GUESS — see ./config.ts. */
        license: PEXELS_LICENSE,
        ...(video.user?.name !== undefined && video.user.name.length > 0
          ? { attribution: `${video.user.name} on Pexels` }
          : {}),
        ...(durationSec !== undefined ? { durationSec } : {}),
        ...(rendition.width !== null ? { width: rendition.width } : {}),
        ...(rendition.height !== null ? { height: rendition.height } : {}),
      });
    }

    return results;
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: pickRendition, ONE_RENDITION_IS_CHOSEN_HERE
 *
 * WHAT:  The file to download for one clip: the tallest playable mp4 that is
 *        not larger than the master the ingest will build.
 *
 * WHY:   Three rules, each with a cost behind it. MP4 only, because the API
 *        also offers HLS playlists and an `.m3u8` handed to the ingest is a
 *        manifest rather than a video. Tallest-that-fits, because the ingest
 *        transcodes to a 1080-wide vertical master and a 4K source is
 *        bandwidth and CPU spent to discard pixels. And if every rendition is
 *        taller than the target, the SMALLEST of them is taken rather than
 *        nothing — a clip that is only available oversized is still a usable
 *        clip.
 * WHERE: `search`, once per result.
 */
function pickRendition(
  files: readonly z.infer<typeof videoFileSchema>[],
): { link: string; width: number | null; height: number | null } | null {
  const playable = files.flatMap((file) => {
    if (file.link === undefined || file.link.length === 0) return [];
    /* Some rows omit `file_type`; an mp4 link with no type is still an mp4. */
    if (file.file_type !== undefined && !file.file_type.includes("mp4")) {
      return [];
    }
    return [
      {
        link: file.link,
        width: typeof file.width === "number" ? file.width : null,
        height: typeof file.height === "number" ? file.height : null,
      },
    ];
  });

  if (playable.length === 0) return null;

  const withinTarget = playable.filter(
    (file) => file.height !== null && file.height <= TARGET_HEIGHT,
  );

  if (withinTarget.length > 0) {
    return withinTarget.reduce((best, file) =>
      (file.height ?? 0) > (best.height ?? 0) ? file : best,
    );
  }

  /* Every rendition is oversized — take the least oversized one. */
  return playable.reduce((best, file) => {
    const bestHeight = best.height ?? Number.POSITIVE_INFINITY;
    const height = file.height ?? Number.POSITIVE_INFINITY;
    return height < bestHeight ? file : best;
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: reportRateLimit, RESPECT_THE_RATE_LIMIT
 *
 * Logs when the remaining hourly budget runs low. A 429 is the symptom; this is
 * the warning, and the budget is shared by every workspace on the deployment —
 * so one customer re-searching in a loop degrades the format for all of them.
 */
const RATE_LIMIT_WARN_AT = 50;

function reportRateLimit(response: Response): void {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  if (!Number.isFinite(remaining) || remaining > RATE_LIMIT_WARN_AT) return;

  console.warn(
    `[stock/pexels] rate limit is low: ${remaining} requests remaining, resets at ${
      response.headers.get("x-ratelimit-reset") ?? "?"
    }.`,
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: withTimeout, NO_UNBOUNDED_PROVIDER_CALL
 *
 * Every call here is bounded. An adapter without a timeout is a workflow step
 * held open by somebody else's outage, and the queue's own timeout is a far
 * blunter instrument than a refusal the chain can move past.
 */
async function withTimeout(
  run: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new StockError(
        "rate_limited",
        `request timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );
    }
    throw new StockError(
      "unavailable",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}
