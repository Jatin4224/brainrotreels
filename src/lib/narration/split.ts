/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: splitBlockIntoLines, splitScriptIntoLines,
 *   LineDraft, SPLIT_LONG_BLOCKS, SPLIT_ON_SENTENCES, POSITION_IS_STABLE,
 *   NARRATION_SPLIT_IS_PURE
 *
 * WHAT:  Turning script blocks into the lines that get synthesised.
 *
 * WHY:   NARRATION_SPLIT_IS_PURE — no database, no provider, no clock. It
 *        takes blocks and returns drafts. That is what lets the decisions that
 *        can actually be wrong here (where a sentence ends, what counts as too
 *        short to stand alone, whether positions stay stable) be unit tested
 *        without a key or a row.
 *
 *        SPLIT_LONG_BLOCKS is the reason this module exists at all. A line is
 *        the unit of RE-SYNTHESIS, so its length decides what a one-word edit
 *        costs. Leave a 400-character block whole and fixing a typo in its
 *        last sentence re-records the whole thing — a provider call, and a
 *        noticeably different take of every sentence before the typo. The
 *        delivery drifts and the customer hears the seam.
 *
 *        But splitting is not free either: a sentence cut mid-clause is
 *        synthesised with the wrong intonation at the break, and stitching
 *        those together sounds worse than one long take. So the cap is
 *        generous, the split is on SENTENCE boundaries only, and a fragment
 *        too short to stand alone stays with its neighbour.
 *
 *        POSITION_IS_STABLE across regeneration, which the phase requires.
 *        Positions are assigned by walking the blocks in order and the lines
 *        within them in order — never from a model, never from a set. The same
 *        script therefore always produces the same positions, which is what
 *        makes `textHash` caching land on the right line rather than merely on
 *        a line with the right words.
 * WHERE: src/inngest/functions/project-tts.ts, when a script becomes audio.
 */

import { LINE_MAX_CHARS, LINE_MIN_CHARS } from "@/lib/types/voice";

/**
 * SOURCE OF TRUTH KEYWORDS: LineDraft
 *
 * WHAT:  One line, before it has an id or a voice.
 * WHY:   No `voiceId` and no `textHash` — both depend on the speaker
 *        ASSIGNMENT, which is a database read this module must not do. The
 *        caller resolves the tag to a voice and hashes; splitting only decides
 *        where the words break.
 * WHERE: Returned by both functions below.
 */
export interface LineDraft {
  position: number;
  speakerTag: string;
  text: string;
  /** Which block it came from — kept so an edit can be traced back. */
  blockId: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: splitScriptIntoLines, POSITION_IS_STABLE
 *
 * WHAT:  A whole script's blocks as an ordered list of lines.
 * WHY:   Positions are assigned across the WHOLE script, not per block, so a
 *        line's position is its place in the finished narration. Numbering per
 *        block and sorting later would make two blocks' line 0 collide, and
 *        the sort would then depend on the block order being carried
 *        alongside — which is the thing positions exist to avoid.
 * WHERE: The TTS workflow's first step.
 */
export function splitScriptIntoLines(
  blocks: readonly {
    id: string;
    narrationText: string;
    speakerTag?: string | null;
  }[],
  options: { defaultSpeakerTag?: string } = {},
): LineDraft[] {
  const defaultTag = options.defaultSpeakerTag ?? "narrator";
  const lines: LineDraft[] = [];

  for (const block of blocks) {
    /* A block with no speaker is the single-narrator case, which is every
     * project until Phase 12 splits a thread into roles. Defaulting here
     * rather than at the call site means the tag is never empty, and
     * `validateAssignments` has something to report against. */
    const tag =
      block.speakerTag !== null &&
      block.speakerTag !== undefined &&
      block.speakerTag.trim().length > 0
        ? block.speakerTag.trim()
        : defaultTag;

    for (const text of splitBlockIntoLines(block.narrationText)) {
      lines.push({
        position: lines.length,
        speakerTag: tag,
        text,
        blockId: block.id,
      });
    }
  }

  return lines;
}

/**
 * SOURCE OF TRUTH KEYWORDS: splitBlockIntoLines, SPLIT_ON_SENTENCES,
 *   KEEP_SHORT_FRAGMENTS_TOGETHER
 *
 * WHAT:  One block's text as one or more lines.
 *
 * WHY:   SPLIT_ON_SENTENCES, and only on sentences. Splitting on a character
 *        count would cut mid-clause, and a clause synthesised alone gets the
 *        intonation of a complete thought — the join is audible.
 *
 *        KEEP_SHORT_FRAGMENTS_TOGETHER: sentences are accumulated until adding
 *        the next would exceed the cap, so a block of four short sentences
 *        stays one line rather than becoming four provider calls with four
 *        separate takes. A trailing fragment below `LINE_MIN_CHARS` is merged
 *        back into the previous line for the same reason — "Yes." is not worth
 *        a recording of its own, and as its own line it is synthesised without
 *        the sentence it answers.
 *
 *        A single sentence longer than the cap is NOT split. There is no safe
 *        place to cut it, and the provider handles a long sentence far better
 *        than this would handle an arbitrary break.
 * WHERE: splitScriptIntoLines, and `line.resynth` when one block changes.
 */
export function splitBlockIntoLines(text: string): string[] {
  const normalised = text.trim().replace(/\s+/g, " ");
  if (normalised.length === 0) return [];
  if (normalised.length <= LINE_MAX_CHARS) return [normalised];

  const sentences = splitIntoSentences(normalised);
  const lines: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length === 0) {
      current = sentence;
      continue;
    }

