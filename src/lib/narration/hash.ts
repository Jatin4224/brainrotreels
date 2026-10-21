/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: narrationTextHash, TEXT_HASH_COVERS_THE_VOICE,
 *   NARRATION_CACHE_KEY, NORMALISE_BEFORE_HASHING, HASH_IS_PURE
 *
 * WHAT:  The cache key that decides whether a line has to be synthesised
 *        again or can reuse audio that already exists.
 *
 * WHY:   TEXT_HASH_COVERS_THE_VOICE, and this is the whole point. The phase
 *        asks for `hash(text + voiceId)`, not `hash(text)`, because the same
 *        words in a different voice are a DIFFERENT RECORDING. A hash of the
 *        text alone hands a customer the previous speaker's audio the moment
 *        they change the cast — and nothing errors, because the cache hit is
 *        a legitimate row with real audio behind it. The video simply comes
 *        out in the wrong voice.
 *
 *        It is the same class of mistake as Phase 04's render cache key being
 *        `hashDoc(doc)` alone, which shipped and had to be fixed: a key that
 *        describes the INPUT rather than the OUTPUT looks right and is wrong
 *        in exactly the cases that cost money or trust.
 *
 *        NORMALISE_BEFORE_HASHING: whitespace is collapsed and the text is
 *        trimmed before hashing, so an edit that only moves a line break does
 *        not spend a provider call. What is NOT normalised is case or
 *        punctuation — both change how a line is spoken, and a cache that
 *        ignored them would return "stop." for "Stop!".
 *
 *        HASH_IS_PURE, and FNV-1a rather than SHA-256 for the same reason
 *        `hashDoc` is: this module must be importable anywhere, `node:crypto`
 *        is not, and WebCrypto's digest is async — which would make hashing
 *        impossible from a synchronous split. It is a cache key, not a
 *        security boundary.
 * WHERE: Every write of `NarrationLine.textHash`, and the cache lookup before
 *        synthesis.
 */

/* FNV-1a, 64-bit. The constants are the algorithm's, not arbitrary — the same
 * implementation as src/lib/timeline/hash.ts, kept separate because that
 * module is fenced against importing anything and this one has no business
 * reaching into it. */
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * SOURCE OF TRUTH KEYWORDS: narrationTextHash, NARRATION_CACHE_KEY
 *
 * WHAT:  Sixteen hex characters identifying one line's audio.
 * WHY:   The voice is folded in with a separator that cannot appear in a cuid
 *        or in normalised text, so `("ab", "c")` and `("a", "bc")` cannot
 *        collide — a separator-free concatenation is the classic way to make
 *        two different inputs hash identically.
 *
 *        An UNASSIGNED voice hashes as the literal `none`, which is
 *        deliberate: those lines are never synthesised (generation is blocked
 *        while a speaker is unassigned), but they still need a stable hash so
 *        the row can be written and compared before the cast is chosen.
 * WHERE: See the file header.
 */
export function narrationTextHash(
  text: string,
  voiceId: string | null | undefined,
): string {
  const normalised = normaliseForHash(text);
  const voice =
    voiceId !== null && voiceId !== undefined && voiceId.length > 0
      ? voiceId
      : "none";

  /* The separator is a unit separator (U+001F) — it cannot occur in a cuid,
   * and `normaliseForHash` has already stripped control characters from the
   * text, so it cannot occur there either. */
  return fnv1a64(`${normalised}\u001f${voice}`);
}

/**
 * SOURCE OF TRUTH KEYWORDS: normaliseForHash, NORMALISE_BEFORE_HASHING
 *
 * WHAT:  The form of the text that actually gets hashed.
 * WHY:   Collapses whitespace and trims, so reflowing a paragraph is free.
 *        Deliberately does NOT touch case or punctuation — both change the
 *        delivery, and a cache that ignored them would hand back the wrong
 *        reading.
 *
 *        Control characters are stripped because they are invisible in an
 *        editor, survive a copy-paste, and would otherwise make two lines that
 *        look identical hash differently — a cache miss nobody can see the
 *        cause of.
 * WHERE: narrationTextHash.
 */
export function normaliseForHash(text: string): string {
  return text
    /* Stripping invisible characters is the point: they survive a copy-paste,
       are invisible in an editor, and would otherwise make two identical-
       looking lines hash differently — a cache miss with no visible cause. */
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fnv1a64(value: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}
