/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: SPEAKER_CAPTION_COLORS, speakerCaptionTint,
 *   speakerLabelFor, dominantSpeaker, COLOUR_IS_NEVER_THE_ONLY_SIGNAL,
 *   COLOUR_IS_DERIVED_NOT_STORED, CONTRAST_IS_CHECKED
 *
 * WHAT:  Which colour and which name tag a caption gets when per-speaker
 *        colouring is on.
 *
 * WHY:   COLOUR_IS_NEVER_THE_ONLY_SIGNAL. This module returns a colour AND a
 *        label, together, from one function — so there is no way to use the
 *        tint without the name tag. The phase requires the pairing and the
 *        reason is not decoration: roughly one man in twelve cannot reliably
 *        distinguish two tinted captions, and for them colour alone carries no
 *        speaker attribution at all. Returning them separately would make
 *        "colour only" a one-line shortcut somebody takes under deadline.
 *
 *        COLOUR_IS_DERIVED_NOT_STORED. The colour comes from the speaker TAG
 *        through a stable hash into a fixed palette, not from a field on the
 *        document and not from a per-project setting. Three consequences, all
 *        wanted: the same speaker is the same colour in every video a workspace
 *        makes, re-generating a project cannot reshuffle the colours, and there
 *        is no new document field for an editor to have to write. A stored
 *        colour would also be one more thing a hand-edited document could
 *        contradict.
 *
 *        CONTRAST_IS_CHECKED. Captions sit over arbitrary footage, so the
 *        palette is chosen from LIGHT, highly saturated tints only — each one
 *        is tested against the same contrast rule Phase 08 applies to the
 *        caption library (`meetsContrast` in ./contrast), against the darkest
 *        background a caption is drawn on. A mid-tone colour that reads
 *        beautifully in a design tool disappears over a bright gameplay clip.
 *
 *        PURE — no React, no Remotion, no database. Which is what lets the
 *        contrast claim above be a test rather than an assertion.
 * WHERE: src/remotion/components/captions.tsx; the caption settings panel's
 *        preview.
 */

import type { WordToken } from "@/lib/timeline";
import { REDDIT_SPEAKER_LABELS } from "@/lib/types/reddit";

/**
 * SOURCE OF TRUTH KEYWORDS: SPEAKER_CAPTION_COLORS, CONTRAST_IS_CHECKED
 *
 * WHAT:  The tints a speaker's captions can take.
 * WHY:   Six, which is more speakers than any format here produces (a Reddit
 *        story has three roles) and few enough that no two are confusable. All
 *        are light and saturated, for the reason in the file header: a caption
 *        is drawn over footage nobody chose, so only the top of the lightness
 *        range survives a bright frame.
 *
 *        Ordered, and the order is load-bearing — the hash indexes into this
 *        array, so reordering it recolours every existing video. Append only.
 * WHERE: speakerCaptionTint.
 */
export const SPEAKER_CAPTION_COLORS: readonly string[] = [
  "#ffffff", // the default narrator: plain white, the Phase 08 look
  "#ffd166", // warm yellow
  "#8ecae6", // light blue
  "#b5e48c", // light green
  "#ffadad", // light red
  "#d0bfff", // light violet
];

/**
 * SOURCE OF TRUTH KEYWORDS: speakerCaptionTint, COLOUR_IS_DERIVED_NOT_STORED,
 *   NARRATOR_IS_ALWAYS_WHITE
 *
 * WHAT:  The colour and the name tag for one speaker tag.
 *
 * WHY:   NARRATOR_IS_ALWAYS_WHITE, pinned rather than hashed. The narrator is
 *        the voice in most of every video and is the default tag
 *        `splitScriptIntoLines` assigns, so tinting it would mean most captions
 *        in the product were coloured for no informational gain — the
 *        interesting signal is "somebody ELSE is talking now". Pinning it also
 *        means a single-speaker video looks exactly as it did before this
 *        feature existed.
 *
 *        Everything else hashes into the remaining colours. A simple character
 *        sum is enough: the inputs are a handful of short, stable tags, and the
 *        only property needed is that the same tag always gives the same
 *        colour. A cryptographic hash here would be precision nobody consumes.
 *
 *        The LABEL prefers the Reddit role names (`OP`, `Reply`) and falls back
 *        to the tag itself, title-cased — so a format with its own tags gets a
 *        readable tag for free rather than a blank.
 * WHERE: The caption card, when the track asks for speaker colours.
 */
export function speakerCaptionTint(tag: string): {
  color: string;
  label: string;
} {
  const label = speakerLabelFor(tag);

  const normalized = tag.trim().toLowerCase();
  if (normalized === "narrator" || normalized.length === 0) {
    return { color: SPEAKER_CAPTION_COLORS[0] ?? "#ffffff", label };
  }

  let sum = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    sum += normalized.charCodeAt(i);
  }

  /* Skips index 0, which is reserved for the narrator — otherwise a hashed
   * speaker could land on white and lose its signal entirely. */
  const span = SPEAKER_CAPTION_COLORS.length - 1;
  const index = span > 0 ? 1 + (sum % span) : 0;

  return {
    color: SPEAKER_CAPTION_COLORS[index] ?? "#ffffff",
    label,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: speakerLabelFor
 *
 * WHAT:  What a speaker tag is called on screen.
 * WHY:   The Reddit roles have proper names (`OP` rather than `op`), and
 *        anything else is title-cased from the tag — which is both readable and
 *        honest about where it came from. Capped, because a tag is an id and a
 *        long one would push the caption's own text off the card.
 * WHERE: speakerCaptionTint.
 */
export function speakerLabelFor(tag: string): string {
  const normalized = tag.trim();
  if (normalized.length === 0) return "";

  const known = Object.entries(REDDIT_SPEAKER_LABELS).find(
    ([key]) => key === normalized.toLowerCase(),
  );
  if (known !== undefined) return known[1];

  const titled = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return titled.slice(0, 14);
}

/**
 * SOURCE OF TRUTH KEYWORDS: dominantSpeaker, ONE_TAG_PER_CARD
 *
 * WHAT:  Whose caption this card is, from the words on it.
 *
 * WHY:   ONE_TAG_PER_CARD. A caption groups three or four words and is drawn in
 *        ONE colour, but a card can straddle a speaker change — the grouping is
 *        by word count (`groupWords`), which knows nothing about speakers. So a
 *        card needs a single answer, and the honest one is the MAJORITY: the
 *        speaker who said most of the words on it.
 *
 *        Ties go to the FIRST word, because a card that starts with the new
 *        speaker reads as theirs — a viewer attributes a caption to whoever
 *        began it.
 *
 *        Returns null when no word carries a speaker, which is every document
 *        produced before Phase 08 started tagging them and every degraded
 *        alignment. The caller then draws the caption exactly as it always did.
 * WHERE: The caption card, when the track asks for speaker colours.
 */
export function dominantSpeaker(words: readonly WordToken[]): string | null {
  const counts = new Map<string, number>();

  for (const word of words) {
    if (word.speaker === undefined || word.speaker.length === 0) continue;
    counts.set(word.speaker, (counts.get(word.speaker) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  const firstTagged = words.find(
    (word) => word.speaker !== undefined && word.speaker.length > 0,
  )?.speaker;

  let best = firstTagged ?? null;
  let bestCount = best === null ? 0 : (counts.get(best) ?? 0);

  for (const [tag, count] of counts) {
    if (count > bestCount) {
      best = tag;
      bestCount = count;
    }
  }

  return best;
}
