/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: Generator, GeneratorContext, NarrationLineInput,
 *   ResolvedBackgroundInput, BACKGROUND_IS_A_FACT,
 *   GENERATOR_CONTRACT, BUILD_IS_THE_WHOLE_CONTRACT, SKIPS_LIVE_ON_THE_GENERATOR,
 *   GeneratorNotImplementedError
 *
 * WHAT:  The contract every project kind's generator implements: facts in, one
 *        timeline document out.
 *
 * WHY:   BUILD_IS_THE_WHOLE_CONTRACT. A generator takes a context and returns a
 *        `TimelineDoc`. It does not save, it does not enqueue, it does not
 *        charge and it does not touch a provider — the workflow owns all four,
 *        which is what makes a generator the one part of the pipeline that can
 *        be reasoned about without a database or a queue. The same argument as
 *        ESTIMATE_IS_PURE in src/lib/credits/estimate.ts.
 *
 *        SKIPS_LIVE_ON_THE_GENERATOR. The phase requires that a kind which does
 *        not use a stage writes it `skipped` rather than omitting it
 *        (SKIPPED_NOT_OMITTED in src/lib/types/pipeline.ts) — and the thing
 *        that KNOWS which stages a kind uses is the kind's own generator, not
 *        the workflow. Declaring it here means adding a format in Phase 12 or
 *        13 cannot leave the workflow with a stale list of exceptions to hard-
 *        code, and the progress UI stays correct for a format the workflow has
 *        never heard of.
 *
 *        `db` is on the context although the first generator never touches it,
 *        and that is the phase's own contract rather than speculation: Phase 11
 *        picks a background out of the media library and Phase 14 resolves a
 *        character's assets, both of which are reads a pure argument list
 *        cannot carry. It is a `DbClient` — the same transaction-or-client type
 *        every service takes — so a generator called inside a workflow step
 *        reads through whatever handle the step was given.
 *
 *        This file deliberately does NOT import `server-only`, even though
 *        `DbClient` comes from the config module: the type is erased at compile
 *        time, so the contract stays importable from a test without standing up
 *        a database. The GENERATORS registry is a different matter — see the
 *        note in ./registry.ts.
 * WHERE: Implemented by ./voiceover.ts; keyed by kind in ./registry.ts; called
 *        by the `timeline` stage of
 *        src/inngest/functions/project-generate.ts.
 */

import type { DbClient } from "@/lib/config/prisma";
import type { AssetRef, TimelineDoc, WordToken } from "@/lib/timeline";
import type { AspectRatio, ProjectKind } from "@/lib/types/project";
import type { PipelineStageName } from "@/lib/types/pipeline";

/**
 * SOURCE OF TRUTH KEYWORDS: NarrationLineInput, LINES_CARRY_THEIR_AUDIO
 *
 * WHAT:  One recorded narration line, as a generator needs it.
 *
 * WHY:   LINES_CARRY_THEIR_AUDIO. A generator has to place audio items on a
 *        track, which needs three things per line and only three: the asset the
 *        bytes are in, how long it is, and who said it. It deliberately is NOT
 *        the Prisma `NarrationLine` row — that carries a `textHash`, a status,
 *        a provider id and a voice id, none of which a document can express,
 *        and taking the row would make every generator a consumer of the
 *        narration schema.
 *
 *        `durationSec` is the MEASURED duration, never the provider's estimate
 *        — see DURATION_IS_MEASURED_NOT_CLAIMED in Phase 07. Every item after
 *        the first is positioned by accumulating these, so an estimate here
 *        compounds into visible desynchronisation by the end of a long script.
 * WHERE: `GeneratorContext.lines`, assembled by the workflow from
 *        src/services/narration.service.ts.
 */
