/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: MediaUpload, MediaUploadProps, UploadProgressRow,
 *   DROP_ZONE, GATE_ON_STORAGE, ACCEPT_FROM_THE_ALLOWLIST, GLOBAL_COMPONENT,
 *   DRAG_COUNTER
 *
 * WHAT:  The drop zone: drag-and-drop or click to pick files, with a progress
 *        row per file and a plain reason on each refusal.
 * WHY:   GLOBAL_COMPONENT — this lives under components/global because three
 *        phases need it and none of them should own it: Phase 02's media
 *        library, Phase 11's background import and Phase 14's visual upload.
 *        Everything specific to a surface therefore arrives as a prop — the
 *        asset `kind`, the copy, whether the zone is a full panel or a compact
 *        tile — and nothing about the media page is hardcoded in here.
 *
 *        GATE_ON_STORAGE: the zone renders its own at-limit state instead of
 *        being wrapped in <FeatureGate>. A gate wraps a single clickable
 *        trigger and intercepts its onClick, which cannot express "the drop
 *        target is also inert" — a customer at their cap would still be able to
 *        drag files onto it and watch every one fail. At the cap the zone shows
 *        the registry's own upgrade sentence and opens the upgrade modal, which
 *        is the same destination the gate would have reached.
 *
 *        ACCEPT_FROM_THE_ALLOWLIST: the `accept` attribute is generated from
 *        CONTENT_TYPE_ALLOWLIST, so the file picker offers exactly what the
 *        server will sign for. Typing a list of extensions here is how a picker
 *        ends up offering a format the API rejects.
 *
 *        DRAG_COUNTER: `dragenter`/`dragleave` fire for every child element, so
 *        a naive boolean flickers off whenever the pointer crosses the inner
 *        text. The depth counter is the fix, and it is why this is not a
 *        one-line `useState(false)`.
 * WHERE: /dashboard/media (as a panel). Phases 11 and 14 as a compact tile.
 */

