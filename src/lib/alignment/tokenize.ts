/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: tokenizeScript, normaliseToken, ScriptToken,
 *   TOKENS_KEEP_THEIR_PUNCTUATION, MATCH_ON_THE_NORMALISED_FORM
 *
 * WHAT:  Splits a line of script into the words a caption will show, each
 *        carrying both the form the customer wrote and a flattened form for
 *        matching.
 *
 * WHY:   TOKENS_KEEP_THEIR_PUNCTUATION, and this is the whole reason the
 *        reconciliation exists. The caption must read `AITA, my landlord...`
 *        — the customer's capitals, the customer's comma — while the match
 *        against the transcript has to work on `aita` versus `ay eye tee ay`.
 *        Two forms of the same token, carried together, is what lets the
 *        matcher be case- and punctuation-blind without the OUTPUT being so.
 *        Stripping punctuation from the displayed word would also break the
 *        caption chunker, which breaks cards on punctuation.
 *
 *        MATCH_ON_THE_NORMALISED_FORM: lower-cased, diacritics folded,
 *        anything that is not a letter or a digit removed. Numbers are left
 *        as digits rather than spelled out — the aligner's "twenty twenty
 *        four" against a script's "2024" is handled by the matcher's
 *        many-to-one merge, not here, because spelling numbers out is
 *        language-specific and this module is not.
 * WHERE: reconcileToScript, and the degrade path, which needs the same
 *        tokens with no transcript at all.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: ScriptToken
 *
 * WHAT:  One word of the script.
 * WHY:   `norm` can be EMPTY — a token that is nothing but punctuation, such
 *        as a lone em dash. Those are kept rather than dropped, because
 *        dropping one shifts every later word index by one and the document's
 *        word anchors are indices. An empty `norm` simply never matches.
 * WHERE: tokenizeScript.
 */
export interface ScriptToken {
  /** Exactly as the customer wrote it, punctuation and case included. */
  raw: string;
  /** Lower-cased and stripped, for matching only. */
  norm: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: tokenizeScript
 *
 * WHAT:  The script line as display tokens.
 * WHY:   Splits on WHITESPACE only. Splitting on punctuation as well was the
 *        alternative and it breaks `Dr.`, `4.2`, `don't` and every hyphenated
 *        word into fragments that are then captioned as separate words — the
 *        same class of mistake the narration splitter is careful about, one
 *        layer down.
 * WHERE: reconcileToScript, distributeEvenly.
 */
export function tokenizeScript(text: string): ScriptToken[] {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .split(/\s+/)
    .filter((raw) => raw.length > 0)
    .map((raw) => ({ raw, norm: normaliseToken(raw) }));
}

/**
 * SOURCE OF TRUTH KEYWORDS: normaliseToken, MATCH_ON_THE_NORMALISED_FORM
 *
 * WHAT:  The comparable form of a word.
 * WHY:   Diacritics are folded with NFD so `café` and `cafe` match — an
 *        aligner's transcript is frequently unaccented, and a mismatch there
 *        would drop the word out of the alignment and interpolate a timing
 *        for a word that was perfectly well heard.
 * WHERE: tokenizeScript; the matcher compares these.
 */
export function normaliseToken(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
