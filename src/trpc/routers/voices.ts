/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: voicesRouter, voices.list, voices.assign,
 *   voices.preview, voices.sync, voices.speakers, LOCKED_NOT_HIDDEN,
 *   PREVIEWS_ARE_NEVER_GATED, PORTAL_ONLY_SYNC, ASSIGNMENT_BLOCKS_GENERATION
 *
 * WHAT:  The catalogue a workspace browses, the cast it assigns, and the
 *        operator's sync that populates the catalogue in the first place.
 *
 * WHY:   LOCKED_NOT_HIDDEN. `list` returns EVERY active voice with a
 *        `locked` flag, never a plan-filtered subset. A voice a customer never
 *        sees is one they have no reason to pay for, and filtering in SQL is
 *        the obvious implementation that quietly removes the entire upsell.
 *        The lock is enforced on `assign`, which is the boundary.
 *
 *        PREVIEWS_ARE_NEVER_GATED is the phase's own decision and it is worth
 *        stating because it looks like a hole: a free workspace can preview
 *        every premium voice. That is deliberate — hearing what you cannot yet
 *        use is the upsell, and the preview costs nothing to serve because it
 *        is a pre-rendered asset rather than a synthesis.
 *
 *        PORTAL_ONLY_SYNC. Pulling the provider's library is an OPERATOR
 *        action against the shared catalogue, not a tenant one, so `sync` is
 *        refused outside the portal workspace — a second check on top of the
 *        `voices:sync` permission, because a custom role in a tenant could
 *        otherwise be granted it.
 * WHERE: Mounted as `voices` in src/trpc/routers/_app.ts.
 */

import { TRPCError } from "@trpc/server";

import { createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import { checkBooleanFeature, getOrganizationTier } from "@/lib/feature-gate";
import { getTtsAdapter } from "@/lib/adapters/tts";
import { enqueue } from "@/lib/adapters/jobs";
import { signAssetUrl } from "@/services/assets.service";
import * as voicesService from "@/services/voices.service";
import { listNarrationLines, narrationTotals } from "@/services/narration.service";
import {
  assignVoiceSchema,
  listSpeakersSchema,
  listVoicesSchema,
  previewVoiceSchema,
  syncVoicesSchema,
  voiceAvailableOnPlan,
} from "@/lib/types/voice";
import { mapProviderLabels } from "@/lib/voices/map-labels";

/** A preview is a short clip; the URL only has to outlive a click. */
const PREVIEW_URL_TTL_SECONDS = 900;

export const voicesRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: voices.list, LOCKED_NOT_HIDDEN
   *
   * WHAT:  The whole active catalogue, each voice marked locked or not.
   * WHY:   See the file header. `locked` is computed from BOTH gates — the
   *        `premiumVoices` flag (may this workspace use gated voices at all)
   *        and the voice's own `minPlan` (which ones) — because they answer
   *        different questions and a voice is only usable when both allow it.
   * WHERE: The voice picker.
   */
  list: protectedProcedure({ requirePermission: permissions.VOICES_READ })
    .input(listVoicesSchema)
    .query(async ({ ctx, input }) => {
      const [tier, premium] = await Promise.all([
        getOrganizationTier(input.organizationId),
        checkBooleanFeature(input.organizationId, "premiumVoices"),
      ]);

      const voices = await voicesService.listVoices(ctx.db, {
        search: input.search,
        gender: input.gender,
        accent: input.accent,
        tone: input.tone,
      });

      return {
        plan: tier.tier,
        premiumEnabled: premium.enabled,
        upgradeMessage: premium.upgradeMessage,
        voices: voices.map((voice) => {
          const withinPlan = voiceAvailableOnPlan(voice.minPlan, tier.tier);
          /* A voice above the free tier needs the flag as well — the flag is
           * what a trial turns off wholesale. */
          const needsPremium = voice.minPlan !== "free";
          return {
            ...voice,
            locked: !withinPlan || (needsPremium && !premium.enabled),
            hasPreview: voice.previewAssetId !== null,
          };
        }),
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: voices.preview, PREVIEWS_ARE_NEVER_GATED
   *
   * WHAT:  A signed URL for a voice's pre-rendered sample.
   * WHY:   No plan check, no credit cost, no provider call — see the file
   *        header. It is a plain read of a library asset, which is why it can
   *        be free: the sample was rendered once, at sync time, and is shared
   *        by every workspace.
   *
   *        Returns `url: null` rather than throwing when a voice has no
   *        preview, because that is a catalogue gap (the sync could not store
   *        one) rather than a customer error — the picker shows the voice
   *        without a play button.
   * WHERE: The picker's play buttons.
   */
  preview: protectedProcedure({ requirePermission: permissions.VOICES_READ })
    .input(previewVoiceSchema)
    .query(async ({ ctx, input }) => {
      const voice = await voicesService.findVoice(ctx.db, input.voiceId);
      if (voice === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Voice not found" });
      }

      if (voice.previewAssetId === null) {
        return { url: null, voiceId: voice.id };
      }

      /* Library assets have a null organizationId, and `signAssetUrl` already
       * allows "mine OR library" — so the caller's own org is the right scope
       * to pass (MINE_OR_LIBRARY in assets.service.ts). */
      const url = await signAssetUrl(
        voice.previewAssetId,
        input.organizationId,
        PREVIEW_URL_TTL_SECONDS,
      );

      return { url, voiceId: voice.id };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: voices.speakers, ASSIGNMENT_BLOCKS_GENERATION,
   *   NAME_THE_UNASSIGNED
   *
   * WHAT:  A project's cast, with whether narration may proceed.
   * WHY:   Returns the validation alongside the rows, so the panel's disabled
   *        button and the names it lists come from one read — fetching them
   *        separately would show "ready" next to a disabled button for the
   *        instant between two queries.
   * WHERE: The speaker assignment panel.
   */
  speakers: protectedProcedure({ requirePermission: permissions.VOICES_READ })
    .input(listSpeakersSchema)
    .query(async ({ ctx, input }) => {
      const [speakers, assignments, narration] = await Promise.all([
        voicesService.listSpeakers(ctx.db, input.organizationId, input.projectId),
        voicesService.validateAssignments(
          ctx.db,
          input.organizationId,
          input.projectId,
        ),
        narrationTotals(ctx.db, input.organizationId, input.projectId),
      ]);

      return { speakers, assignments, narration };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: voices.lines
   *
   * WHAT:  A project's narration lines and their synthesis state.
   * WHERE: The narration panel, polled while a fan-out runs.
   */
  lines: protectedProcedure({ requirePermission: permissions.VOICES_READ })
    .input(listSpeakersSchema)
    .query(async ({ ctx, input }) => ({
      lines: await listNarrationLines(
        ctx.db,
        input.organizationId,
        input.projectId,
      ),
      totals: await narrationTotals(
        ctx.db,
        input.organizationId,
        input.projectId,
      ),
    })),

  /**
   * SOURCE OF TRUTH KEYWORDS: voices.assign, LOCKED_NOT_HIDDEN,
   *   ASSIGNMENT_SETS_STATE
   *
   * WHAT:  Gives a speaker a voice.
   * WHY:   This is the BOUNDARY the lock badge is a courtesy for. Both gates
   *        are re-checked server-side — the `premiumVoices` flag and the
   *        voice's `minPlan` — because a disabled radio stops a mistake, not a
   *        request.
   *
   *        The refusal carries the upgrade sentence from the registry, so the
   *        client opens the same modal it would from a gated button.
   * WHERE: The picker's assign action.
   */
  assign: protectedProcedure({
    requirePermission: permissions.VOICES_ASSIGN,
    audit: { action: "assign" },
  })
    .input(assignVoiceSchema)
    .mutation(async ({ ctx, input }) => {
      const voice = await voicesService.findVoice(ctx.db, input.voiceId);
      if (voice === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That voice is no longer available.",
        });
      }

      const [tier, premium] = await Promise.all([
        getOrganizationTier(input.organizationId),
        checkBooleanFeature(input.organizationId, "premiumVoices"),
      ]);

      const withinPlan = voicesService.assertVoiceAllowedOnPlan(
        voice.minPlan,
        tier.tier,
      );
      const needsPremium = voice.minPlan !== "free";

      if (!withinPlan || (needsPremium && !premium.enabled)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            premium.upgradeMessage ??
            "That voice is not included in your current plan.",
        });
      }

      /* Read FIRST, for the project id — the validation below needs it, and
       * reading it here also turns a guessed speaker id from another
       * workspace into a clean NOT_FOUND rather than a silent no-op. */
      const speaker = await ctx.db.speaker.findFirst({
        where: { id: input.speakerId, organizationId: input.organizationId },
        select: { projectId: true },
      });
      if (speaker === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That speaker no longer exists.",
        });
      }

      const updated = await voicesService.assignSpeakerVoice(
        ctx.db,
        input.organizationId,
        input.speakerId,
        input.voiceId,
      );
      if (updated === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That speaker no longer exists.",
        });
      }

      /* Returned so the panel can re-enable the generate button without a
       * second round trip — and so the two numbers it compares were read
       * after the write rather than before it. */
      return {
        speakerId: input.speakerId,
        voiceId: input.voiceId,
        assignments: await voicesService.validateAssignments(
          ctx.db,
          input.organizationId,
          speaker.projectId,
        ),
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: voices.sync, PORTAL_ONLY_SYNC, CATALOGUE_SYNC,
   *   SYNC_PRESERVES_OPERATOR_EDITS, DEACTIVATE_NEVER_DELETE
   *
   * WHAT:  Pulls the operator's licensed library and upserts the catalogue.
   *
   * WHY:   This is how the catalogue gets populated — there is no seed file,
   *        deliberately. The phase forbids an agent-written seed, and the
   *        provider voice ids only exist in a real account, so a hand-written
   *        list would be both a fiction and immediately stale.
   *
   *        PORTAL_ONLY_SYNC: refused outside the portal workspace, on top of
   *        the permission. `Voice` rows are shared by every tenant, so a
   *        tenant able to write them could rename or withdraw voices for
   *        everyone.
   *
   *        `dryRun` exists because the first thing anybody wants from a sync
   *        against a live catalogue is to see what it WOULD do.
   *
   *        Previews are NOT fetched here. Storing a sample per voice needs
   *        object storage, and doing it inline would make a sync a
   *        multi-megabyte download inside a request. The row records that it
   *        has no preview and the picker simply omits the play button; a
   *        separate pass can fill them in once storage is configured. Grep
   *        PREVIEWS_ARE_A_SEPARATE_PASS.
   * WHERE: The portal's Voices screen.
   */
  sync: protectedProcedure({
    requirePermission: permissions.VOICES_SYNC,
    audit: { action: "sync" },
    /* A provider round trip plus an upsert per voice. The default ten seconds
     * is tight for a catalogue of forty. */
    txTimeout: 60_000,
  })
    .input(syncVoicesSchema)
    .mutation(async ({ ctx, input }) => {
      /* PORTAL_ONLY_SYNC — the permission is necessary and not sufficient. */
      const organization = await ctx.db.organization.findUnique({
        where: { id: input.organizationId },
        select: { isPortalOrganization: true },
      });
      if (organization?.isPortalOrganization !== true) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The voice catalogue can only be synced from the portal.",
        });
      }

      const tts = await getTtsAdapter();
      const catalogue = await tts.listCatalogue();

      let created = 0;
      let updated = 0;
      const seen: string[] = [];

      for (const entry of catalogue) {
        seen.push(entry.providerVoiceId);
        if (input.dryRun === true) continue;

        const mapped = mapProviderLabels(entry.labels);

        const result = await voicesService.upsertCatalogueVoice(ctx.db, {
          provider: tts.id,
          providerVoiceId: entry.providerVoiceId,
          name: entry.name,
          gender: mapped.gender,
          accent: mapped.accent,
          tone: mapped.tone,
          /* Everything arrives as `free` and the operator tiers it afterwards.
           * The provider has no notion of OUR plans, and guessing would either
           * give the catalogue away or lock all of it. */
          minPlan: "free",
        });

        if (result.created) created += 1;
        else updated += 1;
      }

      const deactivated =
        input.dryRun === true
          ? 0
          : await voicesService.deactivateMissingVoices(ctx.db, tts.id, seen);

      return {
        dryRun: input.dryRun === true,
        found: catalogue.length,
        created,
        updated,
        deactivated,
      };
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: voices.narrate, ASSIGNMENT_BLOCKS_GENERATION,
   *   NARRATION_RUNS_IN_A_WORKFLOW
   *
   * WHAT:  Starts recording a project's narration.
   * WHY:   NARRATION_RUNS_IN_A_WORKFLOW — it enqueues and returns. A script is
   *        dozens of lines and each is a provider round trip, so doing it in
   *        the request would blow the 10-second transaction many times over.
   *        The same decision  and  make.
   *
   *        ASSIGNMENT_BLOCKS_GENERATION is checked HERE as well as in the
   *        workflow, because a refusal the customer is waiting on can name the
   *        speakers, whereas one inside a run can only mark the project failed.
   *        The workflow re-checks because it trusts no payload.
   * WHERE: The Record narration button.
   */
  narrate: protectedProcedure({
    requirePermission: permissions.VOICES_ASSIGN,
    audit: { action: "narrate" },
  })
    .input(listSpeakersSchema)
    .mutation(async ({ ctx, input }) => {
      const assignments = await voicesService.validateAssignments(
        ctx.db,
        input.organizationId,
        input.projectId,
      );

      if (!assignments.ok) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: assignments.hasSpeakers
            ? `Assign a voice to ${assignments.unassigned.join(", ")} before recording.`
            : "Write a script first — the speakers come from it.",
        });
      }

      await enqueue({
        name: "tts/requested",
        data: {
          projectId: input.projectId,
          organizationId: input.organizationId,
        },
        /* Keyed on the project so a double-click produces one run. A genuine
         * second attempt after an edit is a different script and therefore a
         * different set of line hashes, which the run itself handles. */
        id: `tts-${input.projectId}`,
      });

      return { queued: true };
    }),
});