export interface NarrationLineInput {
  id: string;
  position: number;
  speakerTag: string;
  text: string;
  /** The Asset row holding this line's audio. */
  audioAssetId: string;
  /** Measured from the normalised file, not claimed by the provider. */
  durationSec: number;
  /**
   * SOURCE OF TRUTH KEYWORDS: LINE_REMEMBERS_ITS_BLOCK,
   *   A_BLOCK_IS_ONE_OR_MORE_LINES
   *
   * The `ScriptBlock` this line was split out of, or null for a line recorded
   * before Phase 14 added the column — and for a quiz, whose narration is
   * planned rather than split from blocks.
   *
   * A_BLOCK_IS_ONE_OR_MORE_LINES is why a generator needs it at all:
   * `splitBlockIntoLines` breaks a long paragraph into several takes, so "the
   * span of block X" is the union of several lines' spans, and only this field
   * says which. Null means a line with no block, which a per-block visual
   * simply does not cover — it plays over whatever the previous block's visual
   * was, which is the same thing that happens on a block with no match.
   */
  blockId: string | null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: GeneratorContext, GENERATOR_CONTEXT_IS_FACTS
 *
 * WHAT:  Everything a generator is allowed to know.
 *
 * WHY:   GENERATOR_CONTEXT_IS_FACTS — the words, the lines, the shape of the
 *        canvas, the project's settings. Not a Project row, not a tRPC context
 *        and not an organization's plan: a generator that could read a plan
 *        would start making entitlement decisions, which belong to the
 *        procedure factory and are already made by the time a workflow runs.
 *
 *        `words` may be EMPTY and a generator must still produce a playable
 *        document. That is the phase's "with STT disabled the video still
 *        completes with degraded captions" taken one step further: an alignment
 *        that produced nothing at all leaves a narration with no word timings,
 *        and the honest output is a video with audio and no captions rather
 *        than a failed run.
 *
 *        `speakers` maps a script's speaker TAG to the voice assigned to it, so
 *        the document's own `speakers` record can be written without a second
 *        database read inside the generator.
 * WHERE: The single argument of `Generator.build`.
 */
/**
 * SOURCE OF TRUTH KEYWORDS: ResolvedBackgroundInput, BACKGROUND_IS_A_FACT,
 *   RESOLVED_BEFORE_THE_GENERATOR
 *
 * WHAT:  The background a generator should put behind the narration, already
 *        chosen and already proven usable.
 *
 * WHY:   BACKGROUND_IS_A_FACT, and this is the shape Phase 11 takes BECAUSE of
 *        GENERATORS_STAY_PURE. The context carries a `db`, and the obvious
 *        reading of that is "the generator queries the library itself" — but
 *        picking a background means deciding between the project's stored
 *        choice, the workspace's last pick and a catalogue default, and
 *        checking each candidate against the plan. That is an entitlement
 *        decision and a three-table read, and GENERATOR_CONTEXT_IS_FACTS says
 *        in so many words that a generator must not be able to read a plan.
 *
 *        So the resolution happens in `resolveProjectBackground`
 *        (src/services/backgrounds.service.ts) before the generator runs, and
 *        the generator receives the ANSWER. The same function also feeds the
 *        picker, which is what keeps "what the customer sees selected" and
 *        "what ends up in the video" the same row (ONE_RESOLVER_TWO_CALLERS).
 *
 *        `durationSec` is here and is nullable, because it is what decides
 *        whether a clip can be LOOPED to the narration's length: without a
 *        known source length there is nothing to loop against
 *        (LOOP_IS_A_MODULO in src/remotion/components/media-clip.tsx), so the
 *        clip plays once and holds. A generator must therefore be able to see
 *        that it is missing rather than discovering it at render time.
 *
 *        `license` is the CATEGORY, not the terms — see
 *        LICENSE_TERMS_ARE_NOT_A_CATEGORY in src/lib/types/background.ts. The
 *        document carries it so a render can be refused months later without
 *        re-reading anybody's licence.
 * WHERE: `GeneratorContext.background`, assembled by `generatorContextFor`.
 */
export interface ResolvedBackgroundInput {
  /** The real `Asset` row id the document's handle will point at. */
  assetId: string;
  /** Null when the ingest could not measure one — the clip then holds. */
  durationSec: number | null;
  license: AssetRef["license"];
  width: number | null;
  height: number | null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: CastMember, CAST_IS_A_FACT,
 *   RESOLVED_BEFORE_THE_GENERATOR
 *
 * WHAT:  One speaker's face, already resolved to the three artwork handles it
 *        needs.
 *
 * WHY:   CAST_IS_A_FACT, the same decision as the background's and for the same
 *        reason. Resolving an avatar means reading `Speaker.avatarId`, then the
 *        `Avatar` row, then parsing its `assetSet` jsonb and checking the
 *        character is still active and within the workspace's plan — three
 *        tables and an entitlement. GENERATOR_CONTEXT_IS_FACTS says a generator
 *        must not be able to read a plan, and GENERATORS_STAY_PURE says it must
 *        not reach Prisma, so the answer arrives here already decided.
 *
 *        `states` is the COMPLETE set or the member does not exist: an avatar
 *        missing its resting frame has no neutral state, and the honest
 *        response is no overlay at all rather than a character that vanishes
 *        between sentences (A_SET_IS_COMPLETE_OR_REFUSED in
 *        src/lib/types/avatar.ts).
 * WHERE: `GeneratorContext.cast`, keyed by speaker TAG — which is what the
 *        narration lines carry, so no generator has to join ids.
 */
export interface CastMember {
  avatarId: string;
  /** The real Asset row id for each of the three states. */
  states: { neutral: string; talking: string; reaction: string };
}

/**
 * SOURCE OF TRUTH KEYWORDS: ResolvedBlockVisual, VISUALS_ARE_FACTS,
 *   RESOLVED_BEFORE_THE_GENERATOR, NO_PROVIDER_URL_IN_A_DOCUMENT,
 *   STILLS_GET_KEN_BURNS
 *
 * WHAT:  The picture one script block should show, already chosen, already
 *        ingested and already proven usable.
 *
 * WHY:   VISUALS_ARE_FACTS, the same decision as the background's and the
 *        cast's and for the same reasons. Choosing a block's visual means a
 *        stock search, an image-model call, a moderation decision, a credit
 *        hold and an ingest — none of which a generator may do
 *        (GENERATORS_STAY_PURE), and the last two are entitlement and money
 *        decisions a generator must not be able to make at all
 *        (GENERATOR_CONTEXT_IS_FACTS). So the whole chain runs in the `visuals`
 *        stage before the build, and the generator receives the ANSWER.
 *
 *        NO_PROVIDER_URL_IN_A_DOCUMENT, and this type is where that promise is
 *        kept structurally rather than by discipline. The phase's last
 *        "done when" check is "no timeline item references a provider URL
 *        directly", and the way to guarantee it is to give the generator no URL
 *        to reach for: this carries an `assetId` and nothing that could be
 *        hotlinked. The provider's URL stops at the ingest.
 *
 *        STILLS_GET_KEN_BURNS, which is why `isStill` is here as a FACT rather
 *        than inferred by the generator from the content type. A generator
 *        cannot read an asset row, so "is this a video or a picture" has to
 *        arrive with the rest of it — and the phase requires the drift
 *        specifically "so a static image does not read as a frozen frame",
 *        which means a clip must NOT get it (a pan applied to moving footage
 *        reads as a camera wobble).
 *
 *        `durationSec` is here and nullable for exactly the reason
 *        `ResolvedBackgroundInput.durationSec` is: it is what decides whether a
 *        clip can be LOOPED to the block's length (LOOP_IS_A_MODULO), and a
 *        generator must be able to see that it is missing rather than
 *        discovering it at render time. It is always null for a still, which
 *        has no source length to loop against.
 *
 *        A block that fell back to the backdrop has NO entry here at all,
 *        rather than an entry with a null asset. The styled backdrop is already
 *        the behaviour of a document with no per-block visuals
 *        (FOOTAGE_OR_BACKDROP_NEVER_BOTH), so "absent" and "fell back" are the
 *        same fact and modelling them separately would be two ways to say one
 *        thing.
 * WHERE: `GeneratorContext.visuals`, keyed by SCRIPT BLOCK id and assembled by
 *        `generatorContextFor` from `Project.settings.visuals`.
 */
export interface ResolvedBlockVisual {
  /** The real `Asset` row id the document's handle will point at. */
  assetId: string;
  /** Null for a still, and for a clip the ingest could not measure. */
  durationSec: number | null;
  license: AssetRef["license"];
  width: number | null;
  height: number | null;
  /** A picture rather than footage — see STILLS_GET_KEN_BURNS. */
  isStill: boolean;
}

export interface GeneratorContext {
  organizationId: string;
  projectId: string;
  /** The aligned narration, or empty when nothing could be timed. */
  words: readonly WordToken[];
  /** Every recorded line, in script order. */
  lines: readonly NarrationLineInput[];
  /** Speaker tag → the Voice row id assigned to it. */
  speakers: Readonly<Record<string, string | null>>;
  /** The output shape the customer chose, as pixels. */
  aspect: AspectRatio;
  /** `Project.settings`, already parsed by the caller. */
  settings: Readonly<Record<string, unknown>>;
  /**
   * The resolved background, or null for "no footage" — which means the styled
   * backdrop and is a complete video, not a missing choice. See
   * ResolvedBackgroundInput above for why this is resolved rather than looked
   * up here.
   */
  background: ResolvedBackgroundInput | null;
  /**
   * Speaker TAG → the avatar assigned to it. A tag with no entry is a speaker
   * with no face, which is a deliberate and common choice rather than a gap.
   * Empty for every format that puts nobody on screen.
   */
  cast: Readonly<Record<string, CastMember | undefined>>;
  /**
   * SOURCE OF TRUTH KEYWORDS: VISUALS_ARE_FACTS, NO_PROVIDER_URL_IN_A_DOCUMENT
   *
   * SCRIPT BLOCK id → the picture that block should show. A block with no entry
   * is a block that fell back to the styled backdrop, which is a complete
   * video and the normal case on a deployment with neither provider configured
   * (FALLBACK_CHAIN_IS_THE_POINT in src/lib/types/visual.ts).
   *
   * Empty for every format that does not choose visuals per block — a quiz
   * draws cards and a Reddit story draws a thread, both over one background.
   * See `ResolvedBlockVisual` above for why these arrive resolved.
   */
  visuals: Readonly<Record<string, ResolvedBlockVisual | undefined>>;
  /**
   * SOURCE OF TRUTH KEYWORDS: SNAPSHOT_IS_WHAT_THE_CARD_SHOWS
   *
   * The Reddit thread's facts, for the title card. Null for every other
   * format, and null for a Reddit project whose cached thread has passed its
   * retention window — in which case the story still renders with no card,
   * which is a worse video than it was and a better one than a failed render.
   *
   * It is a SNAPSHOT rather than a live read for the reason the type's own note
   * gives: re-fetching a thread to draw a card would make a render depend on
   * somebody else's uptime and on a post still existing, which is exactly the
   * dependency a deterministic render must not have.
   */
  thread: {
    title: string;
    subreddit: string;
    author: string;
  } | null;
  db: DbClient;
}

/**
 * SOURCE OF TRUTH KEYWORDS: Generator, GENERATOR_CONTRACT
 *
 * WHAT:  One project kind's document builder.
 * WHERE: See the file header.
 */
export interface Generator {
  kind: ProjectKind;
  /**
   * The stages this kind never runs. Written as `skipped` by the workflow
   * before anything else happens, so the progress list is complete from the
   * first frame the customer sees — see SKIPS_LIVE_ON_THE_GENERATOR.
   */
  skips: readonly PipelineStageName[];
  build(ctx: GeneratorContext): Promise<TimelineDoc>;
}

/**
 * SOURCE OF TRUTH KEYWORDS: GeneratorNotImplementedError, UNBUILT_KIND_IS_NAMED
 *
 * WHAT:  Thrown when a project's kind has no generator yet.
 *
 * WHY:   UNBUILT_KIND_IS_NAMED. Three of the four kinds arrive in later phases,
 *        and a customer who creates a `quiz` today must be told that the format
 *        is not built rather than watching a pipeline fail at its last step
 *        with a type error. A named error class is what lets the workflow turn
 *        this into a plain-language stage failure and a NonRetriableError — a
 *        missing generator will not appear on the second attempt.
 * WHERE: Raised by `resolveGenerator` in ./registry.ts; caught by the
 *        `timeline` stage.
 */
export class GeneratorNotImplementedError extends Error {
  readonly kind: ProjectKind;

