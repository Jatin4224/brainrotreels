/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: TimelineEditor, EditorToolbar, SaveIndicator,
 *   ConflictBanner, DesktopOnlyNotice, HistoryMenu,
 *   SAME_COMPONENT_AS_THE_RENDER, PLAYER_FOLLOWS_THE_DOCUMENT,
 *   CONFLICT_IS_OFFERED_NOT_FORCED, DESKTOP_ONLY_IS_STATED,
 *   PERMISSION_IS_A_COURTESY
 *
 * WHAT:  The editor screen: preview top-left, inspector right, five tracks
 *        along the bottom, with the toolbar, the save indicator, the conflict
 *        banner and the export panel.
 *
 * WHY:   SAME_COMPONENT_AS_THE_RENDER, as on the preview screen: `<Player>` is
 *        handed `TimelineRenderer`, the identical component the Lambda render
 *        uses, so what somebody edits against IS the output at a different
 *        resolution. The only difference is which variant each asset resolves
 *        to — `proxy_480` here (PROXY_FOR_SCRUBBING), the master there.
 *
 *        PLAYER_FOLLOWS_THE_DOCUMENT. The Player is re-keyed on the
 *        composition's frame count, because Remotion's player caches its
 *        duration: a trim that shortens the video would otherwise leave the
 *        scrubber claiming the old length and the last second unplayable.
 *
 *        CONFLICT_IS_OFFERED_NOT_FORCED: the banner is the whole of the
 *        conflict handling the phase asks for. It stops the autosave and
 *        offers a reload — it never reloads by itself, because the unsaved
 *        work is on this screen.
 *
 *        DESKTOP_ONLY_IS_STATED, the phase's own instruction: below
 *        EDITOR_MIN_WIDTH_PX the screen says what it needs instead of
 *        rendering a five-lane timeline nobody can hit. A notice, not a
 *        redirect — somebody who opened a link on a phone should be told, and
 *        should still be able to reach the preview.
 *
 *        PERMISSION_IS_A_COURTESY. The controls are disabled without
 *        `projects:update`, and that is a courtesy: `applyOps` re-checks it,
 *        and the whole router is refused outright for a plan without the
 *        editor (GATE_IS_THE_WHOLE_ROUTER).
 *
 * WHERE: Mounted by the edit page's server component.
 */

import * as React from "react";
import Link from "next/link";
import { Player } from "@remotion/player";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { permissions } from "@/lib/permissions";
import { TimelineRenderer } from "@/remotion/timeline-renderer";
import { RenderPanel } from "@/components/global/render-panel";
import { EDITOR_MIN_WIDTH_PX } from "@/lib/types";
import type { TimelineDoc, Track, TrackItem } from "@/lib/timeline";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { AddMediaButton } from "./add-media-button";
import { DeleteItemDialog } from "./delete-item-dialog";
import { OverlayCanvas } from "./overlay-canvas";
import { TimelineInspector } from "./timeline-inspector";
import { TimelineTracks } from "./timeline-tracks";
import { useTimelineEditor, type SaveState } from "./use-timeline-editor";

const SAVE_COPY: Readonly<Record<SaveState, string>> = {
  idle: "No changes",
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  conflict: "Not saved",
};

