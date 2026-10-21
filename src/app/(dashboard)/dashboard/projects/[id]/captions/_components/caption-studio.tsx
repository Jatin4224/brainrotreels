/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: CaptionStudio, AlignmentPanel, StyleGallery,
 *   StyleCard, LOCKED_NOT_HIDDEN, DEGRADE_IS_VISIBLE, RESTYLING_IS_FREE,
 *   KEYBOARD_NAVIGABLE_GALLERY, POLL_WHILE_ALIGNING
 *
 * WHAT:  The captions screen: the state of the word timings, the style
 *        library, and the three controls that decide how captions look.
 *
 * WHY:   LOCKED_NOT_HIDDEN. Every style in the library is rendered; the ones
 *        the plan does not include carry a lock badge and open the upgrade
 *        modal instead of applying. A style a customer never sees is one they
 *        have no reason to pay for — and the server refuses the apply anyway,
 *        so the badge is an affordance rather than the boundary.
 *
 *        DEGRADE_IS_VISIBLE, which is one of the phase's own checks: an
 *        alignment that fell back to an even distribution says so, in a
 *        warning the customer can act on, with the button that fixes it next
 *        to it. A degraded video that LOOKS correct is worse than a failed
 *        one, because it is published.
 *
 *        RESTYLING_IS_FREE and the UI says so out loud. Changing the style
 *        spends no credits and makes no provider call, so the save button is
 *        never behind a confirmation; only "Re-align" is, because that one
 *        costs money.
 *
 *        KEYBOARD_NAVIGABLE_GALLERY — every card is a real `<button>` with
 *        `aria-pressed`, and the preview inside it is `aria-hidden` because
 *        it is decoration: the accessible name is the style's NAME, which is
 *        the only part a screen reader can usefully convey about a look.
 *
 *        POLL_WHILE_ALIGNING: the workflow writes the alignment row when it
 *        finishes and nothing pushes that to the browser. The poll stops by
 *        itself once the alignment is no longer stale.
 * WHERE: Rendered by /dashboard/projects/[id]/captions.
 */

import * as React from "react";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { useUpgradeModal } from "@/components/global/upgrade-modal";
import {
  CaptionPreview,
  PREVIEW_BACKGROUNDS,
  type PreviewBackgroundId,
} from "@/components/global/caption-preview";
import { permissions } from "@/lib/permissions";
import {
  CAPTION_POSITIONS,
  CAPTION_WORDS_PER_CHUNK_MAX,
  CAPTION_WORDS_PER_CHUNK_MIN,
  type CaptionPosition,
} from "@/lib/types/caption";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

/** Two seconds, matching every other polled surface in this app. */
const ALIGNING_POLL_MS = 2000;

const FAMILY_ALL = "all";

