/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: MediaTable, DataTable, usePaginatedFilters,
 *   AssetRow, MediaPreviewCell, ASSET_STATUS_BADGE, POLL_WHILE_PROCESSING,
 *   SERVER_TOTAL_PAGES, SIGNED_THUMB_NOT_NEXT_IMAGE
 *
 * WHAT:  The media library table: preview, name, type, size, length, status,
 *        and a row menu.
 * WHY:   POLL_WHILE_PROCESSING is the one behaviour here that is not on the
 *        projects table. An upload lands as `processing` and becomes `ready`
 *        when a workflow finishes seconds or minutes later, with nothing
 *        pushing that to the browser — so while any visible row is still
 *        processing, the query refetches on an interval, and the moment none
 *        is, it stops. Without it a customer uploads a file, sees "Processing",
 *        and has to guess that a reload would help.
 *
 *        SIGNED_THUMB_NOT_NEXT_IMAGE: thumbnails render through a plain `<img>`
 *        rather than `next/image`. The URL is a short-lived SIGNED url with a
 *        query string, so it is uncacheable and unique per request — exactly
 *        what the image optimiser cannot help with, and routing it through
 *        `/_next/image` would make the server fetch every tile on every page
 *        view. `loading="lazy"` does the real work on a 24-tile grid.
 *        (next.config.ts does carry the R2 public host, for the PUBLIC library
 *        images Phase 11 serves unsigned — those are the ones next/image is
 *        for.)
 * WHERE: Rendered by MediaLibrary.
 */

import * as React from "react";
import { FileAudioIcon, FileVideoIcon, ImageIcon } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/trpc/routers/_app";
import { trpc } from "@/trpc/react-provider";
import { formatBytes } from "@/lib/resources";
import {
  ASSET_FILTER_DEFAULTS,
  ASSET_PAGE_SIZE,
  mediaFamilyOf,
  normalizeAssetFilters,
  type AssetFilterValues,
} from "@/lib/types";
import {
  DataTable,
  type DataTableColumn,
  usePaginatedFilters,
} from "@/components/global/data-table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaFilters, kindLabel, statusLabel } from "./media-filters";
import { MediaRowActions } from "./media-row-actions";

type AssetRow =
  inferRouterOutputs<AppRouter>["assets"]["list"]["items"][number];

/** How often to re-ask while something is still being processed. Long enough
 *  not to hammer the API, short enough that a 10-second ingest is seen. */
const PROCESSING_POLL_MS = 4000;

/**
 * SOURCE OF TRUTH KEYWORDS: ASSET_STATUS_BADGE
 *
 * WHAT:  Which badge each status wears.
 * WHY:   Same shape and same reasoning as STATUS_BADGE_VARIANT on the projects
 *        table: `failed` is the only destructive one, `ready` is `secondary`
 *        rather than a colour because most rows are ready, and an unrecognised
 *        value falls back to `outline` so it still renders.
 * WHERE: The status column below.
 */
const ASSET_STATUS_BADGE: Readonly<
  Record<string, "default" | "secondary" | "destructive" | "outline">
> = {
  processing: "default",
  ready: "secondary",
  failed: "destructive",
};

/**
 * SOURCE OF TRUTH KEYWORDS: MediaPreviewCell, SIGNED_THUMB_NOT_NEXT_IMAGE
 *
 * WHAT:  The thumbnail, or the icon that stands in for one.
 * WHY:   Three cases, and all three are normal rather than exceptional: a video
 *        or image that has been ingested has a thumb; audio never will, because
 *        nothing in a waveform is worth 40 pixels; and anything still
 *        processing has not got one yet. The icon is chosen from the content
 *        type's FAMILY, so a new accepted format gets the right icon without a
 *        change here.
 * WHERE: The first column.
 */
function MediaPreviewCell({ asset }: { asset: AssetRow }) {
  const family = mediaFamilyOf(asset.contentType);

  if (asset.thumbUrl !== null) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- SIGNED_THUMB_NOT_NEXT_IMAGE: see the file header.
      <img
        src={asset.thumbUrl}
        alt=""
        loading="lazy"
        className="h-10 w-10 shrink-0 rounded-md border border-border bg-muted object-cover"
      />
    );
  }

  const Icon =
    family === "audio"
      ? FileAudioIcon
      : family === "image"
        ? ImageIcon
        : FileVideoIcon;

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
      <Icon className="size-4 text-muted-foreground" />
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: formatDuration
 *
 * WHAT:  Seconds as `m:ss`, or an em dash when there is no duration.
 * WHY:   An image and a still have no length, and `0:00` would read as a clip
 *        of nothing rather than as "not applicable".
 * WHERE: The length column.
 */
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

