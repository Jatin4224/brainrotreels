/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: designMotionStyle, DesignedMotionStyle,
 *   CODE_VALIDATES_NOT_THE_EYE, REJECT_AND_REGENERATE, ID_IS_MINTED_BY_CODE,
 *   A_PROPOSAL_IS_NOT_A_STYLE
 *
 * WHAT:  "Design one for me" — three answers go to a model, it proposes tokens,
 *        code validates them, and a refused proposal is re-asked once.
 *
 * WHY:   CODE_VALIDATES_NOT_THE_EYE is the phase's step 9 and the whole reason
 *        this file is more than one adapter call. The model's output is parsed
 *        by `motionStyleProposalSchema` — which proves the SHAPE — and then
 *        checked by `checkMotionStyle`, which proves the things a schema
 *        cannot: that the palette exists, that the caption treatment is real,
 *        that both fonts resolve to a bundled family, and that the pairing is
 *        legible. THE_SCHEMA_IS_NOT_ENOUGH, exactly as src/lib/types/quiz.ts
 *        argues at length for a quiz.
 *
 *        REJECT_AND_REGENERATE: a refused proposal is asked for ONCE more with
 *        the refusals quoted, and a second refusal is a permanent failure. The
 *        same single retry the quiz writer takes and for the same reason — a
 *        second failure is almost always the model being asked the wrong
 *        question rather than having a bad moment, and every attempt is a
 *        billed request.
 *
 *        Note the two retries are at DIFFERENT levels and both are needed. The
 *        adapter retries output that fails the SCHEMA (malformed JSON, a
 *        missing field); this retries output that passes the schema and is not
 *        a usable style. Neither can do the other's job.
 *
 *        ID_IS_MINTED_BY_CODE. The proposal carries a `name` and no `id`,
 *        because a model-chosen id could collide with a library style and
 *        silently replace it on a screen listing both. The id is derived from
 *        the name, prefixed, and the prefix is what guarantees it cannot.
 *
 *        A_PROPOSAL_IS_NOT_A_STYLE: this returns the validated `MotionStyle`
 *        AND the rationale, and it stores nothing. Whether a customer keeps it
 *        is the router's business, and a designed style that was never applied
 *        should leave no trace.
 *
 *        SERVER-ONLY, because it reaches the LLM adapter which holds the API
 *        key. Everything that can actually be wrong — the token vocabulary,
 *        the validation, the prompt construction — is pure and lives
 *        elsewhere, so it is all testable with no key and no spend.
 * WHERE: `motionStudio.designStyle` in src/trpc/routers/motion.ts.
 */

import "server-only";

import { getLlmAdapter, LlmError } from "@/lib/adapters/llm";
import { checkMotionStyle } from "@/lib/motion-styles";
import {
  motionStyleProposalSchema,
  motionStyleSchema,
  type DesignMotionStyleValues,
  type MotionStyle,
  type MotionStyleProposal,
  type MotionStyleRejection,
} from "@/lib/types/motion-style";

import {
  motionStyleSystemPrompt,
  motionStyleUserPrompt,
} from "./motion-style-prompt";

/**
 * SOURCE OF TRUTH KEYWORDS: DesignedMotionStyle
 *
 * The validated style, plus the one sentence the customer reads. `rationale`
 * is not part of `MotionStyle` because it describes a DECISION rather than the
 * style — applying the style stores the tokens, and a sentence about why a
 * model picked them in March is not something a renderer should carry.
 */
export interface DesignedMotionStyle {
  style: MotionStyle;
  rationale: string;
}

/* Prefix on every designed id, so one can never collide with a library style —
 * see ID_IS_MINTED_BY_CODE. Also makes a designed style obvious in a log and
 * in `Project.settings`. */
const DESIGNED_ID_PREFIX = "designed-";

