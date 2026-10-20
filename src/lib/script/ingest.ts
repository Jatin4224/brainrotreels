/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: extractSource, ExtractedSource, SourceExtractionError,
 *   SSRF_GUARD, EXTRACTED_TEXT_CAP, TOO_LITTLE_TEXT, RECORD_THE_PATH
 *
 * WHAT:  Turns whatever a customer supplied — a link, a PDF, pasted text —
 *        into the prose a script is written from.
 *
 * WHY:   One entry point for three paths, because every caller needs the same
 *        four things out of all of them (the text, a title if there is one,
 *        which path ran, and whether it was truncated) and because the
 *        SECURITY RULES must hold whichever path is taken:
 *
 *          - a URL is fetched only through `guardedFetch`, never `fetch`
 *            (SSRF_GUARD — see url-guard.ts for what that defends),
 *          - a PDF is read from OUR storage by key, never from a
 *            customer-supplied location, so the SSRF question does not arise,
 *          - and everything that comes out is DATA, delimited before it ever
 *            reaches a model (see prompt.ts).
 *
 *        RECORD_THE_PATH, the phase's step 3: the result says which route ran
 *        and whether the text was capped. When a customer asks why their
 *        script is wrong, the answer is usually "the URL was paywalled so we
 *        extracted the nav bar" or "the PDF is a scan with no text layer", and
 *        neither is answerable from the script alone.
 *
 *        TOO_LITTLE_TEXT is a FIRST-CLASS outcome rather than an edge case.
 *        Client-rendered sites, paywalls, consent walls and image-only PDFs
 *        all succeed at the transport layer and yield nothing usable, and
 *        generating from them produces a confident script about a cookie
 *        banner. Refusing with an error that offers raw-text entry is the
 *        phase's own requirement and is the only honest answer.
 * WHERE: src/lib/script/generate.ts, and the scripts router's preflight.
 */

import "server-only";

import { getStorageAdapter } from "@/lib/adapters/storage";
import {
  SOURCE_FETCH_MAX_BYTES,
  SOURCE_FETCH_TIMEOUT_MS,
  SOURCE_TEXT_MAX_CHARS,
  type ScriptSource,
  type SourceKind,
} from "@/lib/types/script";
import {
  MIN_USEFUL_CHARS,
  extractTitle,
  htmlToReadableText,
  stripPdfFurniture,
} from "./readable";
import { UrlGuardError, guardedFetch } from "./url-guard";

/**
 * SOURCE OF TRUTH KEYWORDS: SourceExtractionError, OFFER_RAW_TEXT
 *
 * WHAT:  A source that could not be turned into usable text.
 * WHY:   OFFER_RAW_TEXT. Every message here ends by pointing at the way out —
 *        pasting the text — because that path always works and the customer
 *        has the content in front of them. An error that only says "failed"
 *        leaves them with a broken feature; one that says "paste it instead"
 *        leaves them with a working one.
 * WHERE: Thrown by extractSource; surfaced by the scripts router.
 */
export class SourceExtractionError extends Error {
  readonly detail: string;

