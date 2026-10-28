/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: SCRIPT_WRITERS, resolveScriptWriter, ScriptWriter,
 *   WrittenScript, WriterContext, ONE_WORKFLOW_MANY_WRITERS,
 *   THE_OTHER_EXTENSION_POINT, ScriptWriterNotImplementedError
 *
 * WHAT:  The map from a project's `kind` to the thing that writes its script,
 *        and the lookup the script workflow uses.
 *
 * WHY:   THE_OTHER_EXTENSION_POINT. `GENERATORS` (src/lib/generators/registry.ts)
 *        decides how a kind becomes a timeline DOCUMENT; this decides how a
 *        kind becomes a SCRIPT. They are genuinely different questions —
 *        Phase 09 built the first and left the second hard-coded, because
 *        there was one format — and Phase 12 is where that stops being true: a
 *        thread is condensed with speaker roles, an article is written as a
 *        script, and Phase 13's quiz will be neither.
 *
 *        ONE_WORKFLOW_MANY_WRITERS is the property this buys. Before this
 *        registry, `project-generate` would have needed
 *        `if (kind === 'reddit-story')` to pick a different path — and the
 *        generator registry's own header says exactly what that costs: "the
 *        moment a kind name appears inside
 *        src/inngest/functions/project-generate.ts, that property is gone and
 *        every later format pays for it". So `script-generate` resolves the
 *        writer from the project's kind and is otherwise unchanged: the hold,
 *        the retry classification, the refund on every path, the one
 *        transaction that saves and charges. A new format gets all of it free.
 *
 *        `WrittenScript` is the SHARED return shape, and `speakerTag` on a
 *        block is the only thing Phase 12 added to it. It is OPTIONAL rather
 *        than required because a voiceover script genuinely has no cast — and
 *        `splitScriptIntoLines` already defaults an absent tag to `narrator`,
 *        so the single-voice case needs no special handling anywhere.
 *
 *        `DOCUMENTED_GAP_NOT_A_STUB`, the same decision as `GENERATORS`: a
 *        `Partial<Record<…>>`, so a kind with no writer is a named error the UI
 *        can show rather than a stub that silently produces an empty script.
 *
 *        This module is server-only by consequence rather than by declaration:
 *        it imports the two writers, which reach the LLM adapter. It does NOT
 *        import `server-only` itself — the registry is also the thing a test
 *        wants to assert the shape of, and the two writer modules carry the
 *        marker where it belongs.
 * WHERE: Consumed by src/inngest/functions/script-generate.ts and by
 *        src/trpc/routers/scripts.ts (to refuse an unwritable kind early).
 */

import type { ProjectKind } from "@/lib/types/project";
import type { ScriptTone } from "@/lib/types/script";
import type { JsonValue } from "@/lib/types/json";
import type { QuizRequest } from "@/lib/types/quiz";
import type { RedditThread } from "@/lib/adapters/reddit/types";
import { LlmError } from "@/lib/adapters/llm";
import { generateScript } from "./generate";
import { condenseThread } from "./condense";
import { flattenThread } from "./reddit-prompt";
import { writeQuizScript } from "./quiz";

/**
 * SOURCE OF TRUTH KEYWORDS: WrittenScript, SPEAKER_IS_OPTIONAL
 *
 * WHAT:  A finished draft, whatever wrote it.
 * WHY:   One shape so the workflow that saves and charges does not branch on
 *        the format. `estimatedSeconds` and `overLimit` travel WITH the blocks
 *        rather than being recomputed by each consumer, for the reason
 *        `GeneratedScript` records: the warning the customer sees, the number
 *        stored on each row and the figure the credit estimate used must be the
 *        same arithmetic over the same text.
 *
 *        SPEAKER_IS_OPTIONAL — absent for a single-narrator script, which is
 *        every format but this one so far. `splitScriptIntoLines` defaults it,
 *        so nothing downstream needs to know which kind it is looking at.
 * WHERE: Returned by every writer; consumed by `replaceScript`.
 */
export interface WrittenScriptBlock {
  sectionType: "hook" | "body" | "cta";
  narrationText: string;
  /** Absent for a single-voice format. Defaults to `narrator` on split. */
  speakerTag?: string | undefined;
}