    const candidate = `${current} ${sentence}`;
    if (candidate.length <= LINE_MAX_CHARS) {
      current = candidate;
    } else {
      lines.push(current);
      current = sentence;
    }
  }

  if (current.length > 0) lines.push(current);

  /* KEEP_SHORT_FRAGMENTS_TOGETHER — a trailing scrap is merged back, because
   * a two-word line is a provider call for something that belongs to the
   * sentence before it. Only the LAST one needs this: every earlier line was
   * closed because the next sentence did not fit, so it is already near the
   * cap. */
  if (lines.length > 1) {
    const last = lines[lines.length - 1] ?? "";
    const previous = lines[lines.length - 2] ?? "";
    if (last.length < LINE_MIN_CHARS) {
      lines.splice(lines.length - 2, 2, `${previous} ${last}`);
    }
  }

  return lines;
}

/**
 * SOURCE OF TRUTH KEYWORDS: splitIntoSentences, ABBREVIATIONS_ARE_NOT_ENDS
 *
 * WHAT:  Breaks text at sentence boundaries.
 *
 * WHY:   ABBREVIATIONS_ARE_NOT_ENDS. The naive rule — split on `.`, `!`, `?` —
 *        cuts "Dr. Chen" and "approximately 4.2 billion" in half, and both
 *        halves are then synthesised as separate thoughts. A speaker saying
 *        "Dr" and then, after a pause, "Chen said" is immediately audible as
 *        broken.
 *
 *        So a boundary requires the punctuation to be followed by whitespace
 *        and a capital (or a quote), and the token before it must not be a
 *        known abbreviation or a bare number. That is not a full sentence
 *        tokeniser and does not need to be: the cost of a missed boundary is
 *        one slightly longer line, while the cost of a false one is an audible
 *        break — so the rule is deliberately conservative.
 * WHERE: splitBlockIntoLines.
 */
function splitIntoSentences(text: string): string[] {
  /* Titles and common abbreviations whose trailing dot is not a sentence end.
   * Short list on purpose — each entry earns its place by appearing in
   * narration, and a long list is a maintenance burden for a rule that is
   * already conservative. */
  const abbreviations = new Set([
    "mr",
    "mrs",
    "ms",
    "dr",
    "prof",
    "sr",
    "jr",
    "st",
    "vs",
    "etc",
    "inc",
    "ltd",
    "co",
    "approx",
    "no",
    "fig",
    "al",
  ]);

  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char !== "." && char !== "!" && char !== "?") continue;

    /* Run of terminal punctuation — "?!" ends once, not twice. */
    let end = i;
    while (
      end + 1 < text.length &&
      (text[end + 1] === "." || text[end + 1] === "!" || text[end + 1] === "?")
    ) {
      end += 1;
    }

    const after = text[end + 1];
    /* End of input is a boundary; otherwise the next character must be a
     * space, or this is a decimal point or an ellipsis inside a word. */
    if (after !== undefined && after !== " ") {
      i = end;
      continue;
    }

    /* What follows the space has to look like a new sentence. Lowercase after
     * a dot is far more likely to be an abbreviation than a sentence start. */
    const next = text[end + 2];
    if (
      after === " " &&
      next !== undefined &&
      next !== next.toUpperCase() &&
      next !== '"' &&
      next !== "'"
    ) {
      i = end;
      continue;
    }

    /* The word before the dot. A bare number ("4.2") or a known abbreviation
     * is not an ending. */
    const candidate = text.slice(start, i);
    const lastWord = candidate.split(" ").pop() ?? "";
    const bare = lastWord.replace(/[^A-Za-z0-9]/g, "").toLowerCase();

    if (char === "." && (abbreviations.has(bare) || /^\d+$/.test(bare))) {
      i = end;
      continue;
    }

    const sentence = text.slice(start, end + 1).trim();
    if (sentence.length > 0) sentences.push(sentence);
    start = end + 1;
    i = end;
  }

  const tail = text.slice(start).trim();
  if (tail.length > 0) sentences.push(tail);

  return sentences;
}
