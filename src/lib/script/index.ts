/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: script barrel, extractSource, generateScript,
 *   regenerateScriptBlock, assertFetchableUrl, wrapUntrusted, SSRF_GUARD
 *
 * WHAT:  Public surface of the script module.
 * WHY:   Split by what each half touches, and the split is worth knowing:
 *
 *          - `url-guard`, `readable` and `prompt` are PURE. No SDK, no
 *            network, no database. They hold the two things in this phase with
 *            security consequences — the SSRF guard and the untrusted-text
 *            fence — specifically so both can be unit tested with no key, no
 *            spend and no live request.
 *          - `ingest` and `generate` are SERVER-ONLY. They reach storage and
 *            the model.
 *
 *        A caller that only needs to validate a URL, or only needs to know how
 *        long some text takes to say, must not drag the API key's module into
 *        its bundle to get it.
 * WHERE: src/trpc/routers/scripts.ts and the scripts service.
 */

export { extractSource, SourceExtractionError } from "./ingest";
export type { ExtractedSource } from "./ingest";
export { generateScript, regenerateScriptBlock } from "./generate";
export type { GeneratedScript } from "./generate";
export { condenseThread, estimateThreadSeconds } from "./condense";
export {
  SCRIPT_WRITERS,
  ScriptWriterNotImplementedError,
  hasScriptWriter,
  resolveScriptWriter,
} from "./writers";
export type {
  ScriptWriter,
  WriterContext,
  WrittenScript,
  WrittenScriptBlock,
} from "./writers";
export {
  condenseSystemPrompt,
  condenseUserPrompt,
  flattenThread,
} from "./reddit-prompt";
export {
  MAX_REDIRECTS,
  UrlGuardError,
  assertFetchableUrl,
  guardedFetch,
  isBlockedAddress,
} from "./url-guard";
export type { UrlResolver } from "./url-guard";
export {
  MIN_USEFUL_CHARS,
  extractTitle,
  htmlToReadableText,
  stripPdfFurniture,
} from "./readable";
export {
  SOURCE_DELIMITER,
  regenerateBlockPrompt,
  scriptSystemPrompt,
  scriptUserPrompt,
  wrapUntrusted,
} from "./prompt";
