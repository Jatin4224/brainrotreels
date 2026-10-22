/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: Generator, GeneratorContext, NarrationLineInput,
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
import type { TimelineDoc, WordToken } from "@/lib/timeline";
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
