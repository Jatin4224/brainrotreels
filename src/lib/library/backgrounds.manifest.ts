/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: BACKGROUND_MANIFEST, findManifestEntry,
 *   manifestEntriesFor, MANIFEST_IS_EMPTY_ON_PURPOSE, MANIFEST_IS_THE_REVIEW,
 *   LICENSING_IS_AN_OWNER_DECISION, BackgroundManifestEntry
 *
 * WHAT:  The curated library's catalogue, declared as data: every background
 *        loop, music bed and sound effect the operator serves to every
 *        workspace, with the licence each one is served under.
 *
 * WHY:   MANIFEST_IS_EMPTY_ON_PURPOSE, and this is the single most important
 *        thing to understand about this file.
 *
 *        The array below is empty. It is not unfinished, and filling it with
 *        plausible-looking rows would be the bug. Phase 11 opens by requiring
 *        that the gameplay-footage LICENSING POSITION be settled by the owner
 *        before anything is seeded — architecture.md names it the largest
 *        non-technical risk in the product — and that decision cannot be made
 *        in code. Footage from commercial games is copyrighted, and
 *        redistributing it inside videos customers then monetise is not
 *        covered by the fact that everyone on TikTok does it. The three
 *        defensible positions are footage recorded by the operator under a
 *        specific game's content policy, commissioned original loops, or
 *        licensed abstract loops whose terms EXPLICITLY permit end-user
 *        publication and monetisation. Most stock music licences do not permit
 *        the last of those, which is why the audio kinds are held to the same
 *        bar.
 *
 *        So the phase's instruction is taken literally: the MECHANISM is built
 *        — the gate, the picker, the licence column, the looping, the ingest,
 *        the CDN serving — and the CATALOGUE is left thin. The same decision
 *        `voices.sync` recorded for the voice catalogue
 *        (PREVIEWS_ARE_A_SEPARATE_PASS / "there is no seed file,
 *        deliberately"): a hand-written list of URLs and licence sentences
 *        nobody has verified would be a fiction, and a fiction in a licence
 *        column is the one kind this product cannot afford. An empty catalogue
 *        makes the picker show the styled backdrop and the customer's own
 *        uploads, which is a working product. A catalogue of invented licences
 *        makes it a liability.
 *
 *        MANIFEST_IS_THE_REVIEW. Adding a row here is a code change that a
 *        person reads, and that is the only path by which a library asset
 *        comes into existence — there is no seed script and no admin upload
 *        form. That is what entitles the ingest to mark a library asset
 *        `approved` instead of holding it for the visual review a customer's
 *        upload is held for (MODERATION_IS_PARTIAL in
 *        src/inngest/functions/asset-ingest.ts): the human review already
 *        happened, in the diff.
 *
 *        Every row is PARSED at module scope rather than merely typed, so a
 *        row whose licence column repeats the schema default, or whose key
 *        collides with another, fails the build rather than reaching a
 *        customer's video (LICENCE_IS_NOT_OPTIONAL in
 *        src/lib/types/background.ts).
 *
 * HOW TO ADD A ROW once the licensing position is settled:
 *
 *   1. Write the position down — in `docs/phases/PROGRESS.md`, where the open
 *      owner decisions are tracked.
 *   2. Add an entry below. `license` is the real terms, in full: the
 *      instrument and what it permits. "owned", "CC0" and "fair use" are all
 *      refused by the schema.
 *   3. `sourceUrl` is fetched exactly once, by the library ingest workflow.
 *      Nothing renders from it, so a link that rots afterwards is harmless.
 *   4. `minPlan` gates the row. A row every plan may use is `free`.
 *   5. Call `backgroundLibrary.sync` as the portal workspace, `dryRun: true`
 *      first. There is no screen for it yet, the same as `voices.sync`.
 *
 * WHERE: Read by src/services/backgrounds.service.ts (the sync) and
 *        src/inngest/functions/library-ingest.ts (the fetch). Pure — no I/O,
 *        no `server-only` — so the discipline above is unit-testable.
 */

import {
  backgroundManifestSchema,
  type BackgroundManifestEntry,
} from "@/lib/types/background";

/**
 * SOURCE OF TRUTH KEYWORDS: BACKGROUND_MANIFEST, MANIFEST_IS_EMPTY_ON_PURPOSE
 *
 * The catalogue. Empty until the licensing position is settled — see the file
 * header, which explains at length why that is a decision rather than a gap.
 *
 * Parsed, not cast: `backgroundManifestSchema` refuses a placeholder licence
 * and a duplicate key, and parsing at module scope means a bad row cannot be
 * imported at all.
 */
export const BACKGROUND_MANIFEST: readonly BackgroundManifestEntry[] =
  backgroundManifestSchema.parse([
    /* Add rows here. See "HOW TO ADD A ROW" in the file header. */
  ]);

/**
 * SOURCE OF TRUTH KEYWORDS: findManifestEntry
 *
 * WHAT:  One manifest row by its stable key.
 * WHY:   The library ingest workflow is handed a key across the queue and has
 *        to resolve it on the far side — the manifest is code and must not
 *        travel in an event payload (SMALL_STEP_PAYLOADS), and an entry whose
 *        licence has since been corrected must be re-read rather than replayed
 *        from a stale copy.
 * WHERE: src/inngest/functions/library-ingest.ts.
 */
export function findManifestEntry(
  key: string,
): BackgroundManifestEntry | undefined {
  return BACKGROUND_MANIFEST.find((entry) => entry.key === key);
}

/**
 * SOURCE OF TRUTH KEYWORDS: manifestEntriesFor
 *
 * WHAT:  The rows a sync should touch: the named keys, or all of them.
 * WHY:   Returns the UNKNOWN keys alongside the matches rather than silently
 *        dropping them. An operator who mistypes a key in a targeted sync and
 *        is told "0 created, 0 updated" has no way to tell that from a sync
 *        that had nothing to do.
 * WHERE: `backgroundLibrary.sync`.
 */
export function manifestEntriesFor(keys?: readonly string[]): {
  entries: readonly BackgroundManifestEntry[];
  unknownKeys: readonly string[];
} {
  if (keys === undefined || keys.length === 0) {
    return { entries: BACKGROUND_MANIFEST, unknownKeys: [] };
  }

  const wanted = new Set(keys);
  const entries = BACKGROUND_MANIFEST.filter((entry) => wanted.has(entry.key));
  const known = new Set(entries.map((entry) => entry.key));

  return {
    entries,
    unknownKeys: [...wanted].filter((key) => !known.has(key)),
  };
}
