/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: listVoiceCatalogOperation,
 *   listCaptionStyleCatalogOperation, listBackgroundCatalogOperation,
 *   LOCKED_NOT_HIDDEN, ONE_AVAILABILITY_RULE_MANY_PROJECTIONS,
 *   THE_FLAG_IS_HALF_THE_RULE
 *
 * WHAT:  The three catalogues an agent or an API client has to read before it
 *        can choose anything: voices, caption styles and backgrounds.
 *
 * WHY:   LOCKED_NOT_HIDDEN is the product rule these three share, and it is
 *        why they are reads worth sharing rather than trivia. A catalogue
 *        never hides what a workspace cannot have — it returns the row with
 *        `locked: true` and the registry's own upgrade sentence, so the web
 *        app can show a padlock and an agent can tell a person what upgrading
 *        would buy. A filtered list would make the product look smaller than
 *        it is, on every surface at once.
 *
 *        THE_FLAG_IS_HALF_THE_RULE. Availability is `withinPlan AND flag`, and
 *        both halves are needed: the plan comparison answers "is this row
 *        above my tier", and the boolean flag is what a FREE TRIAL turns off
 *        wholesale regardless of tier. Computing them in one expression here
 *        is what stops the two halves drifting apart, which is the specific
 *        bug a trial user would hit: a premium voice shown unlocked, selected,
 *        and then refused on assignment.
 *
 *        ONE_AVAILABILITY_RULE_MANY_PROJECTIONS, stated plainly because it is
 *        the one place in this seam where a surface keeps its own shape.
 *        Voices and caption styles are returned here in the shape the web
 *        app's pickers already use, so `voices.list` and `captions.styles`
 *        call these functions and there is one implementation. BACKGROUNDS are
 *        different: the picker needs signed thumbnails, a breadth cursor and
 *        the project's current selection, which is several more queries and
 *        tens of kilobytes of URLs that an agent choosing an id has no use
 *        for. Forcing one shape would either make the picker worse or make
 *        every agent download a gallery.
 *
 *        So `listBackgroundCatalogOperation` is a leaner projection, and what
 *        it SHARES with the picker is the thing that actually matters: the
 *        availability decision, through the same `backgroundAvailableOnPlan`
 *        and `isWithinBreadth` the picker and the write refusal use. A rule
 *        change lands in one place; only the field list differs.
 * WHERE: `voices.list`, `captions.styles`; GET /catalog/{voices,backgrounds,
 *        caption-styles} (17b); `list_backgrounds` (17c).
 */

import "server-only";

import {
  CAPTION_STYLE_FAMILIES,
  listCaptionStyles,
  passesContrast,
} from "@/lib/captions";
import { checkBooleanFeature } from "@/lib/feature-gate";
import {
  getResourceLimitForPlan,
  getUpgradeMessage,
} from "@/lib/resources";
import * as backgroundsService from "@/services/backgrounds.service";
import * as voicesService from "@/services/voices.service";
import type { OperationContext } from "@/lib/types/api";
import {
  BACKGROUND_ASSET_KINDS,
  backgroundAvailableOnPlan,
  type ListBackgroundsValues,
} from "@/lib/types/background";
import {
  captionStyleAvailableOnPlan,
  type ListCaptionStylesValues,
} from "@/lib/types/caption";
import { voiceAvailableOnPlan, type ListVoicesValues } from "@/lib/types/voice";

export type ListVoiceCatalogInput = Omit<ListVoicesValues, "organizationId">;

export async function listVoiceCatalogOperation(
  ctx: OperationContext,
  input: ListVoiceCatalogInput,
) {
  const premium = await checkBooleanFeature(
    ctx.organizationId,
    "premiumVoices",
  );

  const voices = await voicesService.listVoices(ctx.db, {
    search: input.search,
    gender: input.gender,
    accent: input.accent,
    tone: input.tone,
  });

  return {
    plan: ctx.plan,
    premiumEnabled: premium.enabled,
    upgradeMessage: premium.upgradeMessage,
    voices: voices.map((voice) => {
      const withinPlan = voiceAvailableOnPlan(voice.minPlan, ctx.plan);
      /* THE_FLAG_IS_HALF_THE_RULE — a voice above the free tier needs the flag
       * as well, because the flag is what a trial turns off wholesale. */
      const needsPremium = voice.minPlan !== "free";
      return {
        ...voice,
        locked: !withinPlan || (needsPremium && !premium.enabled),
        hasPreview: voice.previewAssetId !== null,
      };
    }),
  };
}

