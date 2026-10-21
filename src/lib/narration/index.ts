/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: narration barrel, splitScriptIntoLines,
 *   narrationTextHash, NARRATION_SPLIT_IS_PURE
 *
 * WHAT:  Public surface of the narration-planning module.
 * WHY:   Everything here is PURE — no database, no provider, no clock. That is
 *        the property to preserve when adding to this folder: it is what lets
 *        the two decisions that can actually be wrong (where a line breaks,
 *        and what counts as the same recording) be unit tested with no key and
 *        no rows. Anything that needs Prisma belongs in
 *        src/services/narration.service.ts instead.
 * WHERE: Imported by the TTS workflow and the narration service.
 */

export { splitBlockIntoLines, splitScriptIntoLines } from "./split";
export type { LineDraft } from "./split";
export { narrationTextHash, normaliseForHash } from "./hash";
