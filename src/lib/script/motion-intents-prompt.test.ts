/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: intents prompt test, THE_CATALOGUE_IS_GENERATED,
 *   UNTRUSTED_TEXT_IS_NEVER_SYSTEM, A_SPARSE_ANSWER_IS_VALID, toBeatIntent,
 *   INTENT_MUST_BE_SUPPORTED_BY_THE_BEATS_OWN_WORDS
 *
 * WHAT:  That the labelling prompt offers exactly the intents the schema
 *        accepts, that narration cannot reach the system message, and that the
 *        answer shape tolerates the sparse reply the prompt invites.
 *
 * WHY:   THE_CATALOGUE_IS_GENERATED is asserted because the failure it
 *        prevents is silent: an intent added to `BEAT_INTENTS` and absent from
 *        the prompt is a label the schema would accept and the model will
 *        never choose, so a whole primitive stays unreachable while every test
 *        and every type-check passes. That is precisely the bug this step was
 *        written to fix, so it gets a test rather than a comment.
 *
 *        A_SPARSE_ANSWER_IS_VALID is asserted on the SCHEMA rather than on the
 *        prompt, because the prompt inviting a partial answer is worthless if
 *        the parse then refuses one — and a refused parse here costs the whole
 *        video its labels.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import type { WordToken } from "@/lib/timeline";
import {
  BEAT_INTENTS,
  beatIntentPlanSchema,
  toBeatIntent,
  type Beat,
} from "@/lib/types/scene";

import {
  beatIntentsSystemPrompt,
  beatIntentsUserPrompt,
} from "./motion-intents-prompt";

const word = (i: number, w: string): WordToken => ({
  i,
  w,
  s: i * 0.4,
  e: i * 0.4 + 0.4,
});

const WORDS: WordToken[] = [
  "forty",
  "one",
  "percent",
  "never",
  "finish",
  "setup",
  "so",
  "we",
  "rebuilt",
  "it",
].map((w, i) => word(i, w));

const BEATS: Beat[] = [
  { index: 0, startWord: 0, endWord: 5, intent: "emphasis" },
  { index: 1, startWord: 6, endWord: 9, intent: "emphasis" },
];

const SECONDS: Record<number, number> = { 0: 2.4, 1: 1.8 };

describe("the system prompt", () => {
  const system = beatIntentsSystemPrompt();

  it("offers every intent the schema accepts", () => {
    for (const intent of BEAT_INTENTS) {
      expect(system).toContain(`- ${intent}:`);
    }
  });

  it("says the default is a real answer, not a failure", () => {
    /* DEFAULT_IS_NOT_A_FAILURE — a prompt that implies every beat must be
     * something interesting gets meters showing invented percentages. */
    expect(system).toContain("`emphasis` is a real answer");
  });

  it("tells the model the designer sees one beat only", () => {
    /* INTENT_MUST_BE_SUPPORTED_BY_THE_BEATS_OWN_WORDS. Without this sentence a
     * `stat` label lands on a beat with no number in it and the designer
     * produces a counter showing nothing. */
    expect(system).toContain("ITS OWN WORDS");
  });

  it("is identical for every video", () => {
    expect(beatIntentsSystemPrompt()).toBe(system);
  });

  it("carries no narration", () => {
    /* UNTRUSTED_TEXT_IS_NEVER_SYSTEM — the operator channel holds rules and
     * the closed vocabulary, and nothing a customer wrote.
     *
     * Checked against DISTINCTIVE tokens rather than against the corpus
     * above, because common words like "it" and "so" occur in the rules
     * themselves and asserting on those tests English, not the boundary. The
     * property that actually holds it is that this function takes no
     * arguments; this catches the regression where somebody gives it some. */
    for (const token of ["Zarquon", "onboarding", "41.7"]) {
      expect(system).not.toContain(token);
    }
  });
});

describe("the user prompt", () => {
  const user = beatIntentsUserPrompt({
    beats: BEATS,
    words: WORDS,
    secondsByIndex: SECONDS,
  });

  it("fences the narration", () => {
    expect(user).toContain("<<<NARRATION>>>");
    const fences = user.split("<<<NARRATION>>>").length - 1;
    expect(fences).toBe(2);
  });

  it("gives one numbered line per beat, with its words", () => {
    expect(user).toContain("0 (2.4s): forty one percent never finish setup");
    expect(user).toContain("1 (1.8s): so we rebuilt it");
  });

  it("omits the length of a beat it was given no seconds for", () => {
    const partial = beatIntentsUserPrompt({
      beats: BEATS,
      words: WORDS,
      secondsByIndex: { 0: 2.4 },
    });
    expect(partial).toContain("1: so we rebuilt it");
  });
});

describe("the answer shape", () => {
  it("accepts an answer that labels only some beats", () => {
    /* A_SPARSE_ANSWER_IS_VALID. The prompt invites this, so the parse has to
     * allow it or the invitation costs the video every label it did get. */
    const parsed = beatIntentPlanSchema.safeParse({
      beats: [{ index: 1, intent: "stat" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty answer", () => {
    expect(beatIntentPlanSchema.safeParse({ beats: [] }).success).toBe(true);
  });

  it("refuses an intent outside the vocabulary", () => {
    const parsed = beatIntentPlanSchema.safeParse({
      beats: [{ index: 0, intent: "diagram" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a field nobody asked for", () => {
    const parsed = beatIntentPlanSchema.safeParse({
      beats: [{ index: 0, intent: "stat", colour: "#ff0000" }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("toBeatIntent", () => {
  it("passes an intent through", () => {
    expect(toBeatIntent("flow")).toBe("flow");
  });

  it("falls back for an intent this build has never heard of", () => {
    /* A_STORED_INTENT_IS_NARROWED_NOT_CAST — a settings blob from a newer
     * release loses its label here, not its beat. */
    expect(toBeatIntent("sankey")).toBe("emphasis");
    expect(toBeatIntent(undefined)).toBe("emphasis");
    expect(toBeatIntent(7)).toBe("emphasis");
  });
});