export interface WrittenScript {
  title: string;
  blocks: WrittenScriptBlock[];
  /** Per-block seconds, index-aligned with `blocks`. */
  blockSeconds: number[];
  estimatedSeconds: number;
  overLimit: boolean;
  warnAtSeconds: number;
  /**
   * SOURCE OF TRUTH KEYWORDS: settingsPatch, THE_WRITER_RECORDS_WHAT_IT_DECIDED,
   *   PATCH_IS_MERGED_NOT_REPLACED
   *
   * Structured facts the writer DECIDED that a later stage needs, merged into
   * `Project.settings` by the workflow's save step.
   *
   * THE_WRITER_RECORDS_WHAT_IT_DECIDED, and Phase 13 is where this became
   * necessary. A writer is otherwise pure apart from its model call
   * (SOURCE_IS_ALREADY_EXTRACTED) and cannot touch the database — which is
   * exactly what makes it testable against a fixture — but a quiz writer
   * resolves something the GENERATOR needs and the narration cannot carry: the
   * question set, with its options and its correct index. Those are not words
   * anybody narrates, so there is no block to put them on.
   *
   * The alternatives were worse in ways worth recording. Generating the
   * questions in the request would put a model call inside a 10-second
   * transaction (EXTRACT_SYNCHRONOUSLY_GENERATE_ASYNCHRONOUSLY). Giving the
   * quiz its own workflow would duplicate the hold, the retry classification
   * and the refund on every path — the four things ONE_WORKFLOW_MANY_WRITERS
   * exists to share. Having the generator re-ask a model would make a document
   * build non-deterministic and paid.
   *
   * PATCH_IS_MERGED_NOT_REPLACED: the workflow merges these keys into the
   * existing settings object and touches nothing else, because `settings` is
   * one shared column several phases write (SETTINGS_ARE_MERGED). The writer
   * owns the KEYS it names and no others.
   *
   * Absent for every writer that decides nothing structural, which is both of
   * the others — a script and a condensed thread are entirely expressed by
   * their blocks.
   */
  settingsPatch?: Readonly<Record<string, JsonValue>> | undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: WriterContext, SOURCE_IS_ALREADY_EXTRACTED
 *
 * WHAT:  Everything a writer is allowed to know.
 * WHY:   SOURCE_IS_ALREADY_EXTRACTED. A writer never fetches: the request
 *        extracted the source (so a paywall or a deleted thread produces an
 *        actionable error while somebody is waiting for it) and stored the
 *        result, and the workflow hands it over. That is what keeps a writer
 *        free of the SSRF guard, the Reddit credential and the storage adapter
 *        — and therefore unit-testable against a fixture.
 *
 *        `thread` is present only for the Reddit path and is the one
 *        format-shaped field here. The alternative — a writer re-parsing the
 *        flattened text back into a thread — would mean the speaker split
 *        depended on string formatting, which is exactly the kind of coupling
 *        the structured snapshot exists to avoid.
 * WHERE: The single argument of `ScriptWriter.write`.
 */
export interface WriterContext {
  /** The extracted prose. Always present; it is what moderation judged. */
  sourceText: string;
  sourceTitle?: string | undefined;
  targetSeconds: number;
  tone: ScriptTone;
  /** Reddit only: the structured thread, for the speaker split. */
  thread?: RedditThread | undefined;
  /** Reddit only: whether to cut the thread to the target length. */
  condense?: boolean | undefined;
  /**
   * SOURCE OF TRUTH KEYWORDS: QUIZ_REQUEST_IS_ON_THE_CONTEXT,
   *   THE_REQUEST_IS_NOT_THE_RESULT
   *
   * Quiz only: the topic and count, or the typed question table, plus the
   * countdown, answer type and difficulty the customer chose.
   *
   * It is the REQUEST and not a resolved question set, which is the whole
   * reason it has to be here rather than being read from the settings by the
   * generator later: for the topic arm the questions do not exist yet, and the
   * thing that brings them into existence is this writer. The same argument as
   * `thread` above — a writer that had to re-derive its structured input from
   * the flattened `sourceText` would make the format depend on string
   * formatting.
   */
  quiz?: QuizRequest | undefined;
  /**
   * The project's own name. Used as a title by a writer that has nothing better
   * — a typed quiz table has no model-written title and no topic to borrow one
   * from. Optional, because every other writer gets a title from its source.
   */
  projectTitle?: string | undefined;
}

export interface ScriptWriter {
  kind: ProjectKind;
  write(context: WriterContext): Promise<WrittenScript>;
}

/**
 * SOURCE OF TRUTH KEYWORDS: ScriptWriterNotImplementedError,
 *   UNWRITABLE_KIND_IS_NAMED
 *
 * WHAT:  Thrown when a project's kind has no writer.
 * WHY:   UNWRITABLE_KIND_IS_NAMED, mirroring `GeneratorNotImplementedError`: a
 *        customer who creates a `quiz` today must be told the format is not
 *        built rather than watching a pipeline fail at a step with a type
 *        error. A named class is what lets the workflow turn this into a plain
 *        sentence and a NonRetriableError — a missing writer will not appear on
 *        the second attempt.
 * WHERE: Raised by `resolveScriptWriter`; caught by the script workflow.
 */
export class ScriptWriterNotImplementedError extends Error {
  readonly kind: ProjectKind;

