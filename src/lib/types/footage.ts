/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: FOOTAGE_DURATIONS, FootageDuration,
 *   generateFootageSchema, listFootageSchema, estimateFootageSchema, regenerate,
 *   FootageClip, DURATION_IS_A_CLOSED_SET, THE_PROMPT_IS_THE_ONLY_FREE_FIELD
 *
 * WHAT:  The vocabulary of generated footage: how long a clip may be, what a
 *        request looks like, and what one clip looks like on the screen.
 *
 * WHY:   DURATION_IS_A_CLOSED_SET rather than a number with a maximum, and
 *        this is the decision that keeps the feature affordable. Generated
 *        video is billed per second by the provider and by us, so a free-form
 *        field invites a sixty-second request that costs more than everything
 *        else a customer has ever done — and the models that exist offer fixed
 *        lengths anyway. Two options make the price obvious on the button and
 *        make "how much will this cost" a question with two answers rather
 *        than sixty.
 *
 *        THE_PROMPT_IS_THE_ONLY_FREE_FIELD. A caller may not choose the model,
 *        the aspect, the seed or the resolution. The aspect is fixed because
 *        this product makes vertical short-form video and a clip in another
 *        shape is one that will be letterboxed into a phone frame; the model
 *        is fixed because which model is permissible is an owner decision
 *        settled per deployment, not per request.
 * WHERE: `footage.*` procedures, the footage screen, and the generation
 *        workflow.
 */

import { z } from "zod";

/**
 * SOURCE OF TRUTH KEYWORDS: FOOTAGE_DURATIONS, DURATION_IS_A_CLOSED_SET
 *
 * The clip lengths this product offers, in seconds. Short on purpose: a
 * generated clip is b-roll behind narration, not a scene — the longest thing
 * anybody needs is a few seconds that can be looped, and Phase 11's background
 * track already loops anything shorter than the narration.
 */
export const FOOTAGE_DURATIONS = [5, 10] as const;

export const footageDurationSchema = z.union([z.literal(5), z.literal(10)]);

export type FootageDuration = z.infer<typeof footageDurationSchema>;

/** The shortest option, which is what a screen should default to spending. */
export const DEFAULT_FOOTAGE_DURATION: FootageDuration = FOOTAGE_DURATIONS[0];

/**
 * SOURCE OF TRUTH KEYWORDS: FOOTAGE_PROMPT_MAX, generateFootageSchema,
 *   MODERATED_BEFORE_THE_MODEL
 *
 * WHAT:  A request to generate one clip.
 *
 * WHY:   The bounds are the ones a classifier and a model can both work with.
 *        Three characters is the floor because "cat" is a legitimate prompt
 *        and anything shorter is a mis-click; five hundred is the ceiling
 *        because a prompt longer than that is a paragraph the model will
 *        truncate anyway, and an unbounded field is a way to send a novel to a
 *        classifier we pay per call.
 *
 *        MODERATED_BEFORE_THE_MODEL: nothing here can be trusted. The prompt
 *        is a customer's free text going to a generative video model whose
 *        output we publish in our name, so it is classified under the stricter
 *        `prompt` standard before the model is called, and the check fails
 *        closed. Grep MODERATE_BEFORE_THE_MODEL.
 * WHERE: `footage.generate`.
 */
export const FOOTAGE_PROMPT_MAX = 500;

/**
 * SOURCE OF TRUTH KEYWORDS: footageFormSchema, FootageFormValues,
 *   THE_FORM_IS_WHAT_A_PERSON_TYPES, DERIVED_NOT_REDECLARED
 *
 * WHAT:  The fields the footage form actually collects.
 *
 * WHY:   THE_FORM_IS_WHAT_A_PERSON_TYPES, and `regenerate` is not one of them
 *        — it is a decision made by which BUTTON was pressed, not by anything
 *        filled in. Keeping it out of the resolver's schema is also what keeps
 *        the form's types sound: a Zod `.default()` makes a schema's input and
 *        output types differ, and React Hook Form resolves against ONE type,
 *        so a defaulted field in a form schema is a type error rather than a
 *        convenience.
 *
 *        DERIVED_NOT_REDECLARED — the procedure's schema extends this one, so
 *        the 500-character limit a customer meets on screen is provably the
 *        one the server enforces. There is no second object to keep in step.
 * WHERE: The `useForm` resolver in the footage studio.
 */
