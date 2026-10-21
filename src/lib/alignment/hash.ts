/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: alignmentAudioHash, AUDIO_HASH_COVERS_EVERY_LINE,
 *   CACHE_BY_AUDIO, ALIGNMENT_CACHE_KEY, HASH_IS_PURE
 *
 * WHAT:  The cache key that decides whether an alignment has to be paid for
 *        again.
 *
 * WHY:   CACHE_BY_AUDIO is the phase's step 3: "a cache hit must skip the
 *        provider entirely". The key therefore has to describe THE AUDIO THAT
 *        WAS ALIGNED, and nothing else — not the style, not the document, not
 *        the project's updatedAt. Each of those would invalidate an alignment
 *        every time somebody changed a colour, and re-alignment is billed per
 *        minute of audio.
 *
 *        AUDIO_HASH_COVERS_EVERY_LINE, in ORDER. The narration is a sequence
 *        of recordings, so the hash folds in each line's `textHash` — which
 *        already covers that line's text AND its voice
 *        (TEXT_HASH_COVERS_THE_VOICE) — plus its position. Position matters:
 *        the same sentences re-ordered are the same set of files and a
 *        different narration, and an alignment keyed only on the set would be
 *        reused with every word at the wrong second.
 *
 *        It deliberately does NOT fold in the measured durations. They are
 *        derived from the same audio, so they add nothing a change of audio
 *        would not already change — and a float in a cache key is a cache
 *        that misses on a re-measurement that rounded differently.
 *
 *        HASH_IS_PURE, FNV-1a, for the same reason as the narration and
 *        timeline hashes: `node:crypto` would make this module unimportable
 *        in a browser and WebCrypto's digest is async, which would make the
 *        key uncomputable from a synchronous code path. It is a cache key,
 *        not a security boundary.
 * WHERE: Written to `Alignment.audioHash`; compared before every provider
 *        call in the alignment service.
 */

/* FNV-1a, 64-bit — the same implementation as src/lib/narration/hash.ts and
 * src/lib/timeline/hash.ts, kept separate for the same reason they are: each
 * of those modules is fenced against importing the others. */
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * SOURCE OF TRUTH KEYWORDS: alignmentAudioHash, ALIGNMENT_CACHE_KEY
 *
 * WHAT:  Sixteen hex characters identifying one narration's audio.
 * WHY:   The separator is a unit separator (U+001F), which cannot appear in a
 *        cuid or in a hex hash, so `["ab","c"]` and `["a","bc"]` cannot
 *        collide. A separator-free concatenation is the classic way to make
 *        two different narrations hash identically — and the symptom would be
 *        one project's captions on another's audio.
 *
 *        An EMPTY narration hashes to a stable value rather than throwing:
 *        a project with no recorded lines has an alignment of no words, and
 *        that is a legitimate state to cache rather than an error.
 * WHERE: The alignment service, before and after every run.
 */
export function alignmentAudioHash(
  lines: readonly { position: number; textHash: string }[],
): string {
  const parts = lines
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((line) => `${line.position}:${line.textHash}`);

  return fnv1a64(parts.join("\u001f"));
}

function fnv1a64(value: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}
