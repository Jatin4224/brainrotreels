/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: mapProviderLabels, CATALOGUE_SYNC,
 *   LOSSY_BY_DESIGN, OTHER_IS_HONEST, MAPPING_IS_PURE
 *
 * WHAT:  Turns a provider's free-text voice labels into this app's closed
 *        descriptive enums.
 *
 * WHY:   LOSSY_BY_DESIGN, and that is the decision rather than a shortcoming.
 *        A provider labels its voices with whatever its catalogue team typed —
 *        "Received Pronunciation", "General American", "middle-aged", "raspy".
 *        Surfacing that directly would give the picker thirty filter options
 *        for forty voices, at which point filtering stops narrowing anything.
 *        So the labels are mapped onto a handful of axes a person can actually
 *        browse by.
 *
 *        OTHER_IS_HONEST. Anything that does not match falls to `other` or to
 *        a neutral default, NEVER to a plausible-looking guess. A voice
 *        mislabelled `british` because the mapper reached for the nearest
 *        option is worse than one labelled `other`: the customer filters for
 *        British, gets it, and hears something else. `other` is visibly
 *        unhelpful, which is the right kind of wrong — and the operator can
 *        correct it, because the sync never overwrites a descriptive axis
 *        after creation (SYNC_PRESERVES_OPERATOR_EDITS).
 *
 *        MAPPING_IS_PURE — no provider call, no database. The sync is the only
 *        caller and it is otherwise untestable without a key, so keeping the
 *        interesting half pure is what lets the mapping be checked at all.
 * WHERE: `voices.sync`.
 */

import type { VoiceAccent, VoiceGender, VoiceTone } from "@/lib/types/voice";

export interface MappedVoiceLabels {
  gender: VoiceGender;
  accent: VoiceAccent;
  tone: VoiceTone;
}

/**
 * Substring matches, checked in order. Ordering matters where one term
 * contains another — "american" appears inside "african american", so the more
 * specific entry has to be tested first or every African-American voice is
 * labelled American.
 */
const ACCENT_PATTERNS: readonly [string, VoiceAccent][] = [
  ["african", "african"],
  ["nigeria", "african"],
  ["south africa", "african"],
  ["irish", "irish"],
  ["ireland", "irish"],
  ["scottish", "british"],
  ["welsh", "british"],
  ["british", "british"],
  ["england", "british"],
  ["english (uk)", "british"],
  ["received pronunciation", "british"],
  ["australian", "australian"],
  ["aussie", "australian"],
  ["new zealand", "australian"],
  ["indian", "indian"],
  ["india", "indian"],
  ["american", "american"],
  ["america", "american"],
  ["canadian", "american"],
  ["transatlantic", "american"],
  ["german", "european"],
  ["french", "european"],
  ["italian", "european"],
  ["spanish", "european"],
  ["swedish", "european"],
  ["polish", "european"],
  ["dutch", "european"],
  ["european", "european"],
];

const GENDER_PATTERNS: readonly [string, VoiceGender][] = [
  ["female", "female"],
  ["woman", "female"],
  ["male", "male"],
  ["man", "male"],
  ["neutral", "neutral"],
  ["non-binary", "neutral"],
  ["androgynous", "neutral"],
];

const TONE_PATTERNS: readonly [string, VoiceTone][] = [
  ["warm", "warm"],
  ["friendly", "warm"],
  ["soft", "warm"],
  ["pleasant", "warm"],
  ["energetic", "energetic"],
  ["excited", "energetic"],
  ["upbeat", "energetic"],
  ["hyped", "energetic"],
  ["calm", "calm"],
  ["relaxed", "calm"],
  ["soothing", "calm"],
  ["meditative", "calm"],
  ["authoritative", "authoritative"],
  ["confident", "authoritative"],
  ["serious", "authoritative"],
  ["news", "authoritative"],
  ["deep", "authoritative"],
  ["dramatic", "dramatic"],
  ["intense", "dramatic"],
  ["emotional", "dramatic"],
  ["narration", "dramatic"],
  ["conversational", "conversational"],
  ["casual", "conversational"],
  ["natural", "conversational"],
];

/**
 * SOURCE OF TRUTH KEYWORDS: mapProviderLabels
 *
 * WHAT:  The best available mapping of one voice's labels.
 * WHY:   Every label VALUE is searched, not just the ones under expected keys.
 *        Providers move this information around — an accent can arrive under
 *        `accent`, `description` or `use_case` depending on who entered it —
 *        and keying on a specific field means a catalogue that maps correctly
 *        today and silently stops when the provider reorganises.
 *
 *        `male` is checked after `female` in the gender table for the
 *        substring reason above: "female" contains "male".
 * WHERE: `voices.sync`, once per voice.
 */
export function mapProviderLabels(
  labels: Record<string, string>,
): MappedVoiceLabels {
  /* One lowercase haystack of every value, so a term is found wherever the
   * provider happened to put it. Keys are included too — some providers
   * encode the axis in the key and the value is just "true". */
  const haystack = Object.entries(labels)
    .map(([key, value]) => `${key} ${value}`)
    .join(" ")
    .toLowerCase();

  return {
    gender: firstMatch(haystack, GENDER_PATTERNS) ?? "neutral",
    accent: firstMatch(haystack, ACCENT_PATTERNS) ?? "other",
    /* `conversational` rather than `other` — there is no `other` tone, and
     * conversational is the least committal of the six: a voice wrongly
     * labelled conversational is unremarkable, whereas one wrongly labelled
     * dramatic is actively misleading. */
    tone: firstMatch(haystack, TONE_PATTERNS) ?? "conversational",
  };
}

function firstMatch<T>(
  haystack: string,
  patterns: readonly [string, T][],
): T | null {
  for (const [needle, value] of patterns) {
    if (haystack.includes(needle)) return value;
  }
  return null;
}
