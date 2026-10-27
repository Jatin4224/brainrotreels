/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: BACKGROUND_ASSET_KINDS, backgroundAssetKindSchema,
 *   BackgroundAssetKind, backgroundAvailableOnPlan, BackgroundManifestEntry,
 *   backgroundManifestEntrySchema, licenseKindSchema, BackgroundLicenseKind,
 *   isPlaceholderLicense, PLACEHOLDER_LICENSES, listBackgroundsSchema,
 *   applyBackgroundSchema, syncBackgroundLibrarySchema, BACKGROUND_PAGE_SIZE,
 *   LICENSE_TERMS_ARE_NOT_A_CATEGORY, LICENCE_IS_NOT_OPTIONAL
 *
 * WHAT:  The validated vocabulary of the background library — which asset kinds
 *        belong in it, how a row's `minPlan` is compared against a workspace's
 *        plan, what a manifest row has to be able to answer about its own
 *        licence, and the zod input schema for every `backgroundLibrary.*`
 *        procedure.
 *
 * WHY:   LICENSE_TERMS_ARE_NOT_A_CATEGORY, and this is the distinction the
 *        whole module exists to hold. `Asset.license` is a free `String`
 *        column and carries the ACTUAL TERMS — "CC0 1.0 Universal, no
 *        attribution required"; "Recorded by us under <game>'s content
 *        policy, 2026-01" — because the only question an operator ever has
 *        about a library row is "where did this come from and what does its
 *        licence permit", and a five-value enum cannot answer it. The timeline
 *        document's `AssetRef.license` is a different field with a different
 *        job: a closed CATEGORY that a render can be refused on months later
 *        without re-reading anybody's terms. Every manifest row therefore
 *        carries the TERMS, and the category is derived from the asset's
 *        `source` by `licenseCategoryForSource` below — never parsed out of
 *        the prose, because deciding whether a video may be published by
 *        pattern-matching an English sentence is not a thing this product
 *        should ever do.
 *
 *        LICENCE_IS_NOT_OPTIONAL. `Asset.license` DEFAULTS to `"owned"` in the
 *        schema, which is correct for a customer's own upload and is a lie for
 *        a library row. So the manifest schema refuses the default, the empty
 *        string, and the handful of words people type when they mean "I have
 *        not checked yet" — see PLACEHOLDER_LICENSES. This is the one place
 *        the product's largest non-technical risk (gameplay-footage licensing,
 *        architecture.md) is enforceable by a machine, and a row that cannot
 *        state its terms is refused at the schema rather than caught in
 *        review.
 *
 *        STRING_NOT_ENUM throughout, the same reason as ./asset: `Asset.kind`,
 *        `.source` and `.minPlan` are Prisma `String` columns.
 * WHERE: src/lib/library/backgrounds.manifest.ts,
 *        src/services/backgrounds.service.ts,
 *        src/trpc/routers/backgrounds.ts,
 *        src/components/global/background-picker/. Re-exported from
 *        src/lib/types.
 */

import { z } from "zod";

import { PLAN_KEYS, type PlanKey } from "@/lib/config/plans";
import {
  assetFilenameSchema,
  assetSourceSchema,
  uploadContentTypeSchema,
  type AssetSource,
} from "./asset";

/**
 * SOURCE OF TRUTH KEYWORDS: BACKGROUND_ASSET_KINDS, backgroundAssetKindSchema,
 *   BackgroundAssetKind, THE_PICKER_IS_A_KIND_SET
 *
 * WHAT:  The asset kinds the background picker shows.
 * WHY:   THE_PICKER_IS_A_KIND_SET, the same shape as ASSET_TABS in ./asset and
 *        for the same reason: "a background" is not one `kind` but a set of
 *        them, and enumerating that set at every call site is how a new kind
 *        gets half-supported. `ai_footage` is in the set from the start even
 *        though nothing writes it until Phase 17 — a generated clip IS a
 *        background as far as the picker is concerned, and the alternative is
 *        remembering to add it to a filter in a different phase.
 *
 *        `upload` and `image` are deliberately NOT here. They reach the picker
 *        through its own `includeUploads` switch, because they are the
 *        workspace's own media rather than the catalogue, and conflating the
 *        two would make the plan gate meaningless — a free workspace would see
 *        its own files counted against the catalogue breadth it may browse.
 * WHERE: listBackgroundsSchema's default; the service's `kind in` filter.
 */
export const BACKGROUND_ASSET_KINDS = ["background", "ai_footage"] as const;

export const backgroundAssetKindSchema = z.enum(BACKGROUND_ASSET_KINDS);

