/**
 * SOURCE OF TRUTH KEYWORDS: pickBestStockResult, scoreStockResult,
 *   orderStockResults, COVERAGE_BEATS_RESOLUTION, LANDSCAPE_IS_REFUSED,
 *   UNKNOWN_IS_NOT_PENALISED, TIE_BREAK_IS_DETERMINISTIC, visual selection tests
 *
 * WHAT:  Which clip wins for a block, and whether the winner is stable.
 *
 * WHY:   Every failure here is INVISIBLE to types and visible in the finished
 *        video, which is the worst combination this codebase has:
 *
 *          A coverage rule that loses to resolution picks a two-second 4K clip
 *          under an eight-second paragraph. It renders, it validates, and it
 *          stutters four times — the single most obvious tell that a video was
 *          assembled by a machine.
 *
 *          A landscape clip that gets through is cropped to a third of itself
 *          at render time, usually losing the subject. Nothing fails; the
 *          picture is just wrong.
 *
 *          An unstable tie-break changes the document for an unchanged project,
 *          which changes its hash, which makes Phase 04 charge for a second
 *          paid render of an identical video (RENDER_REUSE). That one costs
 *          money rather than quality, and nobody would attribute it to a
 *          sorting function.
 *
 *        The weighting is asserted directly as well as through the winner,
 *        because a rule that picks the right clip for the wrong reason is one
 *        that breaks on the next candidate set.
 * WHERE: Run by `npm test`. Guards src/lib/visuals/select.ts.
 */

import { describe, expect, it } from "vitest";

import type { StockResult } from "@/lib/adapters/stock/types";
import {
  orderStockResults,
  pickBestStockResult,
  scoreStockResult,
} from "./select";

function clip(overrides: Partial<StockResult> & { providerId: string }): StockResult {
  return {
    previewUrl: "https://videos.pexels.com/poster.jpg",
    downloadUrl: "https://videos.pexels.com/clip.mp4",
    license: "Pexels License",
    width: 1080,
    height: 1920,
    durationSec: 10,
    ...overrides,
  };
}

describe("scoreStockResult", () => {
  /**
   * COVERAGE_BEATS_RESOLUTION, asserted on the WEIGHTS rather than on a
   * winner. A clip that covers the block at a poor resolution must outscore a
   * magnificent one that has to loop — if that inequality ever flips, the
   * winner tests below would still pass for some candidate sets and fail for
   * others.
   */
  it("weighs covering the block above pixel height", () => {
    const covers = scoreStockResult({
      result: clip({ providerId: "a", durationSec: 8, height: 720, width: 406 }),
      blockSeconds: 8,
    });
    const loops = scoreStockResult({
      result: clip({
        providerId: "b",
        durationSec: 2,
        height: 2160,
        width: 1216,
      }),
      blockSeconds: 8,
    });

    expect(covers).toBeGreaterThan(loops);
  });

  /* A clip at 90% of the block loops once and barely shows it; one at 20%
   * loops five times. Partial credit has to be monotonic in that ratio or the
   * chain would pick the worse of two short clips. */
  it("gives partial credit in proportion to how much of the block it covers", () => {
    const nearly = scoreStockResult({
      result: clip({ providerId: "a", durationSec: 7 }),
      blockSeconds: 8,
    });
    const barely = scoreStockResult({
      result: clip({ providerId: "b", durationSec: 2 }),
      blockSeconds: 8,
    });

    expect(nearly).toBeGreaterThan(barely);
  });

  /* Beyond the comfortable height the extra pixels are thrown away by the
   * transcode (VERTICAL_MASTER), so rewarding them would prefer a far larger
   * download for an identical frame. */
  it("stops rewarding height past what the master keeps", () => {
    const comfortable = scoreStockResult({
      result: clip({ providerId: "a", height: 1080, width: 608 }),
      blockSeconds: 5,
    });
    const enormous = scoreStockResult({
      result: clip({ providerId: "b", height: 4320, width: 2432 }),
      blockSeconds: 5,
    });

    expect(enormous).toBe(comfortable);
  });

  /**
   * UNKNOWN_IS_NOT_PENALISED. A provider that reports no duration must not be
   * systematically beaten by one that does — that would make the choice a fact
   * about which library is chattier rather than about which clip is better.
   * Asserted as "not worse than a clip that loops", which is the comparison
   * that actually matters: silence is neutral, not bad.
   */
  it("does not punish a clip whose duration the provider did not report", () => {
    const unknown = scoreStockResult({
      result: clip({ providerId: "a", durationSec: undefined }),
      blockSeconds: 8,
    });
    const loops = scoreStockResult({
      result: clip({ providerId: "b", durationSec: 1 }),
      blockSeconds: 8,
    });

    expect(unknown).toBeGreaterThanOrEqual(loops);
  });
});

