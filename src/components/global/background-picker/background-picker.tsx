/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: BackgroundPicker, BackgroundPickerProps,
 *   BackgroundTileButton, RADIOGROUP_NOT_A_LIST_OF_BUTTONS, ROVING_TABINDEX,
 *   LOCKED_NOT_HIDDEN, UPLOAD_TILE_IS_THE_SHARED_COMPONENT,
 *   SELECTION_IS_THE_SERVER_S, BACKDROP_IS_A_CHOICE
 *
 * WHAT:  The background chooser: a grid of catalogue loops and the workspace's
 *        own clips, a tile for "no footage", and an upload tile.
 *
 * WHY:   RADIOGROUP_NOT_A_LIST_OF_BUTTONS. The tiles are a single-select, so
 *        they are a `radiogroup` of `radio`s rather than twenty buttons — which
 *        is what the phase's "fully keyboard navigable" actually requires. A
 *        grid of buttons is reachable with Tab, but it makes a screen-reader
 *        user hear twenty unrelated controls instead of one choice with twenty
 *        options, and it puts twenty stops between the grid and whatever
 *        follows it.
 *
 *        ROVING_TABINDEX is the other half of that pattern: exactly one tile is
 *        tabbable and the arrow keys move within the group. The COLUMN COUNT is
 *        measured from the laid-out tiles rather than hard-coded, because the
 *        grid is responsive — Up and Down have to move a row, and a constant
 *        here would move the wrong distance at every breakpoint but one.
 *
 *        LOCKED_NOT_HIDDEN. A locked tile is rendered, focusable and
 *        selectable-looking, and choosing it opens the upgrade modal instead of
 *        applying. Hiding it would remove the upsell; disabling it would take
 *        it out of the keyboard order, so a customer navigating with a keyboard
 *        could not find out that the thing exists.
 *
 *        SELECTION_IS_THE_SERVER_S. There is no local "selected" state. The
 *        highlighted tile comes from the list query, which gets it from the
 *        same resolver the pipeline uses (ONE_RESOLVER_TWO_CALLERS), so the
 *        tile shown as selected is the row that will be in the video —
 *        including a default nobody has chosen yet. A local optimistic
 *        selection would be the one thing capable of disagreeing with the
 *        render.
 *
 *        BACKDROP_IS_A_CHOICE, which is why "No footage" is a TILE in the group
 *        rather than a Clear button beside it. It is one of the options, it is
 *        what a new project uses when the catalogue is empty, and a customer
 *        going back to it is choosing a look rather than undoing something.
 *
 *        UPLOAD_TILE_IS_THE_SHARED_COMPONENT — `<MediaUpload variant="compact">`
 *        rather than a second drop zone, which the phase asks for in so many
 *        words. That component already carries the storage gate, the accept
 *        list and the refusal copy, and a second one would re-derive all three.
 *        It sits OUTSIDE the radiogroup: it is an action, not an option.
 *
 *        Nothing about this component is project-shaped beyond one optional
 *        prop, and the write is replaceable through `onSelect` — so Phase 15's
 *        editor can mount it over its own mutation without forking it.
 * WHERE: src/components/global/background-picker. Mounted by the generate
 *        screen; `src/app/(dashboard)/dashboard/projects/[id]/generate`.
 */