import * as React from "react";
import {
  AlertCircleIcon,
  CheckIcon,
  Loader2Icon,
  UploadCloudIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/resources";
import { UPLOAD_CONTENT_TYPES, type UploadableAssetKind } from "@/lib/types";
import { useFeatureGate } from "@/components/feature-gate";
import { useUpgradeModal } from "@/components/global/upgrade-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMediaUpload, type UploadItem } from "./use-media-upload";

export interface MediaUploadProps {
  organizationId: string;
  /** Largest single file this workspace's plan accepts. */
  maxBytes: number;
  /** Intent hint passed to the server, which still derives the real kind. */
  kind?: UploadableAssetKind;
  /** Called after each confirmed upload — invalidate your list here. */
  onUploaded?: (assetId: string) => void;
  /** `panel` is the full drop area; `compact` is a tile for a picker. */
  variant?: "panel" | "compact";
  title?: string;
  description?: string;
  className?: string;
}

export function MediaUpload({
  organizationId,
  maxBytes,
  kind,
  onUploaded,
  variant = "panel",
  title = "Drop files to upload",
  description,
  className,
}: MediaUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragDepth, setDragDepth] = React.useState(0);

  /* The STORAGE gate, not an assets gate — bytes are what the plan caps
   * (BYTES_METERED_ON_STORAGE). */
  const storageGate = useFeatureGate("storage");
  const upgradeModal = useUpgradeModal();

  const { items, isUploading, addFiles, clearFinished } = useMediaUpload({
    organizationId,
    maxBytes,
    ...(kind !== undefined ? { kind } : {}),
    ...(onUploaded !== undefined ? { onUploaded } : {}),
  });

  const atLimit = storageGate?.atLimit === true;
  const isDragging = dragDepth > 0;

  const resolvedDescription =
    description ??
    `Video, image or audio — up to ${formatBytes(maxBytes)} each. Vertical versions are made automatically.`;

  function openPicker() {
    if (atLimit) {
      upgradeModal.open({
        resource: "storage",
        upgradeMessage: storageGate.upgradeMessage,
      });
      return;
    }
    inputRef.current?.click();
  }

  function handleFiles(fileList: FileList | null) {
    if (fileList === null || fileList.length === 0) return;
    addFiles(Array.from(fileList));
  }

  /* DRAG_COUNTER — see the file header. */
  function handleDragEnter(event: React.DragEvent) {
    event.preventDefault();
    setDragDepth((depth) => depth + 1);
  }

  function handleDragLeave(event: React.DragEvent) {
    event.preventDefault();
    setDragDepth((depth) => Math.max(0, depth - 1));
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragDepth(0);
    if (atLimit) {
      upgradeModal.open({
        resource: "storage",
        upgradeMessage: storageGate.upgradeMessage,
      });
      return;
    }
    handleFiles(event.dataTransfer.files);
  }

  const finishedCount = items.filter(
    (item) =>
      item.status === "done" ||
      item.status === "error" ||
      item.status === "processing",
  ).length;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <input
        ref={inputRef}
        type="file"
        multiple
        /* ACCEPT_FROM_THE_ALLOWLIST — generated, never typed out. */
        accept={UPLOAD_CONTENT_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          /* Reset so picking the SAME file twice still fires a change event. */
          event.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={openPicker}
        onDragEnter={handleDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-label={
          atLimit
            ? "Storage full — upgrade to upload"
            : "Choose files to upload"
        }
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card text-center transition-colors",
          "hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          variant === "panel" ? "px-6 py-10" : "px-4 py-6",
          isDragging && "border-primary bg-primary/5",
          atLimit && "opacity-70",
        )}
      >
        {atLimit ? (
          <>
            <AlertCircleIcon className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Your storage is full</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {/* UPGRADE_COPY_FROM_REGISTRY — the gate carries storage's own
                  sentence, resolved against the plan this workspace is on. */}
              {storageGate.upgradeMessage}
            </p>
          </>
        ) : (
          <>
            <UploadCloudIcon
              className={cn(
                "size-6",
                isDragging ? "text-primary" : "text-muted-foreground",
              )}
            />
            <p className="text-sm font-medium">{title}</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {resolvedDescription}
            </p>
          </>
        )}
      </button>

      {items.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-2 p-3">
            {items.map((item) => (
              <UploadProgressRow key={item.id} item={item} />
            ))}

            {finishedCount > 0 && !isUploading ? (
              <div className="flex justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={clearFinished}>
                  Clear
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: UploadProgressRow, PROGRESS_IS_A_DIV
 *
 * WHAT:  One file's row: name, size, state, and a progress bar while uploading.
 * WHY:   PROGRESS_IS_A_DIV — the bar is two divs with a width style rather than
 *        a new shadcn primitive. A Progress component would be a dependency and
 *        a file for one visual that appears nowhere else in the app; if a
 *        second caller ever needs it, THAT is the moment to extract it.
 *        Every colour is a theme token, including the states: `text-destructive`
 *        for a failure and `text-muted-foreground` for the pending ones, so the
 *        row reads correctly in both themes.
 * WHERE: The list inside <MediaUpload>.
 */
function UploadProgressRow({ item }: { item: UploadItem }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <StatusIcon status={item.status} />
        <p className="min-w-0 flex-1 truncate text-sm">{item.filename}</p>
        <p className="shrink-0 text-xs text-muted-foreground">
          {formatBytes(item.bytes)}
        </p>
      </div>

      {item.status === "uploading" ? (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={item.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Uploading ${item.filename}`}
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${item.progress}%` }}
          />
        </div>
      ) : null}

      {item.status === "processing" ? (
        <p className="pl-6 text-xs text-muted-foreground">
          Uploaded — making vertical and preview versions.
        </p>
      ) : null}

      {item.error !== null ? (
        <p className="pl-6 text-xs text-destructive" role="alert">
          {item.error}
        </p>
      ) : null}
    </div>
  );
}

function StatusIcon({ status }: { status: UploadItem["status"] }) {
  if (status === "error") {
    return <AlertCircleIcon className="size-4 shrink-0 text-destructive" />;
  }
  if (status === "done") {
    return <CheckIcon className="size-4 shrink-0 text-muted-foreground" />;
  }
  if (status === "queued") {
    return (
      <UploadCloudIcon className="size-4 shrink-0 text-muted-foreground" />
    );
  }
  return (
    <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
  );
}
