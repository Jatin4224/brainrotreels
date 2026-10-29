/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AddMediaButton, LANE_TARGETS, insertAsset,
 *   INSERT_LANDS_AT_THE_PLAYHEAD, KINDS_FOLLOW_THE_LANE,
 *   ADD_REGISTERS_ITS_ASSET, MUSIC_IS_AN_AUDIO_LANE
 *
 * WHAT:  The "add" control: pick a lane, pick a piece of the workspace's
 *        media, and it lands on that lane as one `addItem`.
 *
 * WHY:   KINDS_FOLLOW_THE_LANE. Each target declares which asset kinds may go
 *        on it, because that question belongs to the DOCUMENT rather than to
 *        the media library — `ASSET_KINDS` says the kind decides "which
 *        timeline lane it may be dropped on". Offering a music bed for a video
 *        lane would be offering a choice the ops then refuse.
 *
 *        MUSIC_IS_AN_AUDIO_LANE, which is why there is no separate music
 *        picker: a music bed is an audio item with `duck` on, and the phase's
 *        "music picker" and "insert from the media library" are the same
 *        gesture against the same lane. One control that can reach every lane
 *        is less to learn than four that each reach one.
 *
 *        INSERT_LANDS_AT_THE_PLAYHEAD and runs for the asset's own duration,
 *        falling back to a few seconds for a still. That is the position the
 *        customer was looking at, and it is adjustable by the same drag as
 *        everything else — so the insert does not need to ask.
 *
 *        ADD_REGISTERS_ITS_ASSET: the op carries the `doc.assets` entry with
 *        it, because an item naming a handle the document has never heard of
 *        fails validation. See that keyword in ops.ts for why the two halves
 *        are one op.
 *
 * WHERE: The editor's toolbar.
 */

import * as React from "react";

import {
  roundSeconds,
  type AssetRef,
  type Op,
  type TimelineDoc,
  type Track,
} from "@/lib/timeline";
import type { AssetKind } from "@/lib/types";
import { AssetPicker, type PickedAsset } from "@/components/global/asset-picker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * SOURCE OF TRUTH KEYWORDS: LANE_TARGETS, LaneTarget, KINDS_FOLLOW_THE_LANE
 *
 * WHAT:  What can be added, where it goes, and which media is offered for it.
 * WHY:   A table rather than a switch, so adding a lane type is a row. Each
 *        entry names the asset kinds that lane accepts and the `AssetRef.kind`
 *        the document should record — two different vocabularies that are easy
 *        to conflate: `audio_music` is an ASSET kind, `audio` is what the
 *        document calls the media behind the handle.
 * WHERE: The menu below; insertAsset's item construction.
 */
interface LaneTarget {
  id: string;
  label: string;
  trackType: Track["type"];
  kinds: readonly AssetKind[];
  refKind: AssetRef["kind"];
  /** Seconds to use when the asset has no duration of its own (a still). */
  fallbackSeconds: number;
  duck: boolean;
}

const LANE_TARGETS: readonly LaneTarget[] = [
  {
    id: "clip",
    label: "Video clip",
    trackType: "video",
    kinds: ["upload", "background", "ai_footage"],
    refKind: "video",
    fallbackSeconds: 3,
    duck: false,
  },
  {
    id: "image",
    label: "Image overlay",
    trackType: "overlay",
    kinds: ["image", "upload", "avatar"],
    refKind: "image",
    fallbackSeconds: 3,
    duck: false,
  },
  {
    id: "music",
    label: "Music bed",
    trackType: "audio",
    kinds: ["audio_music"],
    refKind: "audio",
    fallbackSeconds: 15,
    /* MUSIC_IS_AN_AUDIO_LANE — ducking on by default, because a bed at full
     * level under narration is the single most common way one of these videos
     * comes out unwatchable. */
    duck: true,
  },
  {
    id: "sfx",
    label: "Sound effect",
    trackType: "audio",
    kinds: ["sfx", "upload"],
    refKind: "audio",
    fallbackSeconds: 2,
    duck: false,
  },
];

export interface AddMediaButtonProps {
  doc: TimelineDoc;
  playhead: number;
  disabled: boolean;
  edit: (ops: readonly Op[]) => void;
}