export const footageFormSchema = z.object({
  organizationId: z.string().min(1),
  prompt: z.string().trim().min(3).max(FOOTAGE_PROMPT_MAX),
  durationSec: footageDurationSchema,
});

export type FootageFormValues = z.infer<typeof footageFormSchema>;

export const generateFootageSchema = footageFormSchema.extend({
  /**
   * SOURCE OF TRUTH KEYWORDS: regenerate, A_SECOND_TAKE_IS_A_SECOND_SPEND,
   *   REGENERATE_BYPASSES_THE_CACHE_NOT_THE_GATES
   *
   * Ask for a NEW clip even though this workspace already has one for this
   * prompt and length.
   *
   * A_SECOND_TAKE_IS_A_SECOND_SPEND, which is why this is an explicit flag and
   * not the default. `CACHE_BEFORE_SPEND` exists because the model is the most
   * expensive call in the product, and re-submitting the same prompt is
   * overwhelmingly a customer who forgot they had already asked — so the
   * default stays "give them the clip they paid for". But a generative model
   * returns a DIFFERENT take for the same prompt, and "try that again" is the
   * single most obvious thing to want from one. Without this flag the cache
   * makes that impossible: every attempt returns the first clip forever.
   *
   * REGENERATE_BYPASSES_THE_CACHE_NOT_THE_GATES. It skips exactly one of the
   * five checks in `aiFootage.generate` — the cache lookup. The provider
   * check, the plan allowance, the moderation call and the balance refusal all
   * still run, in the same order, because a second take is a second full-price
   * generation of a prompt that must be classified again.
   */
  regenerate: z.boolean().default(false),
});

export type GenerateFootageValues = z.infer<typeof generateFootageSchema>;

export const listFootageSchema = z.object({
  organizationId: z.string().min(1),
});

/**
 * SOURCE OF TRUTH KEYWORDS: estimateFootageSchema, COST_ON_THE_BUTTON
 *
 * What a clip of this length would cost. A query, so the button can carry its
 * price — the phase-05 rule that every credit-spending action shows what it
 * spends. It deliberately takes no prompt: the price depends only on the
 * length, and asking for one would imply otherwise.
 */
export const estimateFootageSchema = z.object({
  organizationId: z.string().min(1),
  durationSec: footageDurationSchema,
});

/**
 * SOURCE OF TRUTH KEYWORDS: FootageClip, THE_SCREEN_READS_A_VIEW,
 *   A_FAILED_CLIP_IS_STILL_SHOWN
 *
 * WHAT:  One generated clip as the footage screen shows it.
 *
 * WHY:   A_FAILED_CLIP_IS_STILL_SHOWN. `status` and `error` are part of the
 *        view because a clip that failed has to be visible WITH its reason: a
 *        customer who spent credits and got nothing needs to know whether to
 *        reword or to try again, and a row that vanished would read as the
 *        request never having happened. The credits for a failure are
 *        released, which the copy says.
 *
 *        `url` is nullable for the same reason — there is nothing to play
 *        until the ingest has finished, and a tile with a spinner is the
 *        honest state for a clip that is still being made.
 *
 *        THE_SCREEN_READS_A_VIEW: the prompt is included because it is what a
 *        person recognises a clip by, and the thumbnail and the playable URL
 *        are signed per request rather than stored.
 * WHERE: `footage.list`; the footage screen.
 */
export interface FootageClip {
  id: string;
  prompt: string;
  durationSec: number | null;
  status: string;
  error: string | null;
  createdAt: Date;
  /** Signed per request. Null until the clip is ready. */
  url: string | null;
  /** Signed per request. Null when no poster variant exists yet. */
  posterUrl: string | null;
}
