/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: openTimelineSchema, applyOpsSchema,
 *   listRevisionsSchema, restoreRevisionSchema, resynthLineSchema,
 *   ApplyOpsResult, ApplyOpsStatus, TimelineWireError, TIMELINE_AUTOSAVE_MS,
 *   TIMELINE_REVISION_KEEP, CAPTION_ORPHAN_POLICIES, captionOrphanPolicySchema,
 *   EDITOR_MIN_WIDTH_PX, CONFLICT_IS_A_RESULT_NOT_AN_ERROR
 *
 * WHAT:  The input contracts and shared constants of the timeline editor
 *        (Phase 15): opening it, saving ops, listing and restoring snapshots,
 *        and re-recording one narration line.
 *
 * WHY:   The op vocabulary itself is NOT here — it lives in
 *        src/lib/timeline/ops.ts because apply() has to run in the browser as
 *        well as on the server (ISOMORPHIC_PURE_MODULE), and a type file that
 *        imported the procedure layer's concerns would drag the editor's
 *        bundle into the renderer. This file is the boundary: it composes
 *        `opSchema` with the organization scoping every procedure in the app
 *        takes.
 *
 *        CONFLICT_IS_A_RESULT_NOT_AN_ERROR. `applyOps` answers with a status
 *        union rather than throwing on a revision mismatch, because a conflict
 *        is an expected outcome of two tabs — a normal thing a person does —
 *        and the UI's response to it is a choice it offers, not an error toast.
 *        A thrown CONFLICT would be indistinguishable from a network failure
 *        at the call site, and the one thing the phase forbids is losing an
 *        edit silently.
 * WHERE: Consumed by src/trpc/routers/timeline.ts and by the editor under
 *        src/app/(dashboard)/dashboard/projects/[id]/edit. Re-exported from
 *        @/lib/types.
 */

import { z } from "zod";

import { itemPatchSchema, opSchema, TIMELINE_MAX_OPS_PER_SAVE } from "@/lib/timeline";
import type { TimelineDoc } from "@/lib/timeline";

/**
 * SOURCE OF TRUTH KEYWORDS: TIMELINE_AUTOSAVE_MS, DEBOUNCE_IS_THE_SAVE
 *
 * WHAT:  How long the editor waits after the last edit before saving.
 * WHY:   DEBOUNCE_IS_THE_SAVE. Long enough that dragging a clip edge is one
 *        request rather than forty, short enough that nobody closes a tab
 *        inside the window — a save every keystroke is what makes an autosave
 *        feel like lag, and a save every ten seconds is what makes it feel
 *        unreliable. It also sets the shape of the rate limit on applyOps:
 *        see AUTOSAVE_SETS_THE_RATE in src/lib/resources.ts.
 * WHERE: The editor's autosave timer.
 */
export const TIMELINE_AUTOSAVE_MS = 1_200;

/**
 * SOURCE OF TRUTH KEYWORDS: TIMELINE_REVISION_KEEP, SNAPSHOTS_ARE_PRUNED
 *
 * WHAT:  How many snapshots of one project's timeline are kept.
 * WHY:   A snapshot per save with no ceiling turns an afternoon of editing
 *        into thousands of copies of a 200KB document — the table would
 *        outgrow everything else in the database and bill for it. Twenty is
 *        well past "recover from the autosave that just went wrong", which is
 *        what the phase asks snapshots to be for, and far short of a version
 *        history nobody asked for.
 * WHERE: applyOpsToTimeline's prune step, and the revisions list.
 */
export const TIMELINE_REVISION_KEEP = 20;

/**
 * SOURCE OF TRUTH KEYWORDS: EDITOR_MIN_WIDTH_PX, DESKTOP_ONLY_IS_STATED
 *
 * WHAT:  The width below which the editor shows a notice instead of itself.
 * WHY:   DESKTOP_ONLY_IS_STATED, which is the phase's own instruction: a
 *        five-lane timeline with draggable edges has no honest phone layout,
 *        so the screen says so rather than rendering something unusable. The
 *        number is the point at which the tracks panel stops being able to
 *        show a ruler and an inspector side by side.
 * WHERE: The editor shell's media query.
 */
export const EDITOR_MIN_WIDTH_PX = 1024;

const organizationScope = {
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
};

export const openTimelineSchema = z.object(organizationScope);

export type OpenTimelineValues = z.infer<typeof openTimelineSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: applyOpsSchema, OPTIMISTIC_CONCURRENCY,
 *   TIMELINE_MAX_OPS_PER_SAVE
 *
 * WHAT:  One save: which document the caller thinks it is editing, and what it
 *        did to it.
 * WHY:   `revision` is the whole of the collision detection and it is REQUIRED
 *        — there is no "just write it" path, because two tabs editing one
 *        project is a real scenario and the loser of that race must be told
 *        rather than overwritten.
 *
 *        The op cap matches TIMELINE_MAX_OPS_PER_SAVE, which is also the
 *        editor's undo depth: the session can queue more than one request
 *        carries and sends a prefix, so the two numbers have to be the same or
 *        a long burst would silently need a round-trip nobody wrote.
 * WHERE: timelineEditor.applyOps.
 */
export const applyOpsSchema = z.object({
  ...organizationScope,
  revision: z.number().int().nonnegative(),
  ops: z.array(opSchema).min(1).max(TIMELINE_MAX_OPS_PER_SAVE),
});

export type ApplyOpsValues = z.infer<typeof applyOpsSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: ApplyOpsResult, ApplyOpsStatus,
 *   CONFLICT_IS_A_RESULT_NOT_AN_ERROR
 *
 * WHAT:  What a save answers with: the accepted document, or the revision the
 *        server is actually on.
 * WHY:   See this file's header for why a conflict is a status rather than a
 *        thrown error. `errors` travels with an APPLIED result on purpose —
 *        apply() can accept every op and still report that the result breaks
 *        an invariant, and the editor has to show that without pretending the
 *        save failed.
 * WHERE: The return type of timelineEditor.applyOps; narrowed by the editor's
 *        save handler.
 */
