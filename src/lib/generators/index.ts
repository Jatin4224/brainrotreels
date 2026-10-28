/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: generators barrel, GENERATORS, resolveGenerator,
 *   Generator, GeneratorContext, buildVoiceoverDocument, GENERATORS_STAY_PURE
 *
 * WHAT:  The public surface of the generator library — the contract, the
 *        registry, and the lookups the pipeline uses.
 *
 * WHY:   GENERATORS_STAY_PURE. Nothing under src/lib/generators/ imports
 *        Prisma's client, `server-only`, React, Remotion or a Node built-in:
 *        a generator takes facts and returns a document
 *        (BUILD_IS_THE_WHOLE_CONTRACT in ./types.ts). That is what lets the
 *        same build run inside a workflow step, inside a unit test with no
 *        database, and — from Phase 15 — in the editor's "regenerate this"
 *        button. A single server-side import here would break that silently.
 *
 *        Importers use this barrel rather than the individual files, exactly as
 *        src/lib/timeline/index.ts and src/lib/captions/index.ts do, so the
 *        internal split stays free to change.
 * WHERE: Imported as '@/lib/generators' by
 *        src/inngest/functions/project-generate.ts,
 *        src/services/pipeline.service.ts and src/trpc/routers/projects.ts.
 */

export { GENERATORS, generatorSkipsFor, hasGenerator, resolveGenerator } from "./registry";
export { GeneratorNotImplementedError } from "./types";
export type {
  Generator,
  GeneratorContext,
  CastMember,
  NarrationLineInput,
  ResolvedBackgroundInput,
} from "./types";
export { buildVoiceoverDocument, voiceoverGenerator } from "./voiceover";
export {
  REDDIT_CARD_ELEMENT_KIND,
  buildRedditStoryDocument,
  redditStoryGenerator,
} from "./reddit-story";
export { buildAvatarWindows } from "./avatar-windows";
export type { AvatarWindow, SpeakerSpan } from "./avatar-windows";