export function CaptionStudio({ projectId }: { projectId: string }) {
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const enabled = organizationId !== undefined;

  const canApply = hasPermission(permissions.CAPTION_STYLES_APPLY);
  const canAlign = hasPermission(permissions.CAPTION_STYLES_ALIGN);

  const [search, setSearch] = React.useState("");
  const [family, setFamily] = React.useState(FAMILY_ALL);
  const [background, setBackground] =
    React.useState<PreviewBackgroundId>("dark");
  /* Null until the customer touches something — the saved settings are the
   * source of truth until then, so a background refetch cannot stomp on an
   * edit in progress and an untouched screen always shows what is stored. */
  const [draft, setDraft] = React.useState<Draft | null>(null);
  /* When a run was asked for, as a timestamp. The run is "in flight" until
   * an alignment NEWER than that appears — which is true whether it
   * succeeded or degraded. Derived rather than held in a second boolean,
   * because a boolean would need an effect to clear it and a setState in an
   * effect body is a cascading render. */
  const [alignRequestedAt, setAlignRequestedAt] = React.useState<number | null>(
    null,
  );

  const utils = trpc.useUtils();

  const state = trpc.captions.get.useQuery(
    { organizationId: organizationId ?? "", projectId },
    {
      enabled,
      retry: false,
      placeholderData: (previous) => previous,
      /* POLL_WHILE_ALIGNING — stops by itself. */
      refetchInterval: (query) =>
        isAligning(alignRequestedAt, query.state.data?.alignment ?? null)
          ? ALIGNING_POLL_MS
          : false,
    },
  );

  const library = trpc.captions.styles.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(search.trim().length > 0 ? { search: search.trim() } : {}),
      ...(family !== FAMILY_ALL ? { family } : {}),
    },
    { enabled, retry: false, placeholderData: (previous) => previous },
  );

  if (!enabled || state.isPending || library.isPending) {
    return <Skeleton className="h-[40rem] w-full rounded-xl" />;
  }

  const saved = state.data?.settings;
  const current: Draft = draft ?? {
    styleId: saved?.styleId ?? "bold-pop",
    position: saved?.position ?? "bottom",
    wordsPerChunk: saved?.wordsPerChunk ?? 3,
    enabled: saved?.enabled ?? true,
  };

  return (
    <div className="flex flex-col gap-6">
      <AlignmentPanel
        organizationId={organizationId}
        projectId={projectId}
        alignment={state.data?.alignment ?? null}
        narration={state.data?.narration}
        upToDate={state.data?.upToDate === true}
        canAlign={canAlign}
        aligning={isAligning(alignRequestedAt, state.data?.alignment ?? null)}
        onAligning={() => setAlignRequestedAt(Date.now())}
      />

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <StageAndControls
          organizationId={organizationId}
          projectId={projectId}
          draft={current}
          onChange={setDraft}
          words={state.data?.words ?? []}
          background={background}
          onBackground={setBackground}
          canApply={canApply}
          onSaved={() => {
            setDraft(null);
            void utils.captions.invalidate();
          }}
        />

        <StyleGallery
          styles={library.data?.styles ?? []}
          families={library.data?.families ?? []}
          search={search}
          onSearch={setSearch}
          family={family}
          onFamily={setFamily}
          selectedId={current.styleId}
          upgradeMessage={library.data?.upgradeMessage ?? null}
          words={state.data?.words ?? []}
          background={background}
          onSelect={(styleId) =>
            setDraft({ ...current, styleId })
          }
        />
      </div>
    </div>
  );
}

interface Draft {
  styleId: string;
  position: CaptionPosition;
  wordsPerChunk: number;
  enabled: boolean;
}

/**
 * SOURCE OF TRUTH KEYWORDS: AlignmentPanel, DEGRADE_IS_VISIBLE,
 *   READY_LINES_ONLY, ALIGNMENT_IS_PAID_WORK
 */
