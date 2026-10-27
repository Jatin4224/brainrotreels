/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AVATAR_STATES, avatarStateSchema, AvatarState,
 *   avatarAssetSetSchema, AvatarAssetSet, readAvatarAssetSet,
 *   avatarManifestEntrySchema, AvatarManifestEntry, avatarManifestSchema,
 *   avatarAvailableOnPlan, avatarAssetId, LIKENESS_IS_ATTESTED,
 *   A_SET_IS_COMPLETE_OR_REFUSED, AVATAR_FLICKER_MS
 *
 * WHAT:  The vocabulary of an avatar — its three states, the complete artwork
 *        set a row must carry, the manifest an operator declares them in, and
 *        the plan gate.
 *
 * WHY:   A_SET_IS_COMPLETE_OR_REFUSED. `Avatar.assetSet` is one jsonb value and
 *        it is parsed as a WHOLE: all three states or nothing. Three nullable
 *        columns would be the same data with a worse property — a row with
 *        `talking` set and `neutral` null is a character that cannot be drawn
 *        at rest, and the renderer would discover it mid-video. Here, an
 *        incomplete set fails the parse and the avatar simply is not offered.
 *
 *        LIKENESS_IS_ATTESTED, which is the part of the phase's "no real-person
 *        likenesses and no third-party characters" that a machine can actually
 *        hold. No schema can look at a PNG and tell whose face it is, so the
 *        manifest requires an explicit, non-placeholder attestation per row
 *        naming where the artwork came from — the same discipline, and the same
 *        refusal list, as the background manifest's licence field. The real
 *        check is a person reading the diff; this stops a row existing without
 *        anyone having written down what they checked.
 *
 *        AVATAR_FLICKER_MS is here rather than in the component because it is a
 *        PRODUCT rule, not a drawing detail: it decides what counts as a
 *        performance rather than a glitch, and the generator uses it to
 *        coalesce state changes before they ever reach a frame.
 * WHERE: src/lib/library/avatars.manifest.ts, src/services/avatars.service.ts,
 *        src/lib/generators/reddit-story.ts and
 *        src/remotion/components/avatar-overlay.tsx.
 *        Re-exported from src/lib/types.
 */

import { z } from "zod";

import { PLAN_KEYS, type PlanKey } from "@/lib/config/plans";
import { isPlaceholderLicense } from "./background";

/**
 * SOURCE OF TRUTH KEYWORDS: AVATAR_STATES, avatarStateSchema, AvatarState
 *
 * WHAT:  The three pieces of artwork a character has.
 * WHY:   Three, and the reason there are exactly three is that each one answers
 *        a question the word timings can answer: is this speaker silent
 *        (`neutral`), speaking (`talking`), or reacting to a marked beat
 *        (`reaction`). A fourth state would need a signal in the document to
 *        drive it, and there is none — which is why this is a closed union and
 *        not an open map.
 *
 *        `neutral` is FIRST and is the fallback everywhere: a character whose
 *        talking frame failed to ingest is drawn at rest rather than not at all
 *        (NEUTRAL_IS_THE_FALLBACK in the overlay component).
 * WHERE: The keys of an avatar's asset set; the overlay's state machine.
 */
export const AVATAR_STATES = ["neutral", "talking", "reaction"] as const;

export const avatarStateSchema = z.enum(AVATAR_STATES);

export type AvatarState = z.infer<typeof avatarStateSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: avatarAssetSetSchema, AvatarAssetSet,
 *   A_SET_IS_COMPLETE_OR_REFUSED
 *
 * WHAT:  The artwork map stored on `Avatar.assetSet`.
 * WHY:   A full object with all three keys REQUIRED, and `.strict()` so a
 *        fourth state written by a newer release fails the parse here rather
 *        than being silently dropped — an unrecognised state means this build
 *        does not know how to draw the character, and offering it anyway would
 *        put a gap in a paid video.
 *
 *        The values are Asset ids, not storage keys and not URLs. The artwork
 *        is a library asset like any other (`library/avatars/…`), so it is
 *        signed — or served from the CDN — by the one function allowed to do
 *        that, and the document carries handles rather than links
 *        (URL_NEVER_IN_THE_DOCUMENT).
 * WHERE: Written by the avatar sync; read by `readAvatarAssetSet`.
 */