export type BackgroundAssetKind = z.infer<typeof backgroundAssetKindSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: BACKGROUND_AUDIO_KINDS, backgroundAudioKindSchema
 *
 * WHAT:  The library's audio kinds — the music beds and the sound effects.
 * WHY:   Step 9 of the phase: music and SFX follow the same shape as footage,
 *        which means the same manifest, the same licence discipline, the same
 *        ingest and the same `minPlan` gate. Kept as its own tuple rather than
 *        folded into the one above because the PICKER is different — a music
 *        bed is chosen on a different control from the thing on screen — while
 *        everything behind it is shared.
 * WHERE: backgroundManifestEntrySchema; the library sync.
 */
export const BACKGROUND_AUDIO_KINDS = ["audio_music", "sfx"] as const;

export const backgroundAudioKindSchema = z.enum(BACKGROUND_AUDIO_KINDS);

export type BackgroundAudioKind = z.infer<typeof backgroundAudioKindSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: LIBRARY_ART_KINDS, libraryArtKindSchema
 *
 * WHAT:  The library's still artwork — avatar frames, from Phase 12.
 * WHY:   A third tuple rather than an entry in either of the two above,
 *        because an avatar frame is neither a background nor audio and is
 *        never offered by the background picker. What it SHARES is everything
 *        behind the picker: the same manifest, the same ingest, the same
 *        `library/avatars/…` prefix (LIBRARY_KIND_BY_ASSET_KIND already maps
 *        it) and the same `minPlan` gate — which is the whole reason Phase 12
 *        adds a tuple here instead of a second library.
 *
 *        `image` is deliberately NOT the kind. An `image` is a customer's own
 *        upload; avatar artwork is a catalogue row with a provenance
 *        attestation behind it, and conflating them would put somebody's
 *        holiday photo in the character picker.
 * WHERE: libraryAssetKindSchema below; src/lib/library/avatars.manifest.ts.
 */
export const LIBRARY_ART_KINDS = ["avatar"] as const;

export const libraryArtKindSchema = z.enum(LIBRARY_ART_KINDS);

export type LibraryArtKind = z.infer<typeof libraryArtKindSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: libraryAssetKindSchema, LibraryAssetKind
 *
 * Everything the library may hold: footage, audio and artwork. A union of the
 * tuples rather than a fourth list, so adding a kind to any one of them
 * reaches the manifest with no second edit.
 */
export const libraryAssetKindSchema = z.union([
  backgroundAssetKindSchema,
  backgroundAudioKindSchema,
  libraryArtKindSchema,
]);

export type LibraryAssetKind = z.infer<typeof libraryAssetKindSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: licenseKindSchema, BackgroundLicenseKind,
 *   LICENSE_TERMS_ARE_NOT_A_CATEGORY
 *
 * WHAT:  The licence CATEGORY a library row carries into a timeline document.
 * WHY:   Mirrors `AssetRef.license` in src/lib/timeline/schema.ts exactly,
 *        because that is where the value ends up and a document is validated
 *        against that enum. Declared here as its own schema rather than
 *        imported from the timeline module so the manifest can be parsed
 *        without pulling the whole document schema into the graph — and a
 *        drift between the two is caught by a test that asserts the unions are
 *        identical (backgrounds.manifest.test.ts).
 *
 * WHERE: licenseCategoryForSource below; the `assets` block of a generated
 *        document.
 */
export const LICENSE_KINDS = [
  "owned",
  "licensed",
  "stock",
  "generated",
  "unknown",
] as const;

export const licenseKindSchema = z.enum(LICENSE_KINDS);

export type BackgroundLicenseKind = z.infer<typeof licenseKindSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: licenseCategoryForSource, LICENSE_CATEGORY_FROM_SOURCE,
 *   LICENSE_TERMS_ARE_NOT_A_CATEGORY
 *
 * WHAT:  The licence CATEGORY a document should carry for an asset, from where
 *        that asset came from.
 *
 * WHY:   LICENSE_CATEGORY_FROM_SOURCE. The category is derived from
 *        `Asset.source` — a closed union — and never from the `license` prose,
 *        because deciding whether a video may be published by pattern-matching
 *        an English sentence is not a thing this product should ever do. It is
 *        also not a second column: `Asset` gains no field in this phase, which
 *        the phase file asks for, and a declared-then-discarded manifest field
 *        would be exactly the decoration Phase 10 removed elsewhere.
 *
 *        `library` maps to `licensed`, and that is the one row worth
 *        justifying. Every library asset exists because an operator established
 *        terms for it in the manifest, whether those terms are CC0, a
 *        commercial licence or a commission the operator outright owns. Calling
 *        a commission `licensed` UNDERSTATES the rights we hold; it never
 *        overstates them — and for a field whose only job is to let a render be
 *        refused later, understating is the safe direction.
 *
 *        An unrecognised `source` — a string column, so reachable — maps to
 *        `unknown` rather than to `owned`. `unknown` is a value a future policy
 *        can refuse; `owned` is a claim nobody checked.
 * WHERE: `generatorContextFor` in src/services/pipeline.service.ts.
 */