describe("pickBestStockResult", () => {
  it("prefers the clip that covers the block", () => {
    const best = pickBestStockResult(
      [
        clip({ providerId: "short", durationSec: 2 }),
        clip({ providerId: "covers", durationSec: 9 }),
        clip({ providerId: "shorter", durationSec: 1 }),
      ],
      8,
    );

    expect(best?.providerId).toBe("covers");
  });

  /**
   * LANDSCAPE_IS_REFUSED. The search already asked for portrait, so a wide
   * result means the provider ignored the parameter — and a wide clip cropped
   * to 9:16 keeps a third of the frame. Returning null lets the block fall
   * through to a generated image, which is vertical by construction.
   */
  it("refuses a landscape clip outright rather than ranking it last", () => {
    const best = pickBestStockResult(
      [clip({ providerId: "wide", width: 1920, height: 1080 })],
      5,
    );

    expect(best).toBeNull();
  });

  /* The shape is only known when BOTH dimensions are reported. A provider that
   * reports neither must not have its clips thrown away. */
  it("keeps a clip whose dimensions are unknown", () => {
    const best = pickBestStockResult(
      [clip({ providerId: "unsized", width: undefined, height: undefined })],
      5,
    );

    expect(best?.providerId).toBe("unsized");
  });

  it("returns null for an empty candidate list", () => {
    expect(pickBestStockResult([], 5)).toBeNull();
  });

  /**
   * TIE_BREAK_IS_DETERMINISTIC, asserted by SHUFFLING the input. Two clips
   * with identical facts must resolve the same way whatever order the provider
   * returned them in — otherwise an unchanged project produces a different
   * document on a re-run, and Phase 04 bills a second render for an identical
   * video.
   */
  it("picks the same clip whatever order equal candidates arrive in", () => {
    const a = clip({ providerId: "aaa" });
    const b = clip({ providerId: "bbb" });
    const c = clip({ providerId: "ccc" });

    const forwards = pickBestStockResult([a, b, c], 5);
    const backwards = pickBestStockResult([c, b, a], 5);
    const shuffled = pickBestStockResult([b, c, a], 5);

    expect(forwards?.providerId).toBe("aaa");
    expect(backwards?.providerId).toBe("aaa");
    expect(shuffled?.providerId).toBe("aaa");
  });

  /* A candidate with no download URL is not a candidate: the ingest would have
   * nothing to fetch, and skipping it here is better than failing a block. */
  it("skips a candidate with no download URL", () => {
    const best = pickBestStockResult(
      [
        clip({ providerId: "empty", downloadUrl: "" }),
        clip({ providerId: "real" }),
      ],
      5,
    );

    expect(best?.providerId).toBe("real");
  });
});

describe("orderStockResults", () => {
  /**
   * PICKER_SHOWS_THE_SAME_ORDER. The grid's first tile has to be the clip the
   * automatic chain would have taken, or "why did it choose that one" has no
   * answer a customer can see.
   */
  it("puts the automatic pick first", () => {
    const candidates = [
      clip({ providerId: "short", durationSec: 2 }),
      clip({ providerId: "covers", durationSec: 9 }),
    ];

    const ordered = orderStockResults(candidates, 8);

    expect(ordered[0]?.providerId).toBe(
      pickBestStockResult(candidates, 8)?.providerId,
    );
  });

  /* Unlike the picker, the grid KEEPS a landscape result — a person looking at
   * a tile can see for themselves that it is wide, and removing an option
   * somebody can evaluate is worse than ranking it last (LOCKED_NOT_HIDDEN's
   * reasoning). It must still rank below the portrait ones. */
  it("keeps a landscape clip but ranks it below the portrait ones", () => {
    const ordered = orderStockResults(
      [
        clip({ providerId: "wide", width: 1920, height: 1080 }),
        clip({ providerId: "tall" }),
      ],
      5,
    );

    expect(ordered.map((entry) => entry.providerId)).toEqual(["tall", "wide"]);
  });

  it("does not mutate the array it was given", () => {
    const candidates = [
      clip({ providerId: "short", durationSec: 2 }),
      clip({ providerId: "covers", durationSec: 9 }),
    ];
    const before = candidates.map((entry) => entry.providerId);

    orderStockResults(candidates, 8);

    expect(candidates.map((entry) => entry.providerId)).toEqual(before);
  });
});