export function TimelineEditor({ projectId }: { projectId: string }) {
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const canEdit = hasPermission(permissions.PROJECTS_UPDATE);

  const editor = useTimelineEditor(projectId);
  const [deleting, setDeleting] = React.useState<{
    track: Track;
    item: TrackItem;
  } | null>(null);

  if (editor.isLoading) {
    return <Skeleton className="h-[40rem] w-full rounded-xl" />;
  }

  if (editor.loadError !== null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>This project could not be opened for editing</AlertTitle>
        <AlertDescription>{editor.loadError}</AlertDescription>
      </Alert>
    );
  }

  if (editor.emptyReason !== null || editor.doc === null) {
    return <EmptyEditor projectId={projectId} reason={editor.emptyReason} />;
  }

  const composition = editor.composition;

  return (
    <div className="flex flex-col gap-4">
      <DesktopOnlyNotice />

      {editor.saveState === "conflict" ? (
        <ConflictBanner onReload={editor.reload} />
      ) : null}

      {editor.documentErrors.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>This change was not saved</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {editor.documentErrors.slice(0, 4).map((error) => (
                <li key={`${error.path}-${error.message}`}>{error.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <EditorToolbar
        editor={editor}
        doc={editor.doc}
        canEdit={canEdit}
        projectId={projectId}
      />

      <div className="hidden gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex justify-center p-4">
              {composition === null ? (
                <Skeleton className="aspect-[9/16] w-full max-w-xs rounded-lg" />
              ) : (
                <div className="relative" style={{ width: "100%", maxWidth: 300 }}>
                <Player
                  /* PLAYER_FOLLOWS_THE_DOCUMENT — re-keyed so a trim that
                     changes the length is reflected in the scrubber. */
                  key={composition.durationInFrames}
                  component={TimelineRenderer}
                  compositionWidth={composition.width}
                  compositionHeight={composition.height}
                  durationInFrames={composition.durationInFrames}
                  fps={composition.fps}
                  inputProps={{ doc: editor.doc, assets: editor.assets }}
                  controls
                  acknowledgeRemotionLicense
                  className="overflow-hidden rounded-lg border border-border bg-card"
                  style={{
                    width: "100%",
                    aspectRatio: `${composition.width} / ${composition.height}`,
                  }}
                />
                {/* The drag layer sits OVER the player and only draws for a
                    selected overlay — see ONLY_THE_SELECTED_OVERLAY. */}
                <OverlayCanvas
                  item={
                    editor.selected?.track.type === "overlay"
                      ? editor.selected.item
                      : null
                  }
                  disabled={!canEdit}
                  edit={editor.edit}
                />
                </div>
              )}
            </CardContent>
          </Card>

          <TimelineTracks
            doc={editor.doc}
            length={editor.length}
            playhead={editor.playhead}
            selectedItemId={editor.selectedItemId}
            ripple={editor.ripple}
            onSeek={editor.seek}
            onSelect={editor.select}
            edit={canEdit ? editor.edit : noEdit}
          />
        </div>

        <div className="flex flex-col gap-4">
          <TimelineInspector
            doc={editor.doc}
            projectId={projectId}
            organizationId={organizationId ?? ""}
            selected={editor.selected}
            lines={editor.lines}
            canEdit={canEdit}
            edit={canEdit ? editor.edit : noEdit}
            onDelete={(item, track) => setDeleting({ item, track })}
          />
          <RenderPanel projectId={projectId} />
        </div>
      </div>

      <DeleteItemDialog
        /* Keyed on the target so the caption choice resets per clip — see
           DeleteItemDialog's header for why that must not be an effect. */
        key={deleting?.item.id ?? "none"}
        doc={editor.doc}
        target={deleting}
        ripple={editor.ripple}
        onClose={() => setDeleting(null)}
        edit={editor.edit}
      />
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: EditorToolbar, SaveIndicator, HistoryMenu,
 *   RIPPLE_IS_A_MODE
 *
 * WHAT:  Undo, redo, ripple, split, the save indicator and the version menu.
 * WHY:   RIPPLE_IS_A_MODE rather than a modifier key, because it changes what
 *        every subsequent drag and delete MEANS and a customer needs to see
 *        which way it is set before they commit a gesture. A held key would
 *        make the same drag do two different things with nothing on screen to
 *        say which.
 * WHERE: The top of the editor.
 */
function EditorToolbar({
  editor,
  doc,
  canEdit,
  projectId,
}: {
  editor: ReturnType<typeof useTimelineEditor>;
  /* Narrowed by the caller: the toolbar is only rendered once there is a
     document, and the add control needs one to build an op against. */
  doc: TimelineDoc;
  canEdit: boolean;
  projectId: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
      <AddMediaButton
        doc={doc}
        playhead={editor.playhead}
        disabled={!canEdit}
        edit={editor.edit}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={!canEdit || !editor.canUndo}
        onClick={editor.undo}
      >
        Undo
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!canEdit || !editor.canRedo}
        onClick={editor.redo}
      >
        Redo
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!canEdit || editor.selectedItemId === null}
        onClick={() =>
          editor.selectedItemId !== null &&
          editor.edit([
            {
              type: "split",
              itemId: editor.selectedItemId,
              at: editor.playhead,
            },
          ])
        }
      >
        Split at playhead
      </Button>

      <div className="flex items-center gap-2 pl-2">
        <Switch
          id="ripple"
          checked={editor.ripple}
          onCheckedChange={editor.setRipple}
          disabled={!canEdit}
        />
        <Label htmlFor="ripple" className="text-xs">
          Ripple
        </Label>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Badge
          variant={
            editor.saveState === "conflict"
              ? "destructive"
              : editor.saveState === "saved"
                ? "secondary"
                : "outline"
          }
        >
          {SAVE_COPY[editor.saveState]}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canEdit || editor.saveState !== "dirty"}
          onClick={editor.saveNow}
        >
          Save now
        </Button>
        <HistoryMenu projectId={projectId} canEdit={canEdit} />
        <Link
          href={`/dashboard/projects/${projectId}/preview`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Preview
        </Link>
      </div>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: HistoryMenu, timelineEditor.restore,
 *   SNAPSHOTS_ARE_THE_DEEPER_UNDO
 *
 * WHAT:  The restore points, newest first.
 * WHY:   SNAPSHOTS_ARE_THE_DEEPER_UNDO. The in-memory stack covers this
 *        session's last fifty gestures; this covers "the autosave two minutes
 *        ago wrote something I did not mean", which is what the phase asks
 *        snapshots to be for. The list is only fetched when the menu is
 *        opened, because most sessions never need it.
 * WHERE: The toolbar.
 */
function HistoryMenu({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const organizationId = useActiveOrganizationId();
  const [open, setOpen] = React.useState(false);
  const utils = trpc.useUtils();

  const revisions = trpc.timelineEditor.revisions.useQuery(
    { organizationId: organizationId ?? "", projectId },
    { enabled: open && organizationId !== undefined, retry: false },
  );

  const restore = trpc.timelineEditor.restore.useMutation({
    onSuccess: (result) => {
      if (result.status === "applied") {
        toast.success("Restored that version.");
        void utils.timelineEditor.open.invalidate();
        void utils.timelineEditor.revisions.invalidate();
        return;
      }
      toast.error(
        result.status === "conflict"
          ? "Somebody else saved while that was restoring. Reload and try again."
          : "That version is no longer valid and was not restored.",
      );
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" disabled={!canEdit}>
            History
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Restore a saved version</DropdownMenuLabel>
        {revisions.isPending ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : (revisions.data?.length ?? 0) === 0 ? (
          <DropdownMenuItem disabled>No saved versions yet</DropdownMenuItem>
        ) : (
          revisions.data?.map((entry) => (
            <DropdownMenuItem
              key={entry.revision}
              disabled={restore.isPending}
              onClick={() =>
                restore.mutate({
                  organizationId: organizationId ?? "",
                  projectId,
                  revision: entry.revision,
                })
              }
            >
              Version {entry.revision}
              <span className="ml-auto text-xs text-muted-foreground">
                {entry.createdAt.toLocaleTimeString()}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConflictBanner({ onReload }: { onReload: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Somebody else saved this timeline</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>
          Your last change was not saved, and nothing of theirs has been
          overwritten. Reloading takes their version and discards the edits on
          this screen.
        </span>
        <Button variant="outline" size="sm" onClick={onReload}>
          Reload their version
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/* DESKTOP_ONLY_IS_STATED. Rendered as the lg-hidden counterpart of the editor
 * grid, so the breakpoint is declared once in CSS rather than measured in
 * JavaScript — a width read on mount is wrong after the first resize. */
function DesktopOnlyNotice() {
  return (
    <Alert className="lg:hidden">
      <AlertTitle>The editor needs a wider screen</AlertTitle>
      <AlertDescription>
        Five tracks with draggable edges need at least {EDITOR_MIN_WIDTH_PX}px.
        Open this project on a desktop to edit it — everything else about it
        works here.
      </AlertDescription>
    </Alert>
  );
}

function EmptyEditor({
  projectId,
  reason,
}: {
  projectId: string;
  reason: "no-timeline" | "unreadable" | null;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
        {reason === "unreadable" ? (
          <>
            <p className="font-medium text-foreground">
              This timeline could not be read
            </p>
            <p>
              It was written in a format this version cannot open, so it cannot
              be edited. Nothing has been lost — please contact support with the
              project name.
            </p>
          </>
        ) : (
          <>
            <p className="font-medium text-foreground">Nothing to edit yet</p>
            <p>Generate this project first, then come back to fine-tune it.</p>
            <Link
              href={`/dashboard/projects/${projectId}/generate`}
              className={cn(buttonVariants({ variant: "default", size: "sm" }))}
            >
              Go to generate
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* The no-permission substitute for `edit`. A function rather than leaving the
 * controls wired and letting the server refuse: a gesture that silently fails
 * is worse than one that cannot be started, and the controls are disabled
 * anyway — this is what keeps a keyboard shortcut from slipping past them. */
function noEdit(): void {
  toast.error("You do not have permission to edit this project.");
}
