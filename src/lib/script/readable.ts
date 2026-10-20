/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: htmlToReadableText, extractTitle, stripPdfFurniture,
 *   READABLE_NOT_PERFECT, BOILERPLATE_FIRST, PURE_TEXT_EXTRACTION
 *
 * WHAT:  Turning a fetched page or a PDF's raw text into the prose a script
 *        should be written from.
 *
 * WHY:   READABLE_NOT_PERFECT, and this is the expectation to set before
 *        reading the code. Perfect article extraction is an unsolved problem
 *        with a whole industry around it. What this needs to do is much
 *        narrower: get the ARTICLE's sentences, drop enough navigation and
 *        legal boilerplate that the model writes about the story rather than
 *        about the cookie banner, and never crash on malformed input.
 *
 *        BOILERPLATE_FIRST: `<script>`, `<style>`, `<nav>`, `<header>`,
 *        `<footer>`, `<aside>` and `<form>` are removed WITH THEIR CONTENT
 *        before any text is taken. Stripping tags first and filtering words
 *        afterwards is the obvious order and it is wrong — by then the
 *        navigation is indistinguishable from prose, and a model given a
 *        site's menu writes a script about the menu.
 *
 *        PURE_TEXT_EXTRACTION — regex and string work only, no DOM, no
 *        headless browser, no network. Three reasons: it runs inside a request
 *        budget; a DOM parser on hostile HTML is a denial-of-service surface
 *        we would be handing a customer-supplied URL; and being pure is what
 *        makes every case here unit-testable.
 *
 *        It cannot run JavaScript, so a site that renders its article
 *        client-side yields navigation and nothing else. That is a REAL
 *        limitation and the product answer is the one the phase already
 *        requires: a clear error offering raw-text entry, which `extractSource`
 *        raises when too little text comes back.
 * WHERE: src/lib/script/ingest.ts.
 */

/** Below this, whatever we extracted is not an article. */
export const MIN_USEFUL_CHARS = 200;

/**
 * Elements whose CONTENT is furniture, not prose. Removed wholesale before
 * any text is taken — see BOILERPLATE_FIRST.
 */
const CONTENT_TO_DROP = [
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "svg",
  "iframe",
  "template",
  "button",
  "select",
] as const;

/**
 * SOURCE OF TRUTH KEYWORDS: extractTitle
 *
 * WHAT:  The page's title, preferring what a sharer would see.
 * WHY:   `og:title` before `<title>` because `<title>` routinely carries the
 *        site name and section ("Thing happened | Section | Paper"), and that
 *        suffix reaches the model as if it were part of the story. The
 *        og:title is what the publisher chose for a headline.
 * WHERE: htmlToReadableText's result.
 */
export function extractTitle(html: string): string | undefined {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  )?.[1];
  if (og !== undefined && og.trim().length > 0)
    return decodeEntities(og).trim();

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title !== undefined && title.trim().length > 0) {
    return decodeEntities(title).trim().slice(0, 200);
  }

  return undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: htmlToReadableText, BOILERPLATE_FIRST
 *
 * WHAT:  A page's readable prose, as plain text.
 * WHERE: extractSource's `url` path.
 */
export function htmlToReadableText(html: string): string {
  let working = html;

  /* BOILERPLATE_FIRST — content and tag together, before anything else. */
  for (const tag of CONTENT_TO_DROP) {
    working = working.replaceAll(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"),
      " ",
    );
    /* Self-closing or unclosed forms of the same elements. */
    working = working.replaceAll(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), " ");
  }

  /* HTML comments can hold anything, including templating and, occasionally,
   * an entire alternate version of the page. */
  working = working.replaceAll(/<!--[\s\S]*?-->/g, " ");

  /* Block-level boundaries become newlines BEFORE tags are dropped, so
   * paragraphs do not run together into one sentence. Without this, "end of
   * paragraph.Next paragraph starts" is what the model reads. */
  working = working.replaceAll(
    /<\/?(p|div|br|li|tr|h[1-6]|section|article|blockquote)\b[^>]*>/gi,
    "\n",
  );

  working = working.replaceAll(/<[^>]+>/g, " ");
  working = decodeEntities(working);

  return normaliseWhitespace(working);
}