export const avatarAssetSetSchema = z
  .object({
    neutral: z.string().trim().min(1).max(120),
    talking: z.string().trim().min(1).max(120),
    reaction: z.string().trim().min(1).max(120),
  })
  .strict();

export type AvatarAssetSet = z.infer<typeof avatarAssetSetSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: readAvatarAssetSet, SETTINGS_ARE_PARSED_NOT_TRUSTED
 *
 * WHAT:  An avatar's artwork set out of a jsonb column, or null.
 * WHY:   The column is `Json`, so what comes back is `unknown` as far as
 *        correctness goes and may have been written by an older release. One
 *        parse point, returning null rather than throwing, so a malformed row
 *        drops out of the picker instead of failing the query that listed it.
 * WHERE: src/services/avatars.service.ts and the generator.
 */
export function readAvatarAssetSet(value: unknown): AvatarAssetSet | null {
  const parsed = avatarAssetSetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: avatarAvailableOnPlan, PREMIUM_IS_A_MIN_PLAN
 *
 * WHAT:  Whether a plan may use a given character.
 * WHY:   The same ladder comparison as `voiceAvailableOnPlan` and
 *        `backgroundAvailableOnPlan`, and kept separate for the reason the
 *        caption version records: three catalogues' worth of meaning that
 *        happen to share one line today, and merging them would couple the
 *        avatar catalogue's gating to the voice catalogue's.
 *
 *        An unrecognised `minPlan` LOCKS, as the voice version does: `minPlan`
 *        is non-nullable on `Avatar` with a `free` default, so a value this
 *        build does not recognise was written deliberately by a newer release
 *        and must not be handed out for nothing.
 * WHERE: The avatar picker's lock badge, and re-checked on assignment.
 */
export function avatarAvailableOnPlan(minPlan: string, plan: PlanKey): boolean {
  const required = PLAN_KEYS.indexOf(minPlan as PlanKey);
  const actual = PLAN_KEYS.indexOf(plan);
  if (required < 0 || actual < 0) return false;
  return actual >= required;
}

/**
 * SOURCE OF TRUTH KEYWORDS: AVATAR_FLICKER_MS, COALESCE_SHORT_STATES
 *
 * WHAT:  The shortest avatar state change worth drawing.
 *
 * WHY:   COALESCE_SHORT_STATES is the phase's step 7, stated as a number: "a
 *        120ms avatar flip looks like a glitch, not a performance". Narration
 *        has natural gaps — a comma, a breath, the join between two lines of
 *        the same speaker — and switching to `neutral` for every one of them
 *        produces a character that strobes.
 *
 *        It lives HERE rather than in the component because the coalescing
 *        happens in the GENERATOR, before the frames exist: the document
 *        carries already-merged windows, so the renderer draws what it is told
 *        and a frame stays a pure function of its number. Doing it at draw time
 *        would mean every component re-deriving it, and Phase 15's editor
 *        showing windows that do not match the render.
 *
 *        180ms is above the flicker threshold and below a deliberate pause. Two
 *        windows closer together than this are merged into one.
 * WHERE: `buildAvatarWindows` in src/lib/generators/avatar-windows.ts.
 */
export const AVATAR_FLICKER_MS = 180;

/**
 * SOURCE OF TRUTH KEYWORDS: avatarManifestEntrySchema, AvatarManifestEntry,
 *   LIKENESS_IS_ATTESTED, MANIFEST_IS_THE_REVIEW
 *
 * WHAT:  One character, as an operator declares it.
 *
 * WHY:   MANIFEST_IS_THE_REVIEW, exactly as for backgrounds: adding a row is a
 *        code change a person reads, and that is the only path by which an
 *        avatar comes into existence.
 *
 *        LIKENESS_IS_ATTESTED. `provenance` is a required, non-placeholder
 *        sentence saying where the artwork came from and confirming it depicts
 *        nobody real and nothing third-party. It reuses
 *        `isPlaceholderLicense`'s refusal list, because the words people type
 *        when they have not checked are the same words either way ("owned",
 *        "ours", "n/a"). No schema can inspect a PNG, so this is the part a
 *        machine can hold: a row cannot exist without somebody having written
 *        down what they verified.
 *
 *        `states` names MANIFEST KEYS of library assets, not asset ids. The
 *        artwork goes through the Phase 11 library sync — same ingest, same
 *        variants, same `library/avatars/…` prefix — and the avatar sync
 *        resolves those keys to ids afterwards. That ordering is why the two
 *        syncs are separate steps rather than one.
 * WHERE: src/lib/library/avatars.manifest.ts.
 */
export const avatarManifestEntrySchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(3)
      .max(60)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "An avatar key is lower-case words joined by hyphens.",
      ),
    name: z.string().trim().min(1).max(80),
    minPlan: z.enum(PLAN_KEYS),
    /* The three library manifest keys holding this character's artwork. */
    states: z
      .object({
        neutral: z.string().trim().min(3).max(60),
        talking: z.string().trim().min(3).max(60),
        reaction: z.string().trim().min(3).max(60),
      })
      .strict(),
    /* LIKENESS_IS_ATTESTED — see the WHY above. */
    provenance: z
      .string()
      .trim()
      .min(
        20,
        "Say where this artwork came from and confirm it depicts nobody real and nothing third-party.",
      )
      .max(500)
      .refine(
        (value) => !isPlaceholderLicense(value),
        "That is a placeholder, not a provenance statement. A likeness-rights claim is not a bug you can patch.",
      ),
  })
  .strict();