const LICENSE_CATEGORY_BY_SOURCE: Readonly<
  Record<AssetSource, BackgroundLicenseKind>
> = {
  library: "licensed",
  upload: "owned",
  generated: "generated",
  stock: "stock",
};

export function licenseCategoryForSource(
  source: string,
): BackgroundLicenseKind {
  const parsed = assetSourceSchema.safeParse(source);
  return parsed.success ? LICENSE_CATEGORY_BY_SOURCE[parsed.data] : "unknown";
}

/**
 * SOURCE OF TRUTH KEYWORDS: PLACEHOLDER_LICENSES, isPlaceholderLicense,
 *   LICENCE_IS_NOT_OPTIONAL
 *
 * WHAT:  The strings that mean "nobody has established the terms yet".
 * WHY:   See LICENCE_IS_NOT_OPTIONAL in the file header. A deny-list is the
 *        wrong shape for almost every validation in this codebase and is the
 *        right shape here, because the thing being refused is not a class of
 *        input — it is the specific set of words a person writes when they are
 *        filling in a required field they have not researched. It cannot be
 *        exhaustive and does not need to be: it exists to stop the manifest
 *        from accumulating rows whose licence column repeats the schema
 *        default.
 * WHERE: backgroundManifestEntrySchema's refinement, and its test.
 */
export const PLACEHOLDER_LICENSES: readonly string[] = [
  "owned",
  "unknown",
  "none",
  "n/a",
  "na",
  "tbd",
  "todo",
  "fixme",
  "placeholder",
  "public",
  "free",
  "fair use",
  "fair-use",
];

export function isPlaceholderLicense(value: string): boolean {
  return PLACEHOLDER_LICENSES.includes(value.trim().toLowerCase());
}

/**
 * SOURCE OF TRUTH KEYWORDS: licenseTermsSchema, LICENCE_IS_NOT_OPTIONAL
 *
 * WHAT:  A licence string that actually says something.
 * WHY:   The minimum length is 12 rather than 1 because every refusal this
 *        field is for fits in fewer characters — "owned", "CC0", "mine" — and
 *        a real answer names an instrument and a permission, which does not.
 *        It is a blunt instrument and it is the only automatic one available:
 *        no schema can tell a true licence from a plausible sentence, so this
 *        raises the floor and the manifest's own review does the rest.
 * WHERE: backgroundManifestEntrySchema.
 */
export const licenseTermsSchema = z
  .string()
  .trim()
  .min(
    12,
    "State the licence in full — the instrument and what it permits, not one word.",
  )
  .max(500)
  .refine(
    (value) => !isPlaceholderLicense(value),
    "That is a placeholder, not a licence. A library row must be able to say where it came from and what its licence permits.",
  );

/**
 * SOURCE OF TRUTH KEYWORDS: BackgroundManifestEntry,
 *   backgroundManifestEntrySchema, MANIFEST_IS_THE_REVIEW
 *
 * WHAT:  One row of the curated library, as an operator declares it.
 *
 * WHY:   MANIFEST_IS_THE_REVIEW. This file is the only way a library asset
 *        comes into existence — there is no seed script and no admin upload
 *        form — which makes adding a row a code change that a person reads.
 *        That is deliberate and it is what lets the ingest mark a library
 *        asset `approved` rather than holding it for visual review the way a
 *        customer's upload is held (MODERATION_IS_PARTIAL in
 *        src/inngest/functions/asset-ingest.ts): the human review has already
 *        happened, in the diff.
 *
 *        `key` is stable and is NOT the asset id. The id is a cuid minted on
 *        first sync; the key is how a later sync recognises the same entry
 *        after its title, its source URL or its plan has changed. Without it a
 *        re-sync would create a second row and every project pointing at the
 *        first would keep the old file forever.
 *
 *        `sourceUrl` is where the bytes are fetched from ONCE, by the library
 *        ingest workflow, and never again — it is not a CDN origin and nothing
 *        renders from it. A link that rots after the first sync is therefore
 *        harmless, which is the point: a renderer that fetched a third party's
 *        URL at render time would be a render that varies between runs and a
 *        dependency on somebody else's uptime inside a paid job.
 *
 *        There is deliberately no `licenseKind` field. The document's category
 *        comes from the asset's `source` (licenseCategoryForSource), so a
 *        declared one would have to be stored — and `Asset` gains no column in
 *        this phase. A field that is validated and then thrown away is the
 *        decoration Phase 10 spent its time removing.
 * WHERE: src/lib/library/backgrounds.manifest.ts; the `sync` mutation.
 */
