/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: costs test, UNKNOWN_RESOLUTION_COSTS_MORE,
 *   BREAKDOWN_NEVER_A_BARE_TOTAL, THRESHOLD_IS_A_TRIPWIRE,
 *   ALERT_ON_THE_PROVIDER_NOT_THE_TOTAL, MARGIN_IS_THE_POINT
 *
 * WHAT:  The dollar arithmetic behind the portal's economics panel and the
 *        daily spend alert.
 *
 * WHY:   Every function here is pure, so all of it is testable — and the
 *        properties worth asserting are the ones whose failure is SILENT. A
 *        rate that produced `NaN` would propagate through every total on the
 *        console without throwing; an alert that rounded a threshold the wrong
 *        way would simply never fire. Neither shows up in a screenshot.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import {
  CREDIT_USD_VALUE,
  PROVIDER_KEYS,
  PROVIDER_UNIT_COSTS,
  creditsToUsd,
  totalSpend,
  usdForAlignmentSeconds,
  usdForJobSteps,
  usdForModerationCalls,
  usdForNarrationSeconds,
  usdForRenderSeconds,
  usdForScriptCalls,
  type SpendBreakdown,
} from "./index";
import {
  DEFAULT_DAILY_SPEND_THRESHOLD_USD,
  evaluateSpendAlert,
} from "./alerts";

const EVERY_PRICER = [
  usdForNarrationSeconds,
  usdForAlignmentSeconds,
  usdForScriptCalls,
  usdForModerationCalls,
  usdForJobSteps,
] as const;

describe("the unit cost table", () => {
  /* The two properties the code depends on, stated on the constant itself.
   * A missing rate produces NaN, and a NaN dollar figure reaches a dashboard
   * without anything throwing. */
  it("has only finite, non-negative rates", () => {
    const rates = [
      PROVIDER_UNIT_COSTS.renderPerOutputSecond["720p"],
      PROVIDER_UNIT_COSTS.renderPerOutputSecond["1080p"],
      PROVIDER_UNIT_COSTS.ttsPerSecond,
      PROVIDER_UNIT_COSTS.sttPerSecond,
      PROVIDER_UNIT_COSTS.llmPerScriptCall,
      PROVIDER_UNIT_COSTS.llmPerModerationCall,
      PROVIDER_UNIT_COSTS.jobsPerStep,
    ];

    for (const rate of rates) {
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(0);
    }
  });

  it("prices 1080p above 720p", () => {
    expect(PROVIDER_UNIT_COSTS.renderPerOutputSecond["1080p"]).toBeGreaterThan(
      PROVIDER_UNIT_COSTS.renderPerOutputSecond["720p"],
    );
  });

  /* A moderation call is a short classification; a script is hundreds of words
   * of judgement. If these ever invert, the moderation layer has become the
   * expensive half and the cost model is wrong about which. */
  it("prices a moderation call well below a script call", () => {
    expect(PROVIDER_UNIT_COSTS.llmPerModerationCall).toBeLessThan(
      PROVIDER_UNIT_COSTS.llmPerScriptCall,
    );
  });
});

describe("the pricing functions", () => {
  it("returns zero rather than NaN for nothing, negatives and non-numbers", () => {
    for (const pricer of EVERY_PRICER) {
      expect(pricer(0)).toBe(0);
      expect(pricer(-10)).toBe(0);
      expect(pricer(Number.NaN)).toBe(0);
      expect(pricer(Number.POSITIVE_INFINITY)).toBe(0);
    }

    expect(usdForRenderSeconds(0, "1080p")).toBe(0);
    expect(usdForRenderSeconds(-1, "1080p")).toBe(0);
    expect(usdForRenderSeconds(Number.NaN, "1080p")).toBe(0);
  });

  it("scales linearly with the quantity", () => {
    const one = usdForNarrationSeconds(60);
    const two = usdForNarrationSeconds(120);
    expect(two).toBeCloseTo(one * 2, 4);
  });

  /* UNKNOWN_RESOLUTION_COSTS_MORE. `Render.resolution` is a string column, so
   * an unrecognised value is reachable — and under-reporting cost is the
   * dangerous direction for a number whose job is to say whether we are losing
   * money. */
  it("prices an unrecognised resolution at the higher rate", () => {
    const unknown = usdForRenderSeconds(60, "4k");
    const high = usdForRenderSeconds(60, "1080p");
    const low = usdForRenderSeconds(60, "720p");

    expect(unknown).toBe(high);
    expect(unknown).toBeGreaterThan(low);
  });
});