export type ApplyOpsStatus = "applied" | "conflict" | "rejected";

export type ApplyOpsResult =
  | {
      status: "applied";
      doc: TimelineDoc;
      revision: number;
      errors: readonly TimelineWireError[];
    }
  | { status: "conflict"; serverRevision: number }
  | { status: "rejected"; errors: readonly TimelineWireError[] };

/**
 * SOURCE OF TRUTH KEYWORDS: TimelineWireError
 *
 * WHAT:  A validation error as it crosses tRPC.
 * WHY:   The timeline module types `code` as a closed union and superjson
 *        would carry it, but the editor renders the MESSAGE against the PATH
 *        and nothing branches on the code — so a narrower type here would tie
 *        the error list to that vocabulary for no gain.
 * WHERE: Both error-bearing ApplyOpsResult variants.
 */
export interface TimelineWireError {
  path: string;
  code: string;
  message: string;
}

export const listRevisionsSchema = z.object(organizationScope);

export const restoreRevisionSchema = z.object({
  ...organizationScope,
  revision: z.number().int().nonnegative(),
});

export type RestoreRevisionValues = z.infer<typeof restoreRevisionSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: resynthLineSchema, LINE_EDIT_INVALIDATES_ONE_LINE
 *
 * WHAT:  Re-record one narration line, optionally with new words.
 * WHY:   The LINE is the unit, not the project — see
 *        LINE_EDIT_INVALIDATES_ONE_LINE in src/inngest/functions/line-resynth.ts
 *        for why editing a typo must cost one provider call and leave every
 *        other line's audio byte-identical. `text` is optional because "try
 *        that line again" after a failed synthesis is the same request with no
 *        new words.
 * WHERE: timelineEditor.resynthLine; the editor's voice track.
 */
export const resynthLineSchema = z.object({
  ...organizationScope,
  lineId: z.string().min(1),
  text: z.string().trim().min(1).max(5_000).optional(),
});

export type ResynthLineValues = z.infer<typeof resynthLineSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_ORPHAN_POLICIES, captionOrphanPolicySchema,
 *   CaptionOrphanPolicy, DELETING_A_SCENE_ASKS
 *
 * WHAT:  What to do with the captions over a scene that is being deleted.
 * WHY:   DELETING_A_SCENE_ASKS is the phase's guard, and it is a question
 *        rather than a rule because both answers are right sometimes: cutting
 *        a scene whose narration is also going means the captions go too, and
 *        trimming a visual while keeping the voice means they stay. Guessing
 *        either way silently loses work.
 *
 *        A schema rather than a bare union because the choice arrives from a
 *        radio group in a dialog, and every form in this app is validated —
 *        the dialog resolves the answer into ops, which is why no procedure
 *        takes this type.
 * WHERE: The editor's delete-scene dialog.
 */
export const CAPTION_ORPHAN_POLICIES = ["keep", "delete"] as const;

export const captionOrphanPolicySchema = z.enum(CAPTION_ORPHAN_POLICIES);

export type CaptionOrphanPolicy = z.infer<typeof captionOrphanPolicySchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: clipLabelFormSchema, audioMixFormSchema,
 *   overlayPlacementFormSchema, captionTextFormSchema, lineTextFormSchema,
 *   DERIVED_FROM_THE_OP, EVERY_FORM_IS_VALIDATED
 *
 * WHAT:  The inspector's forms, one per group of properties it edits.
 *
 * WHY:   DERIVED_FROM_THE_OP. Four of the five are `itemPatchSchema` and
 *        `resynthLineSchema` narrowed with `.pick()`, not re-declared — so the
 *        bounds the form enforces are the SAME bounds the op enforces, and a
 *        change to either (a wider gain range, a longer label) moves the form
 *        with it. Rewriting `gain: z.number().min(0).max(4)` here would be a
 *        second source of truth for a rule the op already owns, and the
 *        symptom of a drift would be a form that accepts a value the save
 *        refuses.
 *
 *        `.required()` on the picks because the patch's fields are all
 *        optional — an op patches what it names — while a FORM always submits
 *        every field it renders. Optional fields would make every default
 *        value and every input `undefined`-flavoured for no gain.
 *
 *        `captionTextFormSchema` is the one declared outright: the text a
 *        caption shows is not a property of the caption at all
 *        (WORD_RANGE_NOT_TEXT), it is the words it covers, so there is no op
 *        field to derive it from. The minimum of one character is the real
 *        rule — `setCaptionText` with nothing in it would delete the words a
 *        caption needs to exist.
 * WHERE: The editor's inspector panel.
 */
export const clipLabelFormSchema = itemPatchSchema
  .pick({ label: true })
  .required();

export type ClipLabelValues = z.infer<typeof clipLabelFormSchema>;

export const audioMixFormSchema = itemPatchSchema
  .pick({ gain: true, duck: true })
  .required();

export type AudioMixValues = z.infer<typeof audioMixFormSchema>;

export const overlayPlacementFormSchema = itemPatchSchema
  .pick({ box: true, z: true })
  .required();

export type OverlayPlacementValues = z.infer<typeof overlayPlacementFormSchema>;

export const captionTextFormSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
});

export type CaptionTextValues = z.infer<typeof captionTextFormSchema>;

export const lineTextFormSchema = resynthLineSchema
  .pick({ text: true })
  .required();

export type LineTextValues = z.infer<typeof lineTextFormSchema>;