  constructor(kind: ProjectKind) {
    super(`No script writer is built for "${kind}" projects yet.`);
    this.name = "ScriptWriterNotImplementedError";
    this.kind = kind;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: SCRIPT_WRITERS
 *
 * Built in Phase 06, generalised here:
 *   voiceover    → an article, a PDF or pasted text becomes a script.
 *
 * Added in Phase 12:
 *   reddit-story → a thread becomes speaker-split narration.
 *
 * Added in Phase 13:
 *   quiz → a topic or a typed table becomes a validated question set and the
 *          narration that reads it out. It is the first writer that DECIDES
 *          something the blocks cannot express, which is why `WrittenScript`
 *          grew `settingsPatch` here (THE_WRITER_RECORDS_WHAT_IT_DECIDED).
 *
 * Deliberately absent, with the phase that adds it:
 *   motion → Phase 16 (a motion piece may have no narration at all)
 */
export const SCRIPT_WRITERS: Partial<Record<ProjectKind, ScriptWriter>> = {
  voiceover: {
    kind: "voiceover",
    write: (context) =>
      generateScript({
        sourceText: context.sourceText,
        targetSeconds: context.targetSeconds,
        tone: context.tone,
        title: context.sourceTitle,
      }),
  },

  "reddit-story": {
    kind: "reddit-story",
    /**
     * SOURCE OF TRUTH KEYWORDS: PASTE_IS_THE_SAME_PATH
     *
     * A thread when there is one, the extracted text when there is not — and
     * the SAME prompt and schema either way. That matters because every one of
     * the five fetch failures offers pasting the thread instead
     * (EVERY_FAILURE_OFFERS_THE_FALLBACK), and a fallback that produced
     * single-voice narration while the fetched path produced several would be a
     * different product depending on whether Reddit happened to be up.
     *
     * The flattening is the only difference: a fetched thread is turned into
     * role-labelled prose (USERNAMES_NEVER_REACH_THE_MODEL), while pasted text
     * is already prose and goes in as it is. The model assigns the three roles
     * from what it reads in both cases.
     */
    write: (context) =>
      condenseThread({
        threadText:
          context.thread === undefined
            ? context.sourceText
            : flattenThread(context.thread),
        title: context.thread?.title ?? context.sourceTitle ?? "",
        targetSeconds: context.targetSeconds,
        condense: context.condense ?? true,
      }),
  },

  quiz: {
    kind: "quiz",
    /**
     * SOURCE OF TRUTH KEYWORDS: THE_REQUEST_IS_REQUIRED, UNWRITABLE_WITHOUT_A_SET
     *
     * UNWRITABLE_WITHOUT_A_SET. A quiz is the one format whose writer cannot
     * fall back to `sourceText`: a topic produces questions and a typed table
     * IS the questions, and neither survives being flattened to prose. There
     * is nothing to narrate without the request, so a missing one is refused
     * by name rather than producing a one-block script about a string.
     *
     * `quizzes.start` is the only thing that writes it and it writes it in the
     * same mutation that enqueues the run, so reaching here without one means
     * the settings were edited or written by an older release — permanent
     * either way, which is what `LlmError({ permanent: true })` tells the
     * workflow (it marks the stage failed, refunds the hold and does not
     * retry).
     */
    write: (context) => {
      if (context.quiz === undefined) {
        return Promise.reject(
          new LlmError(
            "This quiz has no questions or topic recorded. Set it up again from the quiz panel.",
            {
              detail: "quiz writer invoked with no stored request",
              permanent: true,
            },
          ),
        );
      }
      return writeQuizScript({
        request: context.quiz,
        fallbackTitle: context.projectTitle ?? context.sourceTitle ?? "Quiz",
      });
    },
  },
};

export function hasScriptWriter(kind: ProjectKind): boolean {
  return SCRIPT_WRITERS[kind] !== undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveScriptWriter, UNWRITABLE_KIND_IS_NAMED
 *
 * WHAT:  The writer for a kind, or a named error.
 * WHY:   Throws rather than returning null, as `resolveGenerator` does and for
 *        the same reason: every caller has to refuse anyway, and a nullable
 *        return would let one of them forget.
 * WHERE: The script workflow's generate step, and the router's pre-flight.
 */
export function resolveScriptWriter(kind: ProjectKind): ScriptWriter {
  const writer = SCRIPT_WRITERS[kind];
  if (writer === undefined) throw new ScriptWriterNotImplementedError(kind);
  return writer;
}