describe("creditsToUsd", () => {
  it("values credits at the stated rate", () => {
    expect(creditsToUsd(100)).toBeCloseTo(100 * CREDIT_USD_VALUE, 4);
  });

  it("treats nothing and nonsense as no revenue", () => {
    expect(creditsToUsd(0)).toBe(0);
    expect(creditsToUsd(-50)).toBe(0);
    expect(creditsToUsd(Number.NaN)).toBe(0);
  });
});

describe("totalSpend", () => {
  /* BREAKDOWN_NEVER_A_BARE_TOTAL — the total is derived from the parts, so the
   * figures an operator reads add up to the figure they are shown. */
  it("sums exactly the parts shown", () => {
    const spend: SpendBreakdown = {
      render: 1.5,
      llm: 0.25,
      tts: 0.1,
      stt: 0.05,
      jobs: 0.0001,
    };
    expect(totalSpend(spend)).toBeCloseTo(1.9001, 4);
  });

  it("has a key for every declared provider", () => {
    const spend: SpendBreakdown = {
      render: 0,
      llm: 0,
      tts: 0,
      stt: 0,
      jobs: 0,
    };
    /* If a provider is added to PROVIDER_KEYS without a slot in the breakdown,
     * the alert's "largest contributor" scan would skip it silently. */
    for (const provider of PROVIDER_KEYS) {
      expect(Object.hasOwn(spend, provider), provider).toBe(true);
    }
  });
});

describe("evaluateSpendAlert", () => {
  const quiet: SpendBreakdown = {
    render: 1,
    llm: 0.5,
    tts: 0.2,
    stt: 0.1,
    jobs: 0,
  };

  it("stays quiet below the threshold but still reports the numbers", () => {
    const alert = evaluateSpendAlert(quiet);

    expect(alert.triggered).toBe(false);
    expect(alert.message).toBe("");
    /* EVALUATE_EVERY_DAY_FIRE_RARELY — the caller logs the quiet days, so the
     * figures have to be present even when nothing fired. */
    expect(alert.totalUsd).toBeCloseTo(1.8, 4);
    expect(alert.thresholdUsd).toBe(DEFAULT_DAILY_SPEND_THRESHOLD_USD);
  });

  /* THRESHOLD_IS_A_TRIPWIRE — fires AT the threshold, not above it. An
   * exclusive comparison means a spend exactly on the number never alerts,
   * which is the off-by-one nobody notices until it matters. */
  it("fires exactly at the threshold", () => {
    const atThreshold: SpendBreakdown = {
      render: DEFAULT_DAILY_SPEND_THRESHOLD_USD,
      llm: 0,
      tts: 0,
      stt: 0,
      jobs: 0,
    };
    expect(evaluateSpendAlert(atThreshold).triggered).toBe(true);
  });

  /* ALERT_ON_THE_PROVIDER_NOT_THE_TOTAL. "Spend is high" sends an operator to
   * a dashboard; "Lambda was 94% of it" sends them to the render queue. */
  it("names the largest contributor and its share", () => {
    const loud: SpendBreakdown = {
      render: 90,
      llm: 5,
      tts: 3,
      stt: 2,
      jobs: 0,
    };
    const alert = evaluateSpendAlert(loud);

    expect(alert.triggered).toBe(true);
    expect(alert.topProvider).toBe("render");
    expect(alert.topProviderUsd).toBe(90);
    expect(alert.topProviderShare).toBeCloseTo(0.9, 2);
    expect(alert.message).toContain("render");
    /* The caveat travels with the alert — these are our records, not a bill. */
    expect(alert.message).toContain("not an invoice");
  });

  it("does not divide by zero on a day with no spend at all", () => {
    const nothing: SpendBreakdown = {
      render: 0,
      llm: 0,
      tts: 0,
      stt: 0,
      jobs: 0,
    };
    const alert = evaluateSpendAlert(nothing);

    expect(alert.triggered).toBe(false);
    expect(alert.totalUsd).toBe(0);
    expect(alert.topProviderShare).toBe(0);
    expect(Number.isNaN(alert.topProviderShare)).toBe(false);
  });

  it("picks a contributor even when every provider is equal", () => {
    const flat: SpendBreakdown = {
      render: 20,
      llm: 20,
      tts: 20,
      stt: 20,
      jobs: 20,
    };
    const alert = evaluateSpendAlert(flat);

    expect(alert.triggered).toBe(true);
    /* The first of the declared providers wins a tie, which is arbitrary but
     * deterministic — an alert whose message varied run to run on identical
     * input would be one nobody could correlate. */
    expect(alert.topProvider).toBe(PROVIDER_KEYS[0]);
  });
});