  constructor(message: string, detail = "") {
    super(message);
    this.name = "SourceExtractionError";
    this.detail = detail;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: ExtractedSource, RECORD_THE_PATH
 *
 * WHAT:  What came out, and how.
 * WHY:   `truncated` is reported rather than silent, unlike the byte cap
 *        inside the fetch: that one is about memory and a customer cannot act
 *        on it, while this one changed what their script is about and they can
 *        (shorten the input, or point at a specific section).
 * WHERE: Returned by extractSource.
 */
export interface ExtractedSource {
  text: string;
  title?: string | undefined;
  kind: SourceKind;
  truncated: boolean;
  /** Where the text actually came from — a URL may redirect. */
  finalUrl?: string | undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: extractSource
 *
 * WHAT:  The one function that turns a `ScriptSource` into text.
 * WHERE: See the file header.
 */
export async function extractSource(
  source: ScriptSource,
): Promise<ExtractedSource> {
  switch (source.kind) {
    case "text":
      return fromText(source.value);
    case "url":
      return fromUrl(source.value);
    case "pdf":
      return fromPdf(source.value);
    default: {
      /* Exhaustive over the discriminated union — a new kind without a case
       * here is a compile error at the `never` branch. */
      const exhaustive: never = source;
      throw new SourceExtractionError(
        "That kind of source is not supported.",
        `unknown source kind: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/**
 * The simplest path, and still capped and checked. Pasted text can be an
 * entire book, and it reaches the same billed request as everything else.
 */
function fromText(value: string): ExtractedSource {
  const { text, truncated } = cap(value.trim());

  if (text.length < MIN_USEFUL_CHARS) {
    throw new SourceExtractionError(
      `That is too short to make a script from. Paste at least a paragraph or two.`,
      `pasted text was ${text.length} chars`,
    );
  }

  return { text, kind: "text", truncated };
}

/**
 * SOURCE OF TRUTH KEYWORDS: fromUrl, SSRF_GUARD, TOO_LITTLE_TEXT
 *
 * WHY:   Every fetch goes through `guardedFetch`, which validates the scheme,
 *        refuses credentials, resolves the host and re-checks EVERY REDIRECT
 *        against the blocked ranges. Calling `fetch` here directly would
 *        bypass all of it — grep SSRF_GUARD before changing this line.
 */
async function fromUrl(value: string): Promise<ExtractedSource> {
  let fetched;
  try {
    fetched = await guardedFetch(value, {
      maxBytes: SOURCE_FETCH_MAX_BYTES,
      timeoutMs: SOURCE_FETCH_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof UrlGuardError) {
      /* The guard's messages are already customer-facing and already offer
       * raw-text entry; re-wrapping them would lose the specific reason. */
      throw new SourceExtractionError(error.message, error.detail);
    }
    throw error;
  }

  /* A PDF behind a link is common enough to be worth saying something useful
   * about, rather than extracting its binary as if it were HTML. */
  if (fetched.contentType.toLowerCase().includes("application/pdf")) {
    throw new SourceExtractionError(
      "That link points at a PDF. Upload the file instead and we will read it properly.",
      `content-type was ${fetched.contentType}`,
    );
  }

  const isHtml =
    fetched.contentType.toLowerCase().includes("html") ||
    fetched.body.trimStart().startsWith("<");

  const extracted = isHtml
    ? htmlToReadableText(fetched.body)
    : fetched.body.trim();
  const title = isHtml ? extractTitle(fetched.body) : undefined;

  /* TOO_LITTLE_TEXT — a paywall, a consent wall, or a site that renders its
   * article in the browser. All three succeed at the transport layer and
   * produce navigation chrome, and generating from that produces a confident
   * script about a cookie banner. */
  if (extracted.length < MIN_USEFUL_CHARS) {
    throw new SourceExtractionError(
      "There was not enough readable text on that page — it may be paywalled or load its content in the browser. Paste the text instead.",
      `extracted ${extracted.length} chars from ${fetched.finalUrl}`,
    );
  }

  const { text, truncated } = cap(extracted);

  return {
    text,
    title,
    kind: "url",
    truncated,
    finalUrl: fetched.finalUrl,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: fromPdf, PDF_COMES_FROM_OUR_STORAGE
 *
 * WHY:   PDF_COMES_FROM_OUR_STORAGE. The input is a STORAGE KEY, not a URL and
 *        not bytes. The file arrived through the normal upload path, so it was
 *        size-capped, content-type-checked and bound to a workspace before
 *        anything here touched it — which is why this path raises no SSRF
 *        question at all. A function that took a URL would need the whole
 *        guard again.
 *
 *        Extraction is per-page so `stripPdfFurniture` can see the repetition
 *        that identifies a running header. Joining the pages first would throw
 *        away the only signal available.
 */
async function fromPdf(storageKey: string): Promise<ExtractedSource> {
  const storage = await getStorageAdapter();

  let bytes: Uint8Array;
  try {
    const url = await storage.signedGetUrl(storageKey, 300);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new SourceExtractionError(
      "That file could not be read. Try uploading it again, or paste the text instead.",
      `could not download ${storageKey}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let pages: string[];
  try {
    /* Imported here rather than at module scope: it pulls a PDF engine that
     * nothing else in the app needs, and the URL and text paths must not pay
     * for it. */
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: false });
    pages = Array.isArray(result.text) ? result.text : [String(result.text)];
  } catch (error) {
    throw new SourceExtractionError(
      "That PDF could not be read. It may be protected or corrupt — paste the text instead.",
      `unpdf failed on ${storageKey}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const stripped = stripPdfFurniture(pages);

  /* A scanned PDF is an image of text: every page extracts to nothing, and
   * there is no OCR here. Saying so is more useful than "failed". */
  if (stripped.length < MIN_USEFUL_CHARS) {
    throw new SourceExtractionError(
      "No readable text was found in that PDF — it may be a scan. Paste the text instead.",
      `extracted ${stripped.length} chars from ${pages.length} page(s) of ${storageKey}`,
    );
  }

  const { text, truncated } = cap(stripped);

  return { text, kind: "pdf", truncated };
}

/**
 * SOURCE OF TRUTH KEYWORDS: cap, EXTRACTED_TEXT_CAP
 *
 * WHAT:  Trims text to the model-input cap, at a sentence boundary when it can.
 * WHY:   EXTRACTED_TEXT_CAP bounds the bill, keeps the instructions from being
 *        diluted, and keeps the response clear of `max_tokens`.
 *
 *        It backs up to the last sentence end in the final stretch rather than
 *        cutting mid-word, because the model is asked not to invent specifics
 *        — and a truncated final clause is exactly the kind of thing it will
 *        try to complete.
 * WHERE: All three paths above.
 */
function cap(text: string): { text: string; truncated: boolean } {
  if (text.length <= SOURCE_TEXT_MAX_CHARS) return { text, truncated: false };

  const hard = text.slice(0, SOURCE_TEXT_MAX_CHARS);

  /* Look for a sentence end in the last 10% — far enough back to find one,
   * close enough that nothing meaningful is lost. */
  const window = Math.floor(SOURCE_TEXT_MAX_CHARS * 0.1);
  const boundary = Math.max(
    hard.lastIndexOf(". "),
    hard.lastIndexOf(".\n"),
    hard.lastIndexOf("! "),
    hard.lastIndexOf("? "),
  );

  if (boundary > SOURCE_TEXT_MAX_CHARS - window) {
    return { text: hard.slice(0, boundary + 1), truncated: true };
  }

  return { text: hard, truncated: true };
}