export function AddMediaButton({
  doc,
  playhead,
  disabled,
  edit,
}: AddMediaButtonProps) {
  const [target, setTarget] = React.useState<LaneTarget | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" disabled={disabled}>
              Add media
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Add at the playhead</DropdownMenuLabel>
          {LANE_TARGETS.map((lane) => (
            <DropdownMenuItem
              key={lane.id}
              disabled={findLane(doc, lane.trackType) === null}
              onClick={() => setTarget(lane)}
            >
              {lane.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {target === null ? null : (
        <AssetPicker
          open
          onOpenChange={(open) => (open ? null : setTarget(null))}
          kinds={target.kinds}
          title={`Add a ${target.label.toLowerCase()}`}
          description={`It lands at ${playhead.toFixed(2)}s and can be dragged from there.`}
          onSelect={(asset) => {
            const op = insertAsset(doc, target, asset, playhead);
            if (op !== null) edit([op]);
            setTarget(null);
          }}
        />
      )}
    </>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: insertAsset, INSERT_LANDS_AT_THE_PLAYHEAD,
 *   HANDLE_IS_DERIVED_FROM_THE_ASSET_ID
 *
 * WHAT:  Builds the one `addItem` op that puts this asset on that lane.
 *
 * WHY:   HANDLE_IS_DERIVED_FROM_THE_ASSET_ID. The document's handle is the
 *        asset's own id, so inserting the same media twice reuses one
 *        `doc.assets` entry rather than growing a second — and the op's
 *        re-point refusal (ADD_REGISTERS_ITS_ASSET) can never fire for a
 *        handle we built this way, because the same id always derives the same
 *        handle.
 *
 *        The item id is minted from the asset and the position, so two inserts
 *        of the same clip at the same moment collide on DUPLICATE_ID rather
 *        than silently stacking — which is what a double-clicked menu item
 *        would otherwise do.
 *
 *        Returns null rather than throwing when the lane is missing: the menu
 *        item is already disabled for that case, and this is the second check
 *        on a document that may have changed since the menu opened.
 * WHERE: AddMediaButton's onSelect.
 */
function insertAsset(
  doc: TimelineDoc,
  lane: LaneTarget,
  asset: PickedAsset,
  playhead: number,
): Op | null {
  const track = findLane(doc, lane.trackType);
  if (track === null) return null;

  const handle = `a_${asset.assetId}`;
  const start = roundSeconds(Math.max(0, playhead));
  const duration = roundSeconds(asset.durationSec ?? lane.fallbackSeconds);
  const id = `${lane.id}_${asset.assetId}_${Math.round(start * 1000)}`;

  const ref: AssetRef = {
    assetId: asset.assetId,
    kind: lane.refKind,
    /* `owned` because this is the workspace's own media out of its own
     * library. A stock or generated clip reaches a document through the
     * visuals pipeline, which records the licence it actually came with. */
    license: "owned",
    ...(asset.durationSec !== null
      ? { durationInSeconds: asset.durationSec }
      : {}),
    ...(asset.width !== null ? { width: asset.width } : {}),
    ...(asset.height !== null ? { height: asset.height } : {}),
  };

  if (lane.trackType === "overlay") {
    return {
      type: "addOverlay",
      trackId: track.id,
      asset: ref,
      item: {
        id,
        label: asset.filename,
        start,
        duration,
        render: "media",
        assetId: handle,
        /* A depth above everything currently on the lane, so a new overlay is
         * visible rather than hidden behind one — and cannot collide
         * (Z_IS_EXPLICIT). */
        z: nextDepth(track),
        box: { x: 0.1, y: 0.1, w: 0.5, h: 0.3 },
      },
    };
  }

  return {
    type: "addItem",
    trackId: track.id,
    ripple: false,
    asset: ref,
    item: {
      id,
      label: asset.filename,
      start,
      duration,
      assetId: handle,
      ...(lane.trackType === "audio"
        ? { gain: 1, duck: lane.duck, loop: false }
        : { fit: "cover", loop: false, muted: true, render: "media" }),
    },
  };
}

function findLane(doc: TimelineDoc, type: Track["type"]): Track | null {
  return doc.tracks.find((track) => track.type === type) ?? null;
}

/* One above the highest depth on the lane. Overlays that are on screen
 * together may not share a `z` — validate() refuses it — so a new one has to
 * claim a depth nothing else holds. */
function nextDepth(track: Track): number {
  let highest = -1;
  for (const item of track.items) {
    if ("z" in item && typeof item.z === "number" && item.z > highest)
      highest = item.z;
  }
  return highest + 1;
}