export const backgroundManifestEntrySchema = z
  .object({
    /* Lower-case, hyphen-separated, and bounded: it becomes part of nothing
     * user-visible, but it IS the identity of the row across syncs, so a
     * value that differs only by case would silently fork a catalogue entry. */
    key: z
      .string()
      .trim()
      .min(3)
      .max(60)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "A manifest key is lower-case words joined by hyphens.",
      ),
    title: assetFilenameSchema,
    kind: libraryAssetKindSchema,
    contentType: uploadContentTypeSchema,
    sourceUrl: z.string().trim().url().max(2048),
    license: licenseTermsSchema,
    minPlan: z.enum(PLAN_KEYS),
    attribution: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

export type BackgroundManifestEntry = z.infer<
  typeof backgroundManifestEntrySchema
>;

/**
 * SOURCE OF TRUTH KEYWORDS: backgroundManifestSchema, DUPLICATE_KEY_IS_A_FORK
 *
 * WHAT:  The whole manifest, with its keys proven unique.
 * WHY:   DUPLICATE_KEY_IS_A_FORK. Two rows sharing a key would make `sync`
 *        upsert the same asset twice with different bytes, and which one won
 *        would depend on array order. Caught here rather than in the sync,
 *        because the manifest is data and the check belongs with the data.
 * WHERE: src/lib/library/backgrounds.manifest.ts, at module scope.
 */
export const backgroundManifestSchema = z
  .array(backgroundManifestEntrySchema)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      if (seen.has(entry.key)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "key"],
          message: `Duplicate manifest key "${entry.key}".`,
        });
      }
      seen.add(entry.key);
    }
  });

/**
 * SOURCE OF TRUTH KEYWORDS: backgroundAvailableOnPlan, PREMIUM_IS_A_MIN_PLAN,
 *   LOCKED_NOT_HIDDEN
 *
 * WHAT:  Whether a plan may use a given library row.
 * WHY:   Compares POSITION in the plan ladder rather than equality, so a Pro
 *        workspace gets every Starter background without the catalogue listing
 *        each row against every plan above it.
 *
 *        The same implementation as `voiceAvailableOnPlan` and
 *        `captionStyleAvailableOnPlan`, and kept separate for the reason the
 *        second of those records: these are three different ladders' worth of
 *        meaning that happen to share one line today, and merging them would
 *        couple the background catalogue's gating to the voice catalogue's.
 *
 *        An unrecognised or absent `minPlan` is treated as AVAILABLE, which is
 *        the opposite of the voice version and is correct here: `minPlan` is
 *        nullable on `Asset` and null means "not gated", which is the state of
 *        every customer upload and of an ungated library row. A library row
 *        carrying a plan string this build does not recognise is the unsafe
 *        case and is refused — see the null check below.
 * WHERE: The picker's lock badge, and re-checked server-side on `apply`.
 */
export function backgroundAvailableOnPlan(
  minPlan: string | null,
  plan: PlanKey,
): boolean {
  if (minPlan === null || minPlan.length === 0) return true;

  const required = PLAN_KEYS.indexOf(minPlan as PlanKey);
  const actual = PLAN_KEYS.indexOf(plan);
  /* A row written by a future release naming a plan this build has never heard
   * of must not be handed out for nothing. */
  if (required < 0 || actual < 0) return false;
  return actual >= required;
}

/**
 * SOURCE OF TRUTH KEYWORDS: plansUpTo, MIN_PLAN_IS_A_LADDER
 *
 * WHAT:  Every plan at or below the given one, as the strings a `minPlan`
 *        column holds.
 * WHY:   The SQL half of `backgroundAvailableOnPlan`. A query cannot compare
 *        ladder positions, so "every row this plan may use" becomes
 *        `minPlan IN (…)` — and the list has to be derived from the one
 *        PLAN_KEYS source rather than written out, or the ladder exists in two
 *        places and a new plan is available in the picker and refused by the
 *        gate (or the reverse).
 * WHERE: firstLibraryBackground in src/services/backgrounds.service.ts.
 */