/**
 * SOURCE OF TRUTH KEYWORDS: stripPdfFurniture, REPEATED_LINE_IS_FURNITURE
 *
 * WHAT:  Removes running headers, footers and page numbers from PDF text.
 *
 * WHY:   REPEATED_LINE_IS_FURNITURE. A PDF has no markup saying "this is a
 *        footer", so the signal has to be statistical: a short line that
 *        appears on most pages is the document's furniture, not its argument.
 *        Left in, it is repeated once per page in the model's input — a
 *        ten-page paper contributes its own title ten times, which both wastes
 *        the budget and tells the model that phrase matters more than anything
 *        else in the text.
 *
 *        The thresholds are deliberately conservative: a line must be SHORT
 *        (real sentences are not footers) and appear on at least half the
 *        pages. Over-stripping loses argument; under-stripping costs tokens,
 *        and of the two, losing the argument is worse.
 *
 *        Bare page numbers go regardless of repetition, since "7" on its own
 *        is never content.
 * WHERE: extractSource's `pdf` path.
 */
export function stripPdfFurniture(pages: readonly string[]): string {
  if (pages.length === 0) return "";

  /* A single page has no repetition to measure, so there is nothing to
   * detect — returning it as-is is more honest than guessing. */
  if (pages.length === 1) {
    return normaliseWhitespace(dropBarePageNumbers(pages[0] ?? ""));
  }

  const counts = new Map<string, number>();
  for (const page of pages) {
    /* Per-page uniqueness: a line repeated three times on ONE page is
     * emphasis, not furniture. */
    const seen = new Set<string>();
    for (const line of page.split("\n")) {
      const key = line.trim();
      if (key.length === 0 || key.length > 80) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const threshold = Math.max(2, Math.ceil(pages.length / 2));
  const furniture = new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([line]) => line),
  );

  const cleaned = pages
    .map((page) =>
      page
        .split("\n")
        .filter((line) => !furniture.has(line.trim()))
        .join("\n"),
    )
    .join("\n\n");

  return normaliseWhitespace(dropBarePageNumbers(cleaned));
}

/* A line that is only a number, or "Page 7", or "7 of 12". */
function dropBarePageNumbers(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(page\s+)?\d+(\s*(of|\/)\s*\d+)?\s*$/i.test(line))
    .join("\n");
}

/**
 * SOURCE OF TRUTH KEYWORDS: normaliseWhitespace
 *
 * WHAT:  Collapses the whitespace extraction leaves behind.
 * WHY:   Dropping tags leaves runs of spaces and dozens of blank lines, and
 *        whitespace is BILLED — every run is tokens spent on nothing. Blank
 *        lines are collapsed to at most one, because paragraph breaks are
 *        meaningful and six of them are not.
 * WHERE: Both extractors above.
 */
function normaliseWhitespace(text: string): string {
  return (
    text
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      /* Spaces and tabs, but NOT newlines — collapsing those would undo the
       * paragraph boundaries established above. */
      .replaceAll(/[^\S\n]+/g, " ")
      .replaceAll(/ *\n */g, "\n")
      .replaceAll(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: decodeEntities, ENTITIES_ARE_SPOKEN
 *
 * WHAT:  Turns the handful of HTML entities that matter into characters.
 * WHY:   ENTITIES_ARE_SPOKEN. These reach a model that is writing words to be
 *        READ ALOUD, and `&amp;` left undecoded is narration that says
 *        "ampersand amp semicolon". Only the common ones are handled plus the
 *        numeric forms — a full entity table is a dependency for a long tail
 *        that does not appear in article prose.
 *
 *        `&amp;` is decoded LAST among the named ones, so `&amp;lt;` becomes
 *        `&lt;` and not `<` — decoding it first would let doubly-encoded text
 *        turn back into markup.
 * WHERE: Both extractors above.
 */
function decodeEntities(text: string): string {
  let working = text
    .replaceAll(/&nbsp;/gi, " ")
    .replaceAll(/&quot;/gi, '"')
    .replaceAll(/&#0*39;|&apos;/gi, "'")
    .replaceAll(/&lsquo;|&rsquo;/gi, "'")
    .replaceAll(/&ldquo;|&rdquo;/gi, '"')
    .replaceAll(/&mdash;/gi, "—")
    .replaceAll(/&ndash;/gi, "–")
    .replaceAll(/&hellip;/gi, "…")
    .replaceAll(/&lt;/gi, "<")
    .replaceAll(/&gt;/gi, ">");

  /* Numeric entities, decimal and hex. Bounded to the BMP: anything outside is
   * left alone rather than risking an invalid code point. */
  working = working.replaceAll(/&#(\d{1,6});/g, (match, digits: string) => {
    const code = Number(digits);
    return code > 0 && code <= 0xffff ? String.fromCodePoint(code) : match;
  });
  working = working.replaceAll(
    /&#x([0-9a-f]{1,5});/gi,
    (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0xffff ? String.fromCodePoint(code) : match;
    },
  );

  /* Last — see the note above. */
  return working.replaceAll(/&amp;/gi, "&");
}
