/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: alignment barrel, reconcileToScript,
 *   distributeEvenly, alignmentAudioHash, concatAlignedLines,
 *   ALIGNMENT_IS_PURE
 *
 * WHAT:  The public surface of the alignment module — matching a transcript
 *        back to the script, the degrade fallback, the stitching, and the
 *        cache key.
 *
 * WHY:   ALIGNMENT_IS_PURE. Nothing here imports Prisma, `server-only`, a
 *        provider or a Node built-in: the module takes words and text and
 *        returns words. That is what makes the three decisions in this phase
 *        that can actually be WRONG — the back-match, the interpolation and
 *        the degrade distribution — unit testable with no API key, no audio
 *        and no network. The provider call itself lives behind the STT seam
 *        and the orchestration lives in the service, exactly as the narration
 *        module splits from the TTS adapter.
 * WHERE: Imported as '@/lib/alignment' by src/services/alignment.service.ts
 *        and the align workflow.
 */

export { reconcileToScript } from "./reconcile";
export type { HeardWord } from "./reconcile";

export {
  concatAlignedLines,
  distributeEvenly,
  offsetWords,
} from "./degrade";

export { alignmentAudioHash } from "./hash";

export { normaliseToken, tokenizeScript } from "./tokenize";
export type { ScriptToken } from "./tokenize";
