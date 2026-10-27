/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AVATAR_MANIFEST, findAvatarEntry,
 *   MANIFEST_IS_EMPTY_ON_PURPOSE, LIKENESS_IS_ATTESTED, MANIFEST_IS_THE_REVIEW,
 *   AvatarManifestEntry
 *
 * WHAT:  The character catalogue, declared as data: every illustrated avatar a
 *        speaker can be given, and where its artwork came from.
 *
 * WHY:   MANIFEST_IS_EMPTY_ON_PURPOSE, and for a different reason from the
 *        background manifest's — which is worth being clear about, because the
 *        two files look alike.
 *
 *        Backgrounds are empty because a licensing POSITION has to be settled
 *        by the owner first. Avatars are empty because the artwork does not
 *        exist: Phase 12 requires "original illustrated characters only", three
 *        drawn frames each, and nobody has drawn them. There is no honest way
 *        for code to produce them, and a row pointing at artwork that is not
 *        there would fail its ingest and sit `failed` in the catalogue
 *        forever.
 *
 *        LIKENESS_IS_ATTESTED is what this file enforces in the meantime, and
 *        it is the half that matters most. NO REAL-PERSON LIKENESSES AND NO
 *        THIRD-PARTY CHARACTERS, EVER — the phase states it as a legal position
 *        and the reason is that a likeness-rights claim is not a bug you can
 *        patch. No schema can look at a PNG and tell whose face it is, so every
 *        row must carry a written `provenance` statement and the schema refuses
 *        the words people type when they have not checked. The real review is a
 *        person reading the diff; this stops a row existing without anyone
 *        having written down what they verified.
 *
 *        The artwork is NOT a special asset path. It goes through the Phase 11
 *        library pipeline — the background manifest declares the three frames
 *        as `kind: 'avatar'` entries, the library sync fetches and ingests them
 *        into `library/avatars/…`, and the avatar sync then resolves those
 *        manifest keys to Asset ids. Two syncs in that order, because the
 *        second needs the ids the first mints.
 *
 * HOW TO ADD A CHARACTER:
 *
 *   1. Commission or draw three frames: neutral, talking, reaction. Vertical,
 *      transparent PNG. The overlay draws them at the same size, so they must
 *      be registered — a talking frame offset by twenty pixels reads as a jump.
 *   2. Add three entries to BACKGROUND_MANIFEST with `kind: 'avatar'`, one per
 *      frame, each with its real licence string.
 *   3. Add one entry here naming those three manifest keys, with a
 *      `provenance` statement that says who drew them and confirms they depict
 *      nobody real and nothing third-party.
 *   4. Run `backgroundLibrary.sync`, then `avatars.sync`. In that order.
 *
 * WHERE: Read by src/services/avatars.service.ts (the sync). Pure — no I/O, no
 *        `server-only` — so the discipline above is unit-testable.
 */

import {
  avatarManifestSchema,
  type AvatarManifestEntry,
} from "@/lib/types/avatar";

/**
 * SOURCE OF TRUTH KEYWORDS: AVATAR_MANIFEST, MANIFEST_IS_EMPTY_ON_PURPOSE
 *
 * The catalogue. Empty until the artwork is commissioned — see the file
 * header, which explains why that is a gap in the ARTWORK rather than in the
 * code.
 *
 * Parsed, not cast: `avatarManifestSchema` refuses a placeholder provenance
 * and a duplicate key, and parsing at module scope means a bad row cannot be
 * imported at all.
 */
export const AVATAR_MANIFEST: readonly AvatarManifestEntry[] =
  avatarManifestSchema.parse([
    /* Add characters here. See "HOW TO ADD A CHARACTER" in the file header. */
  ]);

/**
 * SOURCE OF TRUTH KEYWORDS: findAvatarEntry
 *
 * WHAT:  One character by its stable key.
 * WHY:   The same reason `findManifestEntry` exists: a sync resolves keys on
 *        the far side of a boundary and must re-read the manifest rather than
 *        replay a copy of it.
 * WHERE: src/services/avatars.service.ts.
 */
export function findAvatarEntry(key: string): AvatarManifestEntry | undefined {
  return AVATAR_MANIFEST.find((entry) => entry.key === key);
}
