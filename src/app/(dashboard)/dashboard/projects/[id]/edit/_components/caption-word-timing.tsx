/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: CaptionWordTiming, WORD_LEVEL_NUDGE, NUDGE_STEP,
 *   setWordTiming, REGROUP_BY_RANGE, ONE_FRAME_IS_THE_UNIT
 *
 * WHAT:  The words a caption covers, one row each, with the controls that move
 *        a word's start or end and the ones that change which words the
 *        caption covers.
 *
 * WHY:   ONE_FRAME_IS_THE_UNIT. A nudge moves a word by one frame of the
 *        document's own fps, not by a tenth of a second: a caption is drawn
 *        per frame, so a sub-frame nudge changes nothing visible and would
 *        make the button feel broken. It is read off `doc.canvas.fps` rather
 *        than assumed, because a 24fps project and a 30fps project need
 *        different steps to move by the same amount of picture.
 *
 *        REGROUP_BY_RANGE is the phase's "regroup words", and it is done by
 *        moving the caption's BOUNDARY rather than by splitting the caption:
 *        pushing a word out of this caption is `setItemProps` on its
 *        `endWord`, which is the same edit the generator's chunker makes. A
 *        dedicated regroup op would be a second implementation of the same
 *        arithmetic.
 *
 *        Nudges are refused rather than clamped when they would cross a
 *        neighbouring word — see NEIGHBOURS_ARE_THE_BOUNDS in ops.ts — so a
 *        button at the limit reports why instead of doing nothing.
 *
 * WHERE: The inspector, under the caption text field.
 */

import * as React from "react";

import {
  framesToSeconds,
  roundSeconds,
  type Op,
  type TimelineDoc,
  type TrackItem,
} from "@/lib/timeline";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export interface CaptionWordTimingProps {
  doc: TimelineDoc;
  item: TrackItem;
  disabled: boolean;
  edit: (ops: readonly Op[]) => void;
}

export function CaptionWordTiming({
  doc,
  item,
  disabled,
  edit,
}: CaptionWordTimingProps) {
  if (!("startWord" in item)) return null;

  /* ONE_FRAME_IS_THE_UNIT — the step in seconds for this document. */
  const step = framesToSeconds(1, doc.canvas.fps);
  const words = doc.words.slice(item.startWord, item.endWord + 1);

  const nudge = (wordIndex: number, edge: "start" | "end", frames: number) => {
    const word = doc.words[wordIndex];
    if (word === undefined) return;
    const delta = frames * step;
    edit([
      {
        type: "setWordTiming",
        wordIndex,
        ...(edge === "start"
          ? { start: roundSeconds(word.s + delta) }
          : { end: roundSeconds(word.e + delta) }),
      },
    ]);
  };

  const setBoundary = (edge: "startWord" | "endWord", delta: number) => {
    const next = item[edge] + delta;
    /* Refused here rather than by the op, because `setItemProps` has no view
     * of what makes a RANGE sensible — an inverted range is caught by
     * validate(), and a button that produces one is just a bad button. */
    if (next < 0 || next >= doc.words.length) return;
    if (edge === "startWord" && next > item.endWord) return;
    if (edge === "endWord" && next < item.startWord) return;

    edit([
      { type: "setItemProps", itemId: item.id, props: { [edge]: next } },
    ]);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>Word timing</Label>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Covers words {item.startWord}–{item.endWord}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <BoundaryControl
          label="First word"
          disabled={disabled}
          onEarlier={() => setBoundary("startWord", -1)}
          onLater={() => setBoundary("startWord", 1)}
        />
        <BoundaryControl
          label="Last word"
          disabled={disabled}
          onEarlier={() => setBoundary("endWord", -1)}
          onLater={() => setBoundary("endWord", 1)}
        />
      </div>

      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {words.map((word) => (
          <li
            key={word.i}
            className="flex items-center gap-1 rounded border border-border px-2 py-1"
          >
            <span className="flex-1 truncate text-xs text-foreground">
              {word.w}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {word.s.toFixed(2)}–{word.e.toFixed(2)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Start "${word.w}" one frame earlier`}
              disabled={disabled}
              onClick={() => nudge(word.i, "start", -1)}
            >
              ⇤
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Start "${word.w}" one frame later`}
              disabled={disabled}
              onClick={() => nudge(word.i, "start", 1)}
            >
              ⇥
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`End "${word.w}" one frame earlier`}
              disabled={disabled}
              onClick={() => nudge(word.i, "end", -1)}
            >
              ⇠
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`End "${word.w}" one frame later`}
              disabled={disabled}
              onClick={() => nudge(word.i, "end", 1)}
            >
              ⇢
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BoundaryControl({
  label,
  disabled,
  onEarlier,
  onLater,
}: {
  label: string;
  disabled: boolean;
  onEarlier: () => void;
  onLater: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-1 rounded border border-border px-2 py-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="flex">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Move the ${label.toLowerCase()} back one`}
          disabled={disabled}
          onClick={onEarlier}
        >
          −
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Move the ${label.toLowerCase()} forward one`}
          disabled={disabled}
          onClick={onLater}
        >
          +
        </Button>
      </div>
    </div>
  );
}
