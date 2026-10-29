/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AssetPicker, AssetPickerProps, AssetTile,
 *   ASSETS_ARE_FILTERED_BY_LANE, SELECTION_IS_THE_CALLERS,
 *   SEARCH_IS_SERVER_SIDE, GLOBAL_MEANS_CONFIGURABLE, POLL_WHILE_PROCESSING
 *
 * WHAT:  A dialog that lists the workspace's media and hands one back: the
 *        library picker the timeline editor inserts clips, images and music
 *        from.
 *
 * WHY:   GLOBAL_MEANS_CONFIGURABLE, the same contract the background and visual
 *        pickers state. This component owns the listing, the search, the paging
 *        and the tiles, and owns NO write: `onSelect` is the only way anything
 *        leaves it. That is what lets the editor turn a chosen asset into an
 *        `addItem` op against its own document and its own revision, while a
 *        different screen could write it somewhere else entirely.
 *
 *        ASSETS_ARE_FILTERED_BY_LANE. The caller passes the `kinds` that belong
 *        on the lane being filled, because the question "which media may go
 *        here" is the document's, not the media library's — `ASSET_KINDS`'
 *        own note says the kind drives "which timeline lane it may be dropped
 *        on". Showing a music bed in the picker for a video track would offer a
 *        choice the ops would then refuse.
 *
 *        SEARCH_IS_SERVER_SIDE and so is the paging: `assets.list` already
 *        clamps, counts and signs a thumbnail per row (THUMB_URLS_WITH_THE_ROWS
 *        there), so filtering a page in the browser would search only what
 *        happened to be fetched — which reads as a broken search the moment a
 *        workspace has more than one page of media.
 *
 *        POLL_WHILE_PROCESSING: an asset still being ingested has no usable
 *        variants, so it is listed as unavailable and the list refreshes while
 *        any row is unfinished. Offering it would put a clip in the timeline
 *        that the renderer cannot open yet.
 *
 * WHERE: The timeline editor's add-media control. Open to any screen that needs
 *        a piece of the workspace's media.
 */

import * as React from "react";

import type { inferRouterOutputs } from "@trpc/server";

import { trpc } from "@/trpc/react-provider";
import type { AppRouter } from "@/trpc/routers/_app";
import { useActiveOrganizationId } from "@/hooks/use-active-organization";
import { ASSET_PAGE_SIZE, type AssetKind } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/* The list refreshes while anything is still ingesting — long enough not to
 * hammer the endpoint while a dialog sits open, short enough that an upload
 * finished in another tab shows up before somebody gives up on it. */
const PROCESSING_POLL_MS = 4_000;

export interface PickedAsset {
  assetId: string;
  filename: string;
  kind: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: AssetRow, DERIVED_FROM_THE_ROUTER
 *
 * WHAT:  One row of assets.list, as the tile receives it.
 * WHY:   Indexed out of the router's own output rather than re-declared, so a
 *        column added to ASSET_LIST_SELECT reaches the tile without a
 *        hand-written DTO in between — the same choice FeatureGatesData makes.
 * WHERE: AssetTile's props.
 */
type AssetRow =
  inferRouterOutputs<AppRouter>["assets"]["list"]["items"][number];

export interface AssetPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which kinds belong on the lane being filled. */
  kinds: readonly AssetKind[];
  title: string;
  description?: string;
  onSelect: (asset: PickedAsset) => void;
}

export function AssetPicker({
  open,
  onOpenChange,
  kinds,
  title,
  description,
  onSelect,
}: AssetPickerProps) {
  const organizationId = useActiveOrganizationId();
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);

  const query = trpc.assets.list.useQuery(
    {
      organizationId: organizationId ?? "",
      page,
      pageSize: ASSET_PAGE_SIZE,
      kinds: [...kinds],
      ...(search.trim().length > 0 ? { search: search.trim() } : {}),
    },
    {
      enabled: open && organizationId !== undefined,
      retry: false,
      placeholderData: (previous) => previous,
      refetchInterval: (result) =>
        (result.state.data?.items ?? []).some(
          (asset) => asset.status !== "ready",
        )
          ? PROCESSING_POLL_MS
          : false,
    },
  );

  const items = query.data?.items ?? [];
  const totalPages = query.data?.totalPages ?? 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>

        <Input
          value={search}
          placeholder="Search your media"
          aria-label="Search your media"
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            /* Back to the first page: page 3 of the previous search is almost
               never a page of the new one. */
            setPage(1);
          }}
        />

        <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
          {query.isPending && items.length === 0
            ? Array.from({ length: 8 }, (_unused, index) => (
                <Skeleton key={index} className="aspect-video rounded-lg" />
              ))
            : items.map((asset) => (
                <AssetTile
                  key={asset.id}
                  asset={asset}
                  onSelect={() => {
                    onSelect({
                      assetId: asset.id,
                      filename: asset.filename,
                      kind: asset.kind,
                      durationSec: asset.durationSec,
                      width: asset.width,
                      height: asset.height,
                    });
                    onOpenChange(false);
                  }}
                />
              ))}
        </div>

        {!query.isPending && items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {search.trim().length > 0
              ? "Nothing matches that search."
              : "No media of this kind in this workspace yet. Upload some from the Media screen."}
          </p>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            >
              Next
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: AssetTile, UNREADY_IS_DISABLED
 *
 * WHAT:  One asset as a selectable tile.
 * WHY:   UNREADY_IS_DISABLED — an asset whose ingest has not finished has no
 *        proxy to scrub and no master to render, so it is shown with its state
 *        rather than hidden or silently offered. Hiding it would make an upload
 *        that just finished look lost; offering it would put an unopenable clip
 *        in the timeline.
 *        A real `<button>` with the asset's name as its accessible name, so the
 *        grid is usable by keyboard and the thumbnail can be decoration.
 * WHERE: AssetPicker's grid.
 */
function AssetTile({
  asset,
  onSelect,
}: {
  asset: AssetRow;
  onSelect: () => void;
}) {
  const ready = asset.status === "ready";

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!ready}
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left",
        ready ? "hover:border-primary" : "opacity-60",
      )}
    >
      <span className="flex aspect-video items-center justify-center bg-muted">
        {asset.thumbUrl === null ? (
          <span className="text-xs uppercase text-muted-foreground">
            {asset.kind.replace(/_/g, " ")}
          </span>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- a signed,
             short-lived URL on an arbitrary host; next/image would need every
             storage domain in the config and would proxy bytes we already
             serve directly. */
          <img
            src={asset.thumbUrl}
            alt=""
            aria-hidden
            className="h-full w-full object-cover"
          />
        )}
      </span>
      <span className="truncate px-2 py-1 text-xs text-foreground">
        {asset.filename}
      </span>
      <span className="px-2 pb-1 text-[10px] text-muted-foreground">
        {ready
          ? asset.durationSec === null
            ? asset.kind.replace(/_/g, " ")
            : `${asset.durationSec.toFixed(1)}s`
          : "Still processing"}
      </span>
    </button>
  );
}