  constructor(kind: ProjectKind) {
    super(`No generator is built for "${kind}" projects yet.`);
    this.name = "GeneratorNotImplementedError";
    this.kind = kind;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: GeneratorInputError, UNBUILDABLE_INPUT_IS_NAMED,
 *   FAILURE_IS_EXPLAINED_NOT_DUMPED
 *
 * WHAT:  Thrown when a generator's own format-specific input is missing or
 *        unreadable, so no document can honestly be built.
 *
 * WHY:   UNBUILDABLE_INPUT_IS_NAMED. Phase 13 is the first format with an input
 *        that has NO DEFAULT. Every other read of `Project.settings` falls back
 *        — a malformed caption preference produces default captions, an absent
 *        background produces the styled backdrop — because a worse video beats
 *        a failed run. A quiz with no question set has no such answer: the
 *        narration asks questions, and a document without them is a paid video
 *        of a host talking over blank cards. Refusing is the better outcome,
 *        and the refund path already exists.
 *
 *        It is a SEPARATE class from `GeneratorNotImplementedError` because the
 *        two mean opposite things to the person reading the message. That one
 *        says "this format is not built yet" and nothing the customer does will
 *        change it; this one says "this project is missing something" and names
 *        the screen that fixes it. Collapsing them would send somebody waiting
 *        for a feature that shipped.
 *
 *        FAILURE_IS_EXPLAINED_NOT_DUMPED: `message` is plain language for a
 *        customer and `detail` is for the log, so a zod error cannot reach a
 *        screen by being the easiest thing to hand — the same split
 *        `failStage` enforces.
 *
 *        Permanent by nature, and the `timeline` stage treats it so: a missing
 *        question set will not appear on the second attempt.
 * WHERE: Raised by src/lib/generators/quiz.ts; caught by the `timeline` stage
 *        of src/inngest/functions/project-generate.ts beside its sibling.
 */
export class GeneratorInputError extends Error {
  readonly kind: ProjectKind;
  /** For the log, never for a customer. */
  readonly detail: string;

  constructor(kind: ProjectKind, message: string, detail = "") {
    super(message);
    this.name = "GeneratorInputError";
    this.kind = kind;
    this.detail = detail;
  }
}