export type ListCaptionStyleCatalogInput = Omit<
  ListCaptionStylesValues,
  "organizationId"
>;

export async function listCaptionStyleCatalogOperation(
  ctx: OperationContext,
  input: ListCaptionStyleCatalogInput,
) {
  const premium = await checkBooleanFeature(
    ctx.organizationId,
    "premiumCaptionStyles",
  );

  const styles = listCaptionStyles({
    search: input.search,
    family: input.family,
  });

  return {
    plan: ctx.plan,
    premiumEnabled: premium.enabled,
    upgradeMessage: premium.upgradeMessage,
    families: CAPTION_STYLE_FAMILIES,
    styles: styles.map((style) => {
      const withinPlan = captionStyleAvailableOnPlan(style.minPlan, ctx.plan);
      /* See THE_FLAG_IS_HALF_THE_RULE. */
      const needsPremium = style.minPlan !== "free";
      return {
        ...style,
        locked: !withinPlan || (needsPremium && !premium.enabled),
        contrastOk: passesContrast(style).ok,
      };
    }),
  };
}

export type ListBackgroundCatalogInput = Pick<
  ListBackgroundsValues,
  "search" | "kinds"
> & {
  /** How many rows to return. The REST layer's cursor paging sits above this. */
  take: number;
  skip: number;
};

/**
 * SOURCE OF TRUTH KEYWORDS: listBackgroundCatalogOperation,
 *   ONE_AVAILABILITY_RULE_MANY_PROJECTIONS, BREADTH_IS_APPLIED_AT_READ_TIME
 *
 * WHAT:  The shared background library as ids, names and availability — no
 *        thumbnails, no selection state.
 *
 * WHY:   BREADTH_IS_APPLIED_AT_READ_TIME. A plan does not unlock backgrounds
 *        one by one; it unlocks a BREADTH — the first N of the catalogue. That
 *        cursor is resolved before the page is read, through the same service
 *        call the picker uses, because a row's position among SEARCH MATCHES
 *        says nothing about its position in the catalogue: computing it from
 *        the page would mark different rows locked depending on what was
 *        typed.
 *
 *        Workspace uploads are deliberately NOT included. They are not a
 *        catalogue — they are the customer's own files, they are never locked,
 *        and listing them belongs with the asset endpoints where their
 *        lifecycle lives. An agent asking "what backgrounds may I use" is
 *        asking about the library.
 * WHERE: See the file header.
 */
export async function listBackgroundCatalogOperation(
  ctx: OperationContext,
  input: ListBackgroundCatalogInput,
) {
  const kinds = input.kinds ?? [...BACKGROUND_ASSET_KINDS];
  const breadth = getResourceLimitForPlan("backgroundLibrary", ctx.plan);
  const upgradeMessage = getUpgradeMessage("backgroundLibrary", ctx.plan);

  const cursor = await backgroundsService.breadthCursor(ctx.db, {
    kinds,
    breadth,
  });

  const catalogue = await backgroundsService.listLibraryAssets(
    ctx.db,
    { kinds, search: input.search },
    { skip: input.skip, take: input.take },
  );

  return {
    plan: ctx.plan,
    upgradeMessage,
    total: catalogue.total,
    backgrounds: catalogue.items.map((row) => ({
      id: row.id,
      filename: row.filename,
      kind: row.kind,
      durationSec: row.durationSec,
      width: row.width,
      height: row.height,
      /* LOCKED_NOT_HIDDEN, decided by the same two rules the picker and the
       * apply refusal use. */
      locked:
        !backgroundAvailableOnPlan(row.minPlan, ctx.plan) ||
        !backgroundsService.isWithinBreadth(row, cursor),
    })),
  };
}