export function plansUpTo(plan: PlanKey): readonly string[] {
  const index = PLAN_KEYS.indexOf(plan);
  return index < 0 ? [] : PLAN_KEYS.slice(0, index + 1);
}

/**
 * SOURCE OF TRUTH KEYWORDS: libraryAssetId, LIBRARY_ID_PREFIX,
 *   MANIFEST_KEY_IS_THE_IDENTITY
 *
 * WHAT:  The `Asset.id` a manifest entry gets.
 * WHY:   MANIFEST_KEY_IS_THE_IDENTITY. Derived from the manifest key instead of
 *        left to `cuid()`, so a second sync UPDATES the catalogue row rather
 *        than minting a new one and stranding every project that pointed at
 *        the first. It also means the object key — which is built from the id —
 *        is stable, so the bytes are fetched once and never orphaned.
 *
 *        The prefix exists so an id is recognisable in a log line and, more
 *        importantly, so a library id can never collide with a cuid: cuids do
 *        not contain hyphens in this position and are not prefixed. It is also
 *        a valid storage key segment (no dot, no separator — see
 *        assertKeySegment), which is what lets it be used in a path at all.
 * WHERE: `backgroundLibrary.sync`; src/inngest/functions/library-ingest.ts.
 */
export const LIBRARY_ID_PREFIX = "lib-";

export function libraryAssetId(manifestKey: string): string {
  return `${LIBRARY_ID_PREFIX}${manifestKey}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: BACKGROUND_PAGE_SIZE, listBackgroundsSchema,
 *   ListBackgroundsValues
 *
 * WHAT:  Input for `backgroundLibrary.list`.
 * WHY:   One page is deliberately larger than the media grid's 24: the picker
 *        is a visual choice made in one pass, and a customer who has to
 *        paginate to see the catalogue has effectively been shown less of it
 *        than a plan's breadth cap allows. `page`/`pageSize` carry no
 *        `.default()` or `.max()`, as everywhere else — the procedure factory
 *        owns the clamping.
 *
 *        `includeUploads` defaults to TRUE because the picker's whole job is
 *        "library or your own", and a caller that wanted only the catalogue
 *        (the portal's review of what it curates) is the exception.
 * WHERE: The picker's query; the router.
 */
export const BACKGROUND_PAGE_SIZE = 36;

export const listBackgroundsSchema = z.object({
  organizationId: z.string().min(1),
  /* Optional, because the picker is also usable with no project in hand (a
   * workspace-level default). When present, the project's own stored choice is
   * what comes back as selected. */
  projectId: z.string().min(1).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
  search: z.string().trim().max(200).optional(),
  includeUploads: z.boolean().optional(),
  /** Footage by default; the audio kinds for a music or SFX picker. */
  kinds: z.array(libraryAssetKindSchema).min(1).optional(),
});

export type ListBackgroundsValues = z.infer<typeof listBackgroundsSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: applyBackgroundSchema, ApplyBackgroundValues,
 *   NULL_CLEARS_THE_CHOICE
 *
 * WHAT:  Input for `backgroundLibrary.applyBackground` — the project's background.
 * WHY:   NULL_CLEARS_THE_CHOICE, rather than a second `clear` mutation. The
 *        two do the same write to the same key and would need the same plan
 *        check and the same audit line; one nullable field is one boundary
 *        instead of two. `null` means "go back to the styled backdrop", which
 *        is a real choice a customer makes and not an absence.
 * WHERE: The picker's tiles and its Remove action.
 */
export const applyBackgroundSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  assetId: z.string().min(1).max(120).nullable(),
});

export type ApplyBackgroundValues = z.infer<typeof applyBackgroundSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: syncBackgroundLibrarySchema, PORTAL_ONLY_SYNC
 *
 * WHAT:  Input for `backgroundLibrary.sync` — the operator's catalogue import.
 * WHY:   `dryRun` for the same reason `voices.sync` has one: the first thing
 *        anybody wants from a sync against a live catalogue is to see what it
 *        WOULD do. `keys` narrows a run to named manifest entries, because a
 *        single new loop should not re-fetch forty.
 * WHERE: `backgroundLibrary.sync`, called as the portal workspace. No screen
 *        drives it yet — see the WHERE on that procedure.
 */
export const syncBackgroundLibrarySchema = z.object({
  organizationId: z.string().min(1),
  dryRun: z.boolean().optional(),
  keys: z.array(z.string().trim().min(1).max(60)).min(1).max(100).optional(),
});

export type SyncBackgroundLibraryValues = z.infer<
  typeof syncBackgroundLibrarySchema
>;
