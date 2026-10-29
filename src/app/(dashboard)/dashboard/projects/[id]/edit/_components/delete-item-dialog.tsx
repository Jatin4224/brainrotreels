/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: DeleteItemDialog, DELETING_A_SCENE_ASKS,
 *   captionsOver, CaptionOrphanPolicy, ONE_GESTURE_ONE_UNDO
 *
 * WHAT:  The confirmation for deleting a clip, which becomes a QUESTION when
 *        the clip has captions over it: keep them, or delete them too.
 *
 * WHY:   DELETING_A_SCENE_ASKS is one of the phase's guards, and it is a
 *        question rather than a rule because both answers are right sometimes
 *        — cutting a scene whose narration is also going means the captions
 *        go with it, and trimming a visual while keeping the voice means they
 *        stay. The ops layer will not decide this for us: `delete` removes the
 *        item it names and nothing else, deliberately, so a scene deleted
 *        without asking leaves captions hanging over nothing.
 *
 *        ONE_GESTURE_ONE_UNDO: whichever answer is given, the ops go to `edit`
 *        in ONE call, so "delete this scene and its four captions" costs one
 *        undo step rather than five.
 *
 *        The plain case still confirms, but without the choice — a delete is
 *        one keystroke away (KEYBOARD_IS_THE_EDITOR) and undo is in memory
 *        only, so the dialog is the cheapest guard available against deleting
 *        the wrong thing.
 *
 *        The caller KEYS this component on the target, so the choice resets
 *        per clip without an effect — a previous "delete them too" carrying
 *        silently into the next clip is the one mistake a confirmation dialog
 *        must not make.
 * WHERE: Opened by the inspector's delete button and by the editor's Delete
 *        shortcut.
 */

import * as React from "react";

import {
  itemSpan,
  TIME_EPSILON,
  type Op,
  type TimelineDoc,
  type Track,
  type TrackItem,
} from "@/lib/timeline";
import {
  CAPTION_ORPHAN_POLICIES,
  captionOrphanPolicySchema,
  type CaptionOrphanPolicy,
} from "@/lib/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const POLICY_COPY: Readonly<
  Record<CaptionOrphanPolicy, { title: string; detail: string }>
> = {
  keep: {
    title: "Keep the captions",
    detail: "The words stay on screen over whatever follows.",
  },
  delete: {
    title: "Delete them too",
    detail: "The captions over this clip are removed with it.",
  },
};

export interface DeleteItemDialogProps {
  doc: TimelineDoc;
  target: { track: Track; item: TrackItem } | null;
  ripple: boolean;
  onClose: () => void;
  edit: (ops: readonly Op[]) => void;
}

export function DeleteItemDialog({
  doc,
  target,
  ripple,
  onClose,
  edit,
}: DeleteItemDialogProps) {
  const [policy, setPolicy] = React.useState<CaptionOrphanPolicy>("keep");

  const captions = React.useMemo(
    () => (target === null ? [] : captionsOver(doc, target.item)),
    [doc, target],
  );

  if (target === null) return null;

  const asks = captions.length > 0 && target.track.type !== "caption";

  const confirm = () => {
    const ops: Op[] = [
      { type: "delete", itemId: target.item.id, ripple },
    ];
    if (asks && captionOrphanPolicySchema.parse(policy) === "delete") {
      for (const caption of captions)
        ops.push({ type: "delete", itemId: caption.id, ripple: false });
    }
    edit(ops);
    onClose();
  };

  return (
    <AlertDialog open onOpenChange={(open) => (open ? null : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {target.item.label ?? target.item.id}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {asks
              ? `${captions.length} caption${captions.length === 1 ? "" : "s"} sit over this clip. Choose what happens to them.`
              : ripple
                ? "Everything after it moves back to close the gap."
                : "It leaves a gap where it was."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {asks ? (
          <div
            role="radiogroup"
            aria-label="What happens to the captions"
            className="flex flex-col gap-2"
          >
            {CAPTION_ORPHAN_POLICIES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={policy === option}
                onClick={() => setPolicy(option)}
                className={cn(
                  "rounded-lg border border-border p-3 text-left",
                  policy === option && "border-primary bg-primary/5",
                )}
              >
                <Label className="cursor-pointer">
                  {POLICY_COPY[option].title}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {POLICY_COPY[option].detail}
                </p>
              </button>
            ))}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: captionsOver, OVERLAP_NOT_CONTAINMENT
 *
 * WHAT:  The caption items whose span overlaps this item's.
 * WHY:   OVERLAP_NOT_CONTAINMENT. A caption that merely STARTS inside the clip
 *        and runs past its end is still a caption over this clip, and the
 *        narrower containment test would quietly leave it behind — which is
 *        the orphan the dialog exists to prevent. The epsilon keeps two clips
 *        that merely butt-join from counting as an overlap.
 * WHERE: DeleteItemDialog.
 */
function captionsOver(
  doc: TimelineDoc,
  item: TrackItem,
): readonly TrackItem[] {
  const span = itemSpan(item, doc.words);
  if (span === null) return [];

  const found: TrackItem[] = [];
  for (const track of doc.tracks) {
    if (track.type !== "caption") continue;
    for (const caption of track.items) {
      const captionSpan = itemSpan(caption, doc.words);
      if (captionSpan === null) continue;
      if (
        captionSpan.start < span.end - TIME_EPSILON &&
        captionSpan.end > span.start + TIME_EPSILON
      )
        found.push(caption);
    }
  }
  return found;
}