const columns: readonly DataTableColumn<AssetRow>[] = [
  {
    id: "file",
    header: "File",
    cell: (asset) => (
      <div className="flex min-w-0 items-center gap-3">
        <MediaPreviewCell asset={asset} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{asset.filename}</p>
          <p className="truncate text-xs text-muted-foreground">
            {kindLabel(asset.kind)}
            {asset.organizationId === null ? " · library" : ""}
            {asset.width !== null && asset.height !== null
              ? ` · ${asset.width}×${asset.height}`
              : ""}
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "size",
    header: "Size",
    hideOnMobile: true,
    className: "text-muted-foreground whitespace-nowrap",
    cell: (asset) => formatBytes(asset.bytes),
  },
  {
    id: "length",
    header: "Length",
    hideOnMobile: true,
    className: "text-muted-foreground whitespace-nowrap",
    cell: (asset) => formatDuration(asset.durationSec),
  },
  {
    id: "status",
    header: "Status",
    className: "text-right",
    cell: (asset) => (
      <div className="flex flex-col items-end gap-1">
        <Badge variant={ASSET_STATUS_BADGE[asset.status] ?? "outline"}>
          {statusLabel(asset.status)}
        </Badge>
        {/* The readable reason an ingest refused the file, right where the
            customer is looking for it. Truncated in the cell; the full text is
            on the row's title attribute. */}
        {asset.status === "failed" && asset.error !== null ? (
          <p
            className="max-w-[18rem] truncate text-xs text-destructive"
            title={asset.error}
          >
            {asset.error}
          </p>
        ) : null}
      </div>
    ),
  },
];

export function MediaTable({
  organizationId,
}: {
  organizationId: string | undefined;
}) {
  const { filters, setFilters, applied, page, setPage, isFiltered } =
    usePaginatedFilters<
      AssetFilterValues,
      ReturnType<typeof normalizeAssetFilters>
    >({
      defaults: ASSET_FILTER_DEFAULTS,
      searchKey: "search",
      normalize: normalizeAssetFilters,
    });

  const enabled = organizationId !== undefined;

  const query = trpc.assets.list.useQuery(
    {
      organizationId: organizationId ?? "",
      page,
      pageSize: ASSET_PAGE_SIZE,
      ...applied,
    },
    {
      enabled,
      placeholderData: (previous) => previous,
      retry: false,
      /* POLL_WHILE_PROCESSING — see the file header. The predicate form means
       * the interval is re-evaluated after every fetch, so polling stops by
       * itself the moment the last row goes ready. */
      refetchInterval: (query) =>
        (query.state.data?.items ?? []).some(
          (asset) => asset.status === "processing",
        )
          ? PROCESSING_POLL_MS
          : false,
    },
  );

  /* The active organization resolves on the client, so the first paint has no
   * id to query with — a skeleton is the honest state, as on the projects
   * table. An empty grid would read as "you have no media". */
  if (!enabled) return <Skeleton className="h-64 w-full" />;

  const data = query.data;

  return (
    <DataTable<AssetRow>
      columns={columns}
      rows={data?.items ?? []}
      getRowId={(asset) => asset.id}
      total={data?.total ?? 0}
      page={page}
      pageSize={ASSET_PAGE_SIZE}
      {...(data?.totalPages !== undefined
        ? { totalPages: data.totalPages }
        : {})}
      onPageChange={setPage}
      isLoading={query.isPending && data === undefined}
      isFetching={query.isFetching}
      error={query.error?.message ?? null}
      isFiltered={isFiltered}
      toolbar={<MediaFilters values={filters} onChange={setFilters} />}
      rowActions={(asset) =>
        organizationId === undefined ? null : (
          <MediaRowActions organizationId={organizationId} asset={asset} />
        )
      }
      empty="No media yet. Upload a file to get started."
      emptyFiltered="No media matches these filters."
      countLabel={["file", "files"]}
    />
  );
}