export type AvatarManifestEntry = z.infer<typeof avatarManifestEntrySchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: avatarManifestSchema, DUPLICATE_KEY_IS_A_FORK
 *
 * The whole manifest, with its keys proven unique — two rows sharing a key
 * would upsert the same `Avatar` twice with different artwork, and which won
 * would depend on array order. The same check, for the same reason, as the
 * background manifest's.
 */
export const avatarManifestSchema = z
  .array(avatarManifestEntrySchema)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      if (seen.has(entry.key)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "key"],
          message: `Duplicate avatar key "${entry.key}".`,
        });
      }
      seen.add(entry.key);
    }
  });

/**
 * SOURCE OF TRUTH KEYWORDS: avatarAssetId, AVATAR_ID_PREFIX,
 *   MANIFEST_KEY_IS_THE_IDENTITY
 *
 * WHAT:  The `Avatar.id` a manifest entry gets.
 * WHY:   Derived from the manifest key rather than left to `cuid()`, for the
 *        reason `libraryAssetId` records: a re-sync must UPDATE the row rather
 *        than mint a second one and strand every `Speaker.avatarId` pointing at
 *        the first. The prefix keeps it recognisable in a log line and makes a
 *        collision with a cuid impossible.
 * WHERE: The avatar sync.
 */
export const AVATAR_ID_PREFIX = "avt-";

export function avatarAssetId(manifestKey: string): string {
  return `${AVATAR_ID_PREFIX}${manifestKey}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: assignAvatarSchema, listAvatarsSchema
 *
 * WHAT:  The input contract of the two avatar procedures.
 * WHY:   `avatarId` is NULLABLE for the same reason a background can be
 *        cleared: a speaker with no face is a real and common choice — a
 *        narrator who is never on screen — and a second `clear` mutation would
 *        be a second boundary doing the same write.
 * WHERE: src/trpc/routers/avatars.ts and the cast panel.
 */
export const listAvatarsSchema = z.object({
  organizationId: z.string().min(1),
});

export const assignAvatarSchema = z.object({
  organizationId: z.string().min(1),
  speakerId: z.string().min(1),
  avatarId: z.string().min(1).max(120).nullable(),
});

export type AssignAvatarValues = z.infer<typeof assignAvatarSchema>;

export const syncAvatarsSchema = z.object({
  organizationId: z.string().min(1),
  dryRun: z.boolean().optional(),
});

export type SyncAvatarsValues = z.infer<typeof syncAvatarsSchema>;