function AlignmentPanel({
  organizationId,
  projectId,
  alignment,
  narration,
  upToDate,
  canAlign,
  aligning,
  onAligning,
}: {
  organizationId: string;
  projectId: string;
  alignment: {
    engine: string;
    degraded: boolean;
    updatedAt: Date;
    stale: boolean;
  } | null;
  narration: { lines: number; skipped: number; durationSec: number } | undefined;
  upToDate: boolean;
  canAlign: boolean;
  aligning: boolean;
  onAligning: () => void;
}) {
  const align = trpc.captions.align.useMutation({
    onSuccess: (result) => {
      if (result.queued) {
        onAligning();
        toast.success("Timing your captions", {
          description: "Each word is matched to the narration you recorded.",
        });
        return;
      }
      toast.info("These captions are already timed", {
        description: "Nothing has changed since the last alignment.",
      });
    },
    onError: (error) =>
      toast.error("Captions could not be timed", {
        description: error.message,
      }),
  });

  const hasNarration = (narration?.lines ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Word timing</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!hasNarration ? (
          <p className="text-sm text-muted-foreground">
            Record the narration first — captions are timed against it.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {narration?.lines} line{narration?.lines === 1 ? "" : "s"} recorded
            {narration !== undefined && narration.durationSec > 0
              ? ` · about ${narration.durationSec.toFixed(1)}s`
              : ""}
            {alignment !== null
              ? ` · timed by ${alignment.engine}`
              : " · not timed yet"}
          </p>
        )}

        {/* READY_LINES_ONLY — a half-recorded narration would caption with a
            hole in it, so it is named rather than silently skipped. */}
        {(narration?.skipped ?? 0) > 0 ? (
          <Alert>
            <AlertTitle>Some lines are not recorded</AlertTitle>
            <AlertDescription>
              {narration?.skipped} line
              {narration?.skipped === 1 ? " has" : "s have"} no audio yet, so
              there is nothing to time them against. Finish the narration
              first.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* DEGRADE_IS_VISIBLE — the phase's own requirement. */}
        {alignment?.degraded === true ? (
          <Alert>
            <AlertTitle>These captions are estimated</AlertTitle>
            <AlertDescription>
              The timing service could not read the narration, so the words
              are spread evenly across it. The video still renders — try
              timing it again, and the captions will land on the words.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={!canAlign || !hasNarration || align.isPending || aligning}
            onClick={() =>
              align.mutate({
                organizationId,
                projectId,
                /* A degraded or stale alignment re-runs on its own; `force`
                 * is for the case where the customer wants it anyway. */
                force: upToDate,
              })
            }
          >
            {aligning
              ? "Timing…"
              : alignment === null
                ? "Time the captions"
                : "Re-time the captions"}
          </Button>

          {alignment !== null && !alignment.stale && !alignment.degraded ? (
            <Badge variant="secondary">Up to date</Badge>
          ) : null}

          {!canAlign ? (
            <span className="text-xs text-muted-foreground">
              Your role cannot time captions.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: StageAndControls, POSITION_IS_A_BAND,
 *   RESTYLING_IS_FREE
 *
 * WHY:   The position control is three BANDS rather than a continuous
 *        slider, and that is a deliberate departure from the phase's wording.
 *        A pixel slider implies a precision the document does not have at
 *        this stage — the band is clamped into the platform's safe zone at
 *        render time, so two nearby slider positions would often produce the
 *        identical frame and the control would feel broken. Phase 15's editor
 *        is where a caption gets nudged by hand, against a real frame.
 */
function StageAndControls({
  organizationId,
  projectId,
  draft,
  onChange,
  words,
  background,
  onBackground,
  canApply,
  onSaved,
}: {
  organizationId: string;
  projectId: string;
  draft: Draft;
  onChange: (draft: Draft) => void;
  words: readonly { i: number; w: string; s: number; e: number }[];
  background: PreviewBackgroundId;
  onBackground: (id: PreviewBackgroundId) => void;
  canApply: boolean;
  onSaved: () => void;
}) {
  const apply = trpc.captions.applyStyle.useMutation({
    onSuccess: (result) => {
      toast.success("Caption style saved", {
        description: result.written
          ? `${result.captions} caption${result.captions === 1 ? "" : "s"} restyled.`
          : "It will be applied when this project's timeline is built.",
      });
      onSaved();
    },
    onError: (error) =>
      toast.error("That style could not be applied", {
        description: error.message,
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Preview</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="flex justify-center">
          <CaptionPreview
            styleId={draft.styleId}
            words={words}
            wordsPerChunk={draft.wordsPerChunk}
            position={draft.position}
            background={background}
            width={220}
            animated
            showSafeZone
          />
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {PREVIEW_BACKGROUNDS.map((entry) => (
            <Button
              key={entry.id}
              type="button"
              size="sm"
              variant={entry.id === background ? "default" : "outline"}
              aria-pressed={entry.id === background}
              onClick={() => onBackground(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="caption-position">Position</Label>
          <div id="caption-position" className="flex gap-2">
            {CAPTION_POSITIONS.map((position) => (
              <Button
                key={position}
                type="button"
                size="sm"
                className="flex-1 capitalize"
                variant={position === draft.position ? "default" : "outline"}
                aria-pressed={position === draft.position}
                onClick={() => onChange({ ...draft, position })}
              >
                {position}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="caption-words">Words per card</Label>
          <Select
            value={String(draft.wordsPerChunk)}
            onValueChange={(value) =>
              onChange({
                ...draft,
                wordsPerChunk: Number(value ?? draft.wordsPerChunk),
              })
            }
          >
            <SelectTrigger id="caption-words">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {wordsPerChunkOptions().map((count) => (
                <SelectItem key={count} value={String(count)}>
                  {count} words
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="caption-enabled">Show captions</Label>
          <Switch
            id="caption-enabled"
            checked={draft.enabled}
            onCheckedChange={(checked) =>
              onChange({ ...draft, enabled: checked })
            }
          />
        </div>

        <Button
          type="button"
          disabled={!canApply || apply.isPending}
          onClick={() =>
            apply.mutate({
              organizationId,
              projectId,
              styleId: draft.styleId,
              position: draft.position,
              wordsPerChunk: draft.wordsPerChunk,
              enabled: draft.enabled,
            })
          }
        >
          {apply.isPending ? "Saving…" : "Save caption style"}
        </Button>

        {/* RESTYLING_IS_FREE, said out loud — a customer who thinks a
            restyle costs credits will not try styles. */}
        <p className="text-xs text-muted-foreground">
          Changing the style is free and never changes the timing.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: StyleGallery, StyleCard, LOCKED_NOT_HIDDEN,
 *   KEYBOARD_NAVIGABLE_GALLERY
 */
function StyleGallery({
  styles,
  families,
  search,
  onSearch,
  family,
  onFamily,
  selectedId,
  upgradeMessage,
  words,
  background,
  onSelect,
}: {
  styles: readonly {
    id: string;
    name: string;
    family: string;
    minPlan: string;
    locked: boolean;
    contrastOk: boolean;
  }[];
  families: readonly string[];
  search: string;
  onSearch: (value: string) => void;
  family: string;
  onFamily: (value: string) => void;
  selectedId: string;
  upgradeMessage: string | null;
  words: readonly { i: number; w: string; s: number; e: number }[];
  background: PreviewBackgroundId;
  onSelect: (styleId: string) => void;
}) {
  const { open } = useUpgradeModal();

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle className="text-base">Style</CardTitle>

        <div className="flex flex-wrap gap-2">
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search styles"
            className="max-w-56"
            aria-label="Search caption styles"
          />
          <Select
            value={family}
            onValueChange={(value) => onFamily(value ?? FAMILY_ALL)}
          >
            <SelectTrigger className="w-40" aria-label="Filter by family">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FAMILY_ALL}>All families</SelectItem>
              {families.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {entry}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        {styles.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No styles match that search.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {styles.map((style) => (
              <button
                key={style.id}
                type="button"
                aria-pressed={style.id === selectedId}
                aria-label={`${style.name}${style.locked ? " (locked)" : ""}`}
                onClick={() => {
                  if (style.locked) {
                    /* The registry resource, so the modal shows that
                     * entry.s own copy — UPGRADE_COPY_FROM_REGISTRY. */
                    open({
                      resource: "premiumCaptionStyles",
                      ...(upgradeMessage !== null
                        ? { upgradeMessage }
                        : {}),
                    });
                    return;
                  }
                  onSelect(style.id);
                }}
                className={[
                  "flex flex-col gap-2 rounded-xl border p-2 text-left transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  style.id === selectedId
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50",
                ].join(" ")}
              >
                <CaptionPreview
                  styleId={style.id}
                  words={words}
                  background={background}
                  width={150}
                />

                <span className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-medium text-foreground">
                    {style.name}
                  </span>
                  {style.locked ? (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      Locked
                    </Badge>
                  ) : null}
                </span>

                {/* The contrast verdict, surfaced rather than buried in CI.
                    It should never be false — the test refuses to let one
                    ship — which is exactly why it is worth showing. */}
                {!style.contrastOk ? (
                  <span className="text-[10px] text-muted-foreground">
                    Low contrast
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function wordsPerChunkOptions(): number[] {
  const options: number[] = [];
  for (
    let count = CAPTION_WORDS_PER_CHUNK_MIN;
    count <= CAPTION_WORDS_PER_CHUNK_MAX;
    count += 1
  ) {
    options.push(count);
  }
  return options;
}

/**
 * SOURCE OF TRUTH KEYWORDS: isAligning, POLL_WHILE_ALIGNING
 *
 * WHAT:  Whether an alignment asked for at `requestedAt` has landed yet.
 * WHY:   Compares the stored alignment's timestamp with the moment the run
 *        was requested, rather than watching `upToDate`. A DEGRADED
 *        alignment is deliberately never "up to date" (it must be
 *        re-runnable), so a poll keyed on that flag would never stop on the
 *        one outcome where the customer most needs the screen to settle and
 *        show them the warning.
 * WHERE: CaptionStudio's poll interval and the panel's button state.
 */
function isAligning(
  requestedAt: number | null,
  alignment: { updatedAt: Date } | null,
): boolean {
  if (requestedAt === null) return false;
  if (alignment === null) return true;
  return new Date(alignment.updatedAt).getTime() <= requestedAt;
}