import * as React from "react";
import { ImageIcon, LockIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import { useActiveOrganization } from "@/hooks/use-active-organization";
import { MediaUpload } from "@/components/global/media-upload";
import { useUpgradeModal } from "@/components/global/upgrade-modal";
import { permissions } from "@/lib/permissions";
import {
  maxUploadBytesForPlan,
  type LibraryAssetKind,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * SOURCE OF TRUTH KEYWORDS: BackgroundPickerProps, GLOBAL_MEANS_CONFIGURABLE
 *
 * WHAT:  Everything a caller can steer, and nothing it has to.
 * WHY:   GLOBAL_MEANS_CONFIGURABLE. `onSelect` is the slot that matters: with
 *        it, the caller owns the write (Phase 15's editor, which has a document
 *        in hand and its own revision rules); without it, the component calls
 *        `backgroundLibrary.applyBackground` itself, which is what the generate screen
 *        wants. `projectId` is optional for the same reason a workspace-level
 *        default picker is a sensible surface to build later.
 * WHERE: The generate screen passes `projectId` and nothing else.
 */
export interface BackgroundPickerProps {
  organizationId: string;
  /** Omit for a picker with no project behind it — nothing is pre-selected. */
  projectId?: string;
  /** Footage by default; pass the audio kinds for a music picker. */
  kinds?: readonly LibraryAssetKind[];
  includeUploads?: boolean;
  /** True while a generation is running — the choice cannot take effect yet. */
  disabled?: boolean;
  title?: string;
  description?: string;
  /** Replaces the built-in write. Called with null for "no footage". */
  onSelect?: (assetId: string | null) => void;
  className?: string;
}

/** The sentinel the "no footage" tile carries, so the group has one value. */
const NO_FOOTAGE = "__none__";

export function BackgroundPicker({
  organizationId,
  projectId,
  kinds,
  includeUploads = true,
  disabled = false,
  title = "Background",
  description,
  onSelect,
  className,
}: BackgroundPickerProps) {
  const { hasPermission } = useActiveOrganization();
  const upgradeModal = useUpgradeModal();
  const utils = trpc.useUtils();

  const [search, setSearch] = React.useState("");
  const canApply = hasPermission(permissions.BACKGROUND_LIBRARY_APPLY);

  const list = trpc.backgroundLibrary.list.useQuery(
    {
      organizationId,
      ...(projectId !== undefined ? { projectId } : {}),
      ...(kinds !== undefined ? { kinds: [...kinds] } : {}),
      includeUploads,
      ...(search.trim().length > 0 ? { search: search.trim() } : {}),
    },
    { retry: false, placeholderData: (previous) => previous },
  );

  const apply = trpc.backgroundLibrary.applyBackground.useMutation({
    onSuccess: (result) => {
      void utils.backgroundLibrary.list.invalidate();
      toast.success(
        result.assetId === null
          ? "Back to the styled background. It applies the next time you generate."
          : "Background saved. It applies the next time you generate.",
      );
    },
    /* The upgrade modal opens itself off the structured error
       (GLOBAL_UPGRADE_SURFACE), so a toast here would be a second, worse
       explanation of the same refusal — except for the ones that are not about
       the plan at all, which is what this message is for. */
    onError: (error) => toast.error(error.message),
  });

  const data = list.data;

  /* One flat list in DOM order, so the roving tabindex and the arrow keys can
   * index it without knowing which group a tile came from. */
  const options = React.useMemo(() => {
    const tiles = [
      ...(data?.items ?? []),
      ...(data?.uploads ?? []),
    ];
    return [
      { id: NO_FOOTAGE, tile: null as (typeof tiles)[number] | null },
      ...tiles.map((tile) => ({ id: tile.id, tile })),
    ];
  }, [data?.items, data?.uploads]);

  const selectedId = data?.selectedAssetId ?? NO_FOOTAGE;

  /**
   * SOURCE OF TRUTH KEYWORDS: ROVING_TABINDEX, ACTIVE_FOLLOWS_SELECTION
   *
   * The tile the arrow keys are on. DERIVED rather than synchronised: until
   * somebody moves within the group, the tabbable tile is whichever one is
   * checked — so tabbing in lands on the current choice, and the server
   * changing the selection (a successful apply, another tab's write) moves the
   * tab stop with it. An effect mirroring `selectedId` into state would do the
   * same thing one render later and for the price of a cascading render.
   */
  const [movedTo, setMovedTo] = React.useState<string | null>(null);
  const activeId =
    movedTo !== null && options.some((option) => option.id === movedTo)
      ? movedTo
      : selectedId;

  const tileRefs = React.useRef(new Map<string, HTMLButtonElement>());

  function focusTile(id: string) {
    setMovedTo(id);
    tileRefs.current.get(id)?.focus();
  }

  /**
   * SOURCE OF TRUTH KEYWORDS: columnCount, ROVING_TABINDEX
   *
   * How many tiles are on a row, measured from the laid-out elements. The grid
   * is responsive, so this cannot be a constant — and `offsetTop` is the one
   * thing that knows where the browser actually put them. Falls back to 1,
   * which makes Up and Down behave like Left and Right rather than doing
   * nothing.
   */
  function columnCount(): number {
    const first = options[0];
    const firstEl =
      first === undefined ? undefined : tileRefs.current.get(first.id);
    if (firstEl === undefined) return 1;

    for (const [index, option] of options.entries()) {
      const element = tileRefs.current.get(option.id);
      if (element !== undefined && element.offsetTop !== firstEl.offsetTop) {
        return Math.max(1, index);
      }
    }
    return Math.max(1, options.length);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    const index = options.findIndex((option) => option.id === activeId);
    if (index < 0) return;

    const columns = columnCount();
    const moves: Readonly<Record<string, number>> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = options[event.key === "Home" ? 0 : options.length - 1];
      if (target !== undefined) focusTile(target.id);
      return;
    }

    const delta = moves[event.key];
    if (delta === undefined) return;

    event.preventDefault();
    /* Clamped rather than wrapped: wrapping from the last tile of a row to the
     * first of the next is what a LIST does, and this is a grid — a customer
     * pressing Right at the edge expects to stay put, not to jump a row. */
    const next = options[Math.min(options.length - 1, Math.max(0, index + delta))];
    if (next !== undefined) focusTile(next.id);
  }

  function choose(id: string, locked: boolean) {
    if (disabled) return;

    if (locked) {
      upgradeModal.open({
        resource: "backgroundLibrary",
        ...(data?.upgradeMessage !== undefined
          ? { upgradeMessage: data.upgradeMessage }
          : {}),
      });
      return;
    }

    const assetId = id === NO_FOOTAGE ? null : id;

    if (onSelect !== undefined) {
      onSelect(assetId);
      return;
    }

    if (projectId === undefined || !canApply) return;
    apply.mutate({ organizationId, projectId, assetId });
  }

  if (list.isPending && data === undefined) {
    return <Skeleton className={cn("h-72 w-full rounded-xl", className)} />;
  }

  const busy = apply.isPending || disabled;

  return (
    <Card className={className}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {data !== undefined && data.lockedCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                upgradeModal.open({
                  resource: "backgroundLibrary",
                  upgradeMessage: data.upgradeMessage,
                })
              }
            >
              {/* The number is the honest one: how many tiles on this page the
                  plan cannot use. */}
              Unlock {data.lockedCount} more
            </Button>
          ) : null}
        </div>

        <p className="text-sm text-muted-foreground">
          {description ??
            (data?.selectionOrigin === "default"
              ? "We picked one for you — choose another if you would rather."
              : "Pick what plays behind the narration. It loops to the length of your script.")}
        </p>

        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search backgrounds"
          className="max-w-56"
          aria-label="Search backgrounds"
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div
          role="radiogroup"
          aria-label="Background"
          onKeyDown={handleKeyDown}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
        >
          {options.map((option) => (
            <BackgroundTileButton
              key={option.id}
              ref={(element) => {
                if (element === null) tileRefs.current.delete(option.id);
                else tileRefs.current.set(option.id, element);
              }}
              tile={option.tile}
              checked={option.id === selectedId}
              tabbable={option.id === activeId}
              busy={busy}
              onChoose={() =>
                choose(option.id, option.tile?.locked ?? false)
              }
            />
          ))}
        </div>

        {data !== undefined && data.items.length === 0 && search.length > 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No backgrounds match that search.
          </p>
        ) : null}

        {/* MANIFEST_IS_EMPTY_ON_PURPOSE, said on screen rather than left as an
            empty grid the customer reads as a broken page. */}
        {data !== undefined &&
        data.items.length === 0 &&
        search.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Our background library is still being put together. Upload your own
            clip, or leave it on the styled background.
          </p>
        ) : null}

        {includeUploads && data !== undefined ? (
          /* UPLOAD_TILE_IS_THE_SHARED_COMPONENT, and OUTSIDE the radiogroup —
             it is an action, not one of the options. */
          <MediaUpload
            organizationId={organizationId}
            maxBytes={maxUploadBytesForPlan(data.plan)}
            kind="upload"
            variant="compact"
            title="Upload your own clip"
            description="Vertical versions are made automatically. It is held for review before it can be used."
            onUploaded={() => void utils.backgroundLibrary.list.invalidate()}
          />
        ) : null}

        {projectId !== undefined && !canApply && onSelect === undefined ? (
          <p className="text-xs text-muted-foreground">
            You do not have permission to change the background in this
            workspace.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: BackgroundTileButton, LOCKED_NOT_HIDDEN,
 *   POSTER_OR_ICON
 *
 * WHAT:  One option in the group: the poster, the name, and the badges.
 *
 * WHY:   POSTER_OR_ICON. The poster is the `thumb` variant the ingest built, so
 *        a row whose ingest has not produced one yet — or whose poster step
 *        failed — falls back to an icon rather than rendering a broken image.
 *        The same degradation the media grid already does.
 *
 *        A plain `<img>` rather than `next/image`: the URL is either a signed,
 *        short-lived one or a CDN URL for an object this app does not know the
 *        dimensions of ahead of time, and neither is something the Next loader
 *        can usefully optimise.
 *
 *        The licence is shown on the tile. That is not decoration — it is the
 *        answer to the single riskiest question in this product, and a customer
 *        about to publish something monetised is entitled to read it without
 *        opening anything.
 * WHERE: The radiogroup above.
 */
const BackgroundTileButton = React.forwardRef<
  HTMLButtonElement,
  {
    tile: {
      id: string;
      filename: string;
      license: string;
      minPlan: string | null;
      mine: boolean;
      locked: boolean;
      lockReason: "plan" | "breadth" | null;
      loopable: boolean;
      durationSec: number | null;
      posterUrl: string | null;
    } | null;
    checked: boolean;
    tabbable: boolean;
    busy: boolean;
    onChoose: () => void;
  }
>(function BackgroundTileButton({ tile, checked, tabbable, busy, onChoose }, ref) {
  const label =
    tile === null
      ? "No footage — use the styled background"
      : `${tile.filename}${tile.locked ? " (locked)" : ""}${tile.mine ? " (your upload)" : ""}`;

  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      /* ROVING_TABINDEX — one stop for the whole group. */
      tabIndex={tabbable ? 0 : -1}
      onClick={onChoose}
      /* Not `disabled`: a locked tile must stay in the keyboard order so it can
         be discovered (LOCKED_NOT_HIDDEN). `busy` is a real disable, because
         there is nothing to discover about a write already in flight. */
      disabled={busy}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-2 text-left transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "border-primary bg-accent" : "border-border hover:bg-accent/50",
        busy && "opacity-60",
      )}
    >
      <span className="relative flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
        {tile === null ? (
          <SparklesIcon className="size-6 text-muted-foreground" aria-hidden />
        ) : tile.posterUrl === null ? (
          <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
        ) : (
          /* POSTER_OR_ICON — see the component note. */
          /* eslint-disable-next-line @next/next/no-img-element -- see above */
          <img
            src={tile.posterUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        )}

        {tile?.locked === true ? (
          <span className="absolute inset-0 flex items-center justify-center bg-background/60">
            <LockIcon className="size-5 text-muted-foreground" aria-hidden />
          </span>
        ) : null}
      </span>

      <span className="flex items-center justify-between gap-1">
        <span className="truncate text-xs font-medium text-foreground">
          {tile === null ? "Styled background" : tile.filename}
        </span>
        {tile?.mine === true ? (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            Yours
          </Badge>
        ) : null}
      </span>

      {tile === null ? (
        <span className="text-[10px] text-muted-foreground">
          A gradient from your palette
        </span>
      ) : (
        <span className="flex flex-col gap-0.5">
          {/* The licence, on the tile. See the component note. */}
          <span className="truncate text-[10px] text-muted-foreground">
            {tile.license}
          </span>
          {tile.locked ? (
            <span className="text-[10px] text-muted-foreground">
              {tile.lockReason === "breadth"
                ? "Beyond your plan's library"
                : `Included from ${tile.minPlan ?? "a higher plan"}`}
            </span>
          ) : !tile.loopable ? (
            /* Honest rather than silent: without a measured duration the
               renderer cannot loop it, so it plays once and holds. */
            <span className="text-[10px] text-muted-foreground">
              Plays once — we could not measure its length
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
});