/**
 * SOURCE OF TRUTH KEYWORDS: designMotionStyle, REJECT_AND_REGENERATE
 *
 * WHAT:  A validated motion style from three answers, or a thrown `LlmError`.
 * WHY:   Throws rather than returning refusals, which is the opposite of
 *        `checkMotionStyle` and right for both. The validator's refusals are
 *        FEEDBACK — they go back to the model. By the time this function
 *        gives up, twice, there is nothing the customer can act on except
 *        picking from the library, so a thrown error that the router turns
 *        into "we could not design one, choose a style instead" is the honest
 *        answer. Returning a half-valid style would put an unreadable video
 *        one click away.
 * WHERE: The router.
 */
export async function designMotionStyle(
  answers: Pick<DesignMotionStyleValues, "subject" | "audience" | "feeling">,
): Promise<DesignedMotionStyle> {
  const adapter = await getLlmAdapter();
  const system = motionStyleSystemPrompt();

  let rejections: MotionStyleRejection[] = [];

  /* Two attempts: the proposal, and one repair with the refusals named. */
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const proposal = await adapter.generate<MotionStyleProposal>({
      system,
      user: motionStyleUserPrompt({ answers, rejections }),
      schema: motionStyleProposalSchema,
      purpose: "motionStyles.design",
    });

    const style = styleFromProposal(proposal);
    const check = checkMotionStyle(style);

    if (check.ok) return { style, rationale: proposal.rationale };

    rejections = check.rejections;
    console.warn(
      `[script/motion-style] Attempt ${attempt + 1} refused: ` +
        rejections.map((r) => `${r.path} ${r.code}`).join(", "),
    );
  }

  throw new LlmError(
    "We could not design a style for that. Pick one from the library instead.",
    {
      /* Permanent: the model has now failed the same validation twice with the
       * reasons in front of it, and a third attempt is a third charge for the
       * same outcome. */
      permanent: true,
      detail: `motionStyles.design refused twice: ${rejections
        .map((r) => `${r.path} ${r.code}`)
        .join(", ")}`,
    },
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: styleFromProposal, ID_IS_MINTED_BY_CODE
 *
 * WHAT:  A proposal as a `MotionStyle`.
 * WHY:   Parsed through `motionStyleSchema` rather than assembled by hand, so
 *        a designed style is the same TYPE as a library one and goes through
 *        the same validation — there is no second shape for a model-made
 *        style to be wrong in.
 *
 *        `minPlan` is set by US, not proposed: what a style costs is a
 *        commercial decision and `motionStudio` is already a pro feature, so a
 *        model choosing `free` here would be inventing pricing.
 * WHERE: designMotionStyle.
 */
export function styleFromProposal(proposal: MotionStyleProposal): MotionStyle {
  return motionStyleSchema.parse({
    id: mintStyleId(proposal.name),
    name: proposal.name,
    minPlan: "pro",
    paletteId: proposal.paletteId,
    fonts: proposal.fonts,
    radius: proposal.radius,
    strokeWeight: proposal.strokeWeight,
    motionPersonality: proposal.motionPersonality,
    captionTreatment: proposal.captionTreatment,
    musicMood: proposal.musicMood,
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: mintStyleId, ID_IS_MINTED_BY_CODE
 *
 * Slugged from the name and prefixed. An empty slug — a name of only
 * punctuation or non-Latin characters — falls back to a fixed suffix rather
 * than producing a bare prefix, because `designed-` alone would collide with
 * the next such style.
 *
 * Exported for its test rather than for a caller. Nothing in this codebase
 * mocks the LLM adapter (the convention every model-calling module follows is
 * that its PURE halves are what get tested), so exporting the two pure
 * functions here is what lets the proposal → style → validation path be
 * asserted with no key and no spend. Grep A_PROPOSAL_IS_NOT_A_STYLE.
 */
export function mintStyleId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40);

  return `${DESIGNED_ID_PREFIX}${slug.length > 0 ? slug : "style"}`;
}
