/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: TimelineInspector, ClipLabelForm, AudioMixForm,
 *   OverlayPlacementForm, CaptionTextForm, NarrationLineForm,
 *   INSPECTOR_FOLLOWS_THE_SELECTION, EVERY_FIELD_IS_AN_OP,
 *   EDITING_TEXT_RE_RECORDS, RESTYLE_IS_FREE_RE_RECORD_IS_NOT
 *
 * WHAT:  The right-hand panel: the properties of whatever is selected, as
 *        forms, plus the one action on this screen that costs money.
 *
 * WHY:   EVERY_FIELD_IS_AN_OP. Each form submits by calling `edit` with a
 *        `setItemProps` or `setCaptionText` — there is no path from this panel
 *        to the document that does not go through `apply()`. That is why the
 *        forms submit on BLUR rather than live: one op per deliberate change
 *        keeps the undo stack meaningful, where a controlled field bound
 *        straight to the document would produce an op per keystroke and an
 *        undo stack nobody could use.
 *
 *        INSPECTOR_FOLLOWS_THE_SELECTION, and the forms are keyed on the
 *        selected id so switching clips resets the fields rather than carrying
 *        the previous clip's values into the next one's form.
 *
 *        EDITING_TEXT_RE_RECORDS is the phase's step 10 and the reason the
 *        narration form is separate from everything else here: changing a
 *        line's words is not a document edit, it is a provider call, a
 *        re-alignment and a document patch that the workflow performs. So it
 *        posts to `resynthLine` instead of producing an op, and
 *        RESTYLE_IS_FREE_RE_RECORD_IS_NOT — it is the one control on the
 *        screen that says it will spend credits before it does.
 *
 *        Caption text goes the other way: it IS an op (`setCaptionText`), which
 *        re-times the replacement words across the same span and shifts every
 *        later caption's range. No audio changes, so no money is spent — which
 *        is why fixing a typo in a caption and fixing a typo in the SPOKEN
 *        line are two different controls rather than one.
 *
 * WHERE: Rendered by timeline-editor.tsx for the selected item.
 */

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import type { Op, TimelineDoc, TrackItem, Track } from "@/lib/timeline";
import { captionRangeSeconds } from "@/lib/timeline";
import {
  audioMixFormSchema,
  captionTextFormSchema,
  clipLabelFormSchema,
  lineTextFormSchema,
  overlayPlacementFormSchema,
  type AudioMixValues,
  type CaptionTextValues,
  type ClipLabelValues,
  type LineTextValues,
  type OverlayPlacementValues,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { CaptionWordTiming } from "./caption-word-timing";
import type { NarrationLineSummary } from "./use-timeline-editor";

export interface TimelineInspectorProps {
  doc: TimelineDoc;
  projectId: string;
  organizationId: string;
  selected: { track: Track; item: TrackItem } | null;
  lines: readonly NarrationLineSummary[];
  canEdit: boolean;
  edit: (ops: readonly Op[]) => void;
  onDelete: (item: TrackItem, track: Track) => void;
}

export function TimelineInspector({
  doc,
  projectId,
  organizationId,
  selected,
  lines,
  canEdit,
  edit,
  onDelete,
}: TimelineInspectorProps) {
  if (selected === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Nothing selected</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Pick a clip, caption or overlay in the tracks below to edit it. Press{" "}
          <kbd className="rounded border border-border bg-muted px-1">S</kbd> to
          split the selection at the playhead.
        </CardContent>
      </Card>
    );
  }

  const { track, item } = selected;
  /* The narration line this audio item plays, matched by asset. The document
   * holds the assetId and the SENTENCE lives on the line row — see
   * EDITOR_NEEDS_THE_LINES in the router. */
  const line =
    track.type === "audio" && "assetId" in item
      ? (lines.find((candidate) => candidate.audioAssetId === item.assetId) ??
        null)
      : null;

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-sm">
          {item.label ?? item.id}
          <span className="ml-2 font-normal text-muted-foreground">
            {track.label}
          </span>
        </CardTitle>
        <ItemTiming item={item} doc={doc} track={track} />
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <ClipLabelForm key={`label-${item.id}`} item={item} edit={edit} />

        {track.type === "caption" ? (
          <>
            <Separator />
            <CaptionTextForm
              key={`caption-${item.id}`}
              item={item}
              doc={doc}
              edit={edit}
            />
            <Separator />
            <CaptionWordTiming
              doc={doc}
              item={item}
              disabled={!canEdit}
              edit={edit}
            />
          </>
        ) : null}

        {track.type === "audio" ? (
          <>
            <Separator />
            <AudioMixForm key={`mix-${item.id}`} item={item} edit={edit} />
            {line !== null ? (
              <>
                <Separator />
                <NarrationLineForm
                  key={`line-${line.id}`}
                  line={line}
                  projectId={projectId}
                  organizationId={organizationId}
                  canEdit={canEdit}
                />
              </>
            ) : null}
          </>
        ) : null}

        {track.type === "overlay" ? (
          <>
            <Separator />
            <OverlayPlacementForm
              key={`box-${item.id}`}
              item={item}
              edit={edit}
            />
            <StackingControls
              track={track}
              item={item}
              disabled={!canEdit}
              edit={edit}
            />
          </>
        ) : null}

        <Separator />
        <Button
          variant="destructive"
          size="sm"
          disabled={!canEdit}
          onClick={() => onDelete(item, track)}
        >
          Delete {track.type === "caption" ? "caption" : "clip"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* The selected item's position, read the same way the tracks panel reads it so
 * the two can never disagree. A caption's is derived from its word range. */
function ItemTiming({
  item,
  doc,
  track,
}: {
  item: TrackItem;
  doc: TimelineDoc;
  track: Track;
}) {
  if (track.type === "caption" && "startWord" in item) {
    const span = captionRangeSeconds(item.startWord, item.endWord, doc.words);
    return (
      <p className="text-xs text-muted-foreground">
        words {item.startWord}–{item.endWord}
        {span === null
          ? " · no timing"
          : ` · ${span.start.toFixed(2)}s → ${span.end.toFixed(2)}s`}
      </p>
    );
  }

  const start = typeof item.start === "number" ? item.start : null;
  const duration = typeof item.duration === "number" ? item.duration : null;

  return (
    <p className="text-xs text-muted-foreground">
      {start === null || duration === null
        ? "positioned by word anchor"
        : `${start.toFixed(2)}s → ${(start + duration).toFixed(2)}s · ${duration.toFixed(2)}s long`}
    </p>
  );
}

function ClipLabelForm({
  item,
  edit,
}: {
  item: TrackItem;
  edit: (ops: readonly Op[]) => void;
}) {
  const form = useForm<ClipLabelValues>({
    resolver: zodResolver(clipLabelFormSchema),
    mode: "onTouched",
    defaultValues: { label: item.label ?? "" },
  });

  const submit = form.handleSubmit((values) => {
    if (values.label === (item.label ?? "")) return;
    edit([{ type: "setItemProps", itemId: item.id, props: values }]);
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} onBlur={() => void submit()}>
        <FormField
          control={form.control}
          name="label"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder={item.id} />
              </FormControl>
              <FormDescription>
                Shown in the timeline only — it never appears in the video.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: CaptionTextForm, setCaptionText, WORD_RANGE_NOT_TEXT
 *
 * WHAT:  The words a caption covers, as editable text.
 * WHY:   The caption holds no text of its own, so the current value is read
 *        back OUT of `doc.words` by range — and submitting replaces those
 *        words, which re-times them across the same span and renumbers every
 *        later caption's range. That is what keeps a caption in sync with the
 *        audio through an edit, which is one of the phase's own checks.
 * WHERE: The inspector, for a caption selection.
 */
function CaptionTextForm({
  item,
  doc,
  edit,
}: {
  item: TrackItem;
  doc: TimelineDoc;
  edit: (ops: readonly Op[]) => void;
}) {
  const current = React.useMemo(() => {
    if (!("startWord" in item)) return "";
    return doc.words
      .slice(item.startWord, item.endWord + 1)
      .map((word) => word.w)
      .join(" ");
  }, [doc.words, item]);

  const form = useForm<CaptionTextValues>({
    resolver: zodResolver(captionTextFormSchema),
    mode: "onTouched",
    defaultValues: { text: current },
  });

  const submit = form.handleSubmit((values) => {
    if (values.text === current) return;
    edit([{ type: "setCaptionText", itemId: item.id, text: values.text }]);
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <FormField
          control={form.control}
          name="text"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Caption words</FormLabel>
              <FormControl>
                <Textarea {...field} rows={3} />
              </FormControl>
              <FormDescription>
                The new words share this caption&apos;s span in proportion to
                their length, so it stays in sync. The spoken audio is not
                re-recorded — use the narration line for that.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="sm" variant="secondary">
          Update caption
        </Button>
      </form>
    </Form>
  );
}

function AudioMixForm({
  item,
  edit,
}: {
  item: TrackItem;
  edit: (ops: readonly Op[]) => void;
}) {
  const gain = "gain" in item && typeof item.gain === "number" ? item.gain : 1;
  const duck = "duck" in item && typeof item.duck === "boolean" ? item.duck : false;

  const form = useForm<AudioMixValues>({
    resolver: zodResolver(audioMixFormSchema),
    mode: "onTouched",
    defaultValues: { gain, duck },
  });

  const submit = form.handleSubmit((values) => {
    if (values.gain === gain && values.duck === duck) return;
    edit([{ type: "setItemProps", itemId: item.id, props: values }]);
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <FormField
          control={form.control}
          name="gain"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Level</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.05"
                  min={0}
                  max={4}
                  value={field.value}
                  onChange={(event) =>
                    field.onChange(event.currentTarget.valueAsNumber)
                  }
                  onBlur={() => void submit()}
                />
              </FormControl>
              <FormDescription>1 is the recorded level.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="duck"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-3">
              <div>
                <FormLabel>Duck under narration</FormLabel>
                <FormDescription>
                  Drops this track while anybody is speaking.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    field.onChange(checked);
                    void submit();
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: OverlayPlacementForm, Z_IS_EXPLICIT,
 *   NORMALIZED_BOX
 *
 * WHAT:  Where an overlay sits and which depth it claims.
 * WHY:   Z_IS_EXPLICIT. Two overlays that are on screen at the same moment may
 *        not share a `z` — validate() refuses the document, and the phase's
 *        guard says overlapping overlays resolve by explicit z-order rather
 *        than by array position. So the depth is a field the customer sets,
 *        and the refusal when they collide is a message rather than a surprise
 *        in the render.
 *        The box is in NORMALIZED units (0–1 of the canvas), which is what
 *        makes an overlay survive a change of aspect ratio.
 * WHERE: The inspector, for an overlay selection.
 */
function OverlayPlacementForm({
  item,
  edit,
}: {
  item: TrackItem;
  edit: (ops: readonly Op[]) => void;
}) {
  /* `h` is optional on a stored box — absent means the renderer sizes the
   * overlay to its content. The form always shows a number, because a blank
   * numeric input is an uncontrolled field, and submitting it writes the
   * explicit height the customer just confirmed. */
  const stored = "box" in item && item.box !== undefined ? item.box : null;
  const box = {
    x: stored?.x ?? 0,
    y: stored?.y ?? 0,
    w: stored?.w ?? 1,
    h: stored?.h ?? 0.12,
  };
  const z = "z" in item && typeof item.z === "number" ? item.z : 0;

  const form = useForm<OverlayPlacementValues>({
    resolver: zodResolver(overlayPlacementFormSchema),
    mode: "onTouched",
    defaultValues: { box, z },
  });

  const submit = form.handleSubmit((values) => {
    edit([{ type: "setItemProps", itemId: item.id, props: values }]);
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          {(["x", "y", "w", "h"] as const).map((axis) => (
            <FormField
              key={axis}
              control={form.control}
              name={`box.${axis}`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="uppercase">{axis}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      max={1}
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(event.currentTarget.valueAsNumber)
                      }
                      onBlur={() => void submit()}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
        <FormField
          control={form.control}
          name="z"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Depth</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="1"
                  value={field.value}
                  onChange={(event) =>
                    field.onChange(event.currentTarget.valueAsNumber)
                  }
                  onBlur={() => void submit()}
                />
              </FormControl>
              <FormDescription>
                Higher draws on top. Two overlays on screen together cannot
                share a depth.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: NarrationLineForm, resynthLine,
 *   EDITING_TEXT_RE_RECORDS, COST_IS_STATED
 *
 * WHAT:  The spoken words of the selected narration line, and the button that
 *        re-records them.
 * WHY:   COST_IS_STATED. This is the only control in the editor that spends
 *        credits, so it says so before it is pressed rather than reporting it
 *        afterwards. The exact figure comes from the workflow's own refusal if
 *        the balance is short (CREDITS_ARE_REFUSED_BY_THE_CHILDREN), which is
 *        why the copy names the act rather than a number this screen would
 *        have to guess.
 *
 *        Re-recording one line also re-aligns the project, because new audio
 *        moves every word timing after it — the screen says that too, since a
 *        customer who did not expect their captions to shift would read the
 *        result as a bug.
 * WHERE: The inspector, under the mix controls for a narration clip.
 */
function NarrationLineForm({
  line,
  projectId,
  organizationId,
  canEdit,
}: {
  line: NarrationLineSummary;
  projectId: string;
  organizationId: string;
  canEdit: boolean;
}) {
  const resynth = trpc.timelineEditor.resynthLine.useMutation({
    onSuccess: () =>
      toast.success(
        "Re-recording that line. Its captions re-time when it is ready.",
      ),
    onError: (error) => toast.error(error.message),
  });

  const form = useForm<LineTextValues>({
    resolver: zodResolver(lineTextFormSchema),
    mode: "onTouched",
    defaultValues: { text: line.text },
  });

  const submit = form.handleSubmit((values) => {
    resynth.mutate({
      organizationId,
      projectId,
      lineId: line.id,
      text: values.text,
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <FormField
          control={form.control}
          name="text"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Spoken line · {line.speakerTag}</FormLabel>
              <FormControl>
                <Textarea {...field} rows={3} />
              </FormControl>
              <FormDescription>
                Re-recording costs credits and re-times this line&apos;s
                captions. Every other line keeps its existing audio.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!canEdit || resynth.isPending}
        >
          {resynth.isPending ? "Sending…" : "Re-record this line"}
        </Button>
      </form>
    </Form>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: StackingControls, reorder, STACKING_ORDER,
 *   ARRAY_POSITION_IS_VISUAL
 *
 * WHAT:  Bring forward and send backward within the lane.
 * WHY:   ARRAY_POSITION_IS_VISUAL. Within one lane, array position decides
 *        which of two items at the same moment draws on top — `z` only
 *        separates overlays from each other — so reordering the array is a
 *        visual edit and `reorder` is the op for it (STACKING_ORDER in ops.ts).
 *        Two buttons rather than a drag handle: moving one step is the whole
 *        of what anybody asks for here, and a drag-to-reorder list would be a
 *        second way to express the same op.
 *
 *        The op requires EVERY item on the track to be named exactly once, so
 *        the full order is computed and sent — a partial list is refused,
 *        deliberately, because it would leave the unnamed items somewhere the
 *        caller did not choose.
 * WHERE: The inspector, for an overlay selection.
 */
function StackingControls({
  track,
  item,
  disabled,
  edit,
}: {
  track: Track;
  item: TrackItem;
  disabled: boolean;
  edit: (ops: readonly Op[]) => void;
}) {
  const order = track.items.map((candidate) => candidate.id);
  const index = order.indexOf(item.id);

  const swap = (offset: number) => {
    const target = index + offset;
    const held = order[index];
    const displaced = order[target];
    if (held === undefined || displaced === undefined) return;

    const next = [...order];
    next[index] = displaced;
    next[target] = held;
    edit([{ type: "reorder", trackId: track.id, itemIds: next }]);
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        {index + 1} of {order.length} in this lane
      </span>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || index <= 0}
          onClick={() => swap(-1)}
        >
          Send back
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || index === order.length - 1}
          onClick={() => swap(1)}
        >
          Bring forward
        </Button>
      </div>
    </div>
  );
}
