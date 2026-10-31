/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: BeatStrip, A_STILL_PER_BEAT, ONE_BEAT_IS_THE_UNIT,
 *   A_FALLBACK_IS_VISIBLE, THE_STRIP_READS_A_VIEW_NOT_THE_BLOB,
 *   FROZEN_STILLS_ONE_PLAYER, THEME_TOKENS_FOR_CHROME
 *
 * WHAT:  The phase's step 14 — every beat of a motion project as a still, with
 *        "redesign this beat" re-running exactly one of them.
 *
 * WHY:   A_STILL_PER_BEAT is what makes a designed video reviewable. The
 *        deterministic checks prove no beat overflows, overlaps or leaves the
 *        safe zone; none of them can tell whether the right thing is on screen.
 *        That judgement needs a human looking at twelve pictures, and it needs
 *        to be cheap enough to do after every generation.
 *
 *        FROZEN_STILLS_ONE_PLAYER. The strip draws each beat FROZEN at its
 *        midpoint and animates only the selected one. Twelve live previews is
 *        twelve requestAnimationFrame loops recomputing twelve layouts sixty
 *        times a second, which makes a review screen stutter on the machine of
 *        the person doing the reviewing. The midpoint is the honest frozen
 *        moment because ANIMATION_NEVER_MOVES_THE_INK — an entrance changes
 *        opacity and scale, never the measured rectangle — so a still at the
 *        middle of a beat shows exactly where every element lands.
 *
 *        A_FALLBACK_IS_VISIBLE. A beat the model could not design shows a
 *        "plain" badge, because the alternative is a customer assuming the
 *        plainest beat in their video is what the model thought best. That
 *        badge is the entire reason `source` is stored
 *        (A_FALLBACK_IS_RECORDED) and it is what the redesign button is for.
 *
 *        ONE_BEAT_IS_THE_UNIT: the button redesigns one beat and the response
 *        carries that one beat back, so eleven unchanged scenes are neither
 *        re-requested nor re-rendered. The query is invalidated rather than
 *        patched by hand, because the server's view is the one that includes
 *        what the write actually stored.
 *
 *        THEME_TOKENS_FOR_CHROME. The previews contain literal render colours,
 *        because video has no theme (RENDER_COLOURS_ARE_LITERAL); every pixel
 *        of the strip's own furniture is a theme token.
 * WHERE: The motion route, above the primitive gallery.
 */

import * as React from "react";
import { toast } from "sonner";

import { MotionPreview } from "@/components/global/motion-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveOrganizationId } from "@/hooks/use-active-organization";
import { CANVAS_BY_ASPECT } from "@/lib/types/project";
import type { MotionBeatView } from "@/lib/types/scene";
import { trpc } from "@/trpc/react-provider";

/* Narrow enough that eight fit a laptop without scrolling, wide enough that a
 * headline is legible as a thumbnail. */
const STILL_WIDTH = 104;
/* The selected beat, played at a size where a reviewer can read the text. */
const PLAYER_WIDTH = 240;

export function BeatStrip({ projectId }: { projectId: string }) {
  const organizationId = useActiveOrganizationId();
  const [selected, setSelected] = React.useState(0);

  const design = trpc.motionStudio.design.useQuery(
    { organizationId: organizationId ?? "", projectId },
    /* The session resolves after the first render, and a request without a
     * workspace is one the procedure would refuse. */
    { enabled: organizationId !== undefined },
  );

  const utils = trpc.useUtils();
  const redesign = trpc.motionStudio.redesignBeat.useMutation({
    onSuccess: (result) => {
      /* Invalidated rather than patched: the server's view includes what was
       * actually stored, and a hand-patched cache is how a screen comes to
       * show a scene the database does not have. */
      void utils.motionStudio.design.invalidate();
      toast.success(
        result.beat.source === "fallback"
          ? `Beat ${result.beat.index + 1} could not be designed and is showing the narration plainly.`
          : `Beat ${result.beat.index + 1} redesigned.`,
      );
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  if (design.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Beats</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <Skeleton
              key={key}
              className="h-[185px] shrink-0"
              style={{ width: STILL_WIDTH }}
            />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (design.error !== null) {
    /* The router's own message carries the reason — a workspace without the
     * motion studio gets the registry's upgrade copy, which is better than
     * anything this component could invent. */
    return (
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="text-base">Beats</CardTitle>
          <p className="text-muted-foreground text-sm">
            {design.error.message}
          </p>
        </CardHeader>
      </Card>
    );
  }

  const { beats, style, aspect, safeZone } = design.data;
  const canvas = CANVAS_BY_ASPECT[aspect];

  /* The selection is clamped rather than reset, so a redesign that changes the
   * beat count leaves the reviewer near where they were. */
  const current = beats[Math.min(selected, beats.length - 1)];

  /* One branch covers both "no storyboard yet" and the empty-array read the
   * compiler insists on — there is no third state, and a non-null assertion to
   * avoid saying so would be a TypeScript bypass for one line of JSX. */
  if (current === undefined) {
    return (
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="text-base">Beats</CardTitle>
          <p className="text-muted-foreground text-sm">
            This project has no storyboard yet. Generate the video and its
            narration will be split into beats, each with its own graphic.
          </p>
        </CardHeader>
      </Card>
    );
  }

  const plain = beats.filter((beat) => beat.source === "fallback").length;
  const pending = beats.filter((beat) => beat.scene === null).length;
  const flagged = beats.filter(
    (beat) => beat.review !== null && beat.review.verdict !== "ok",
  ).length;

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {beats.length} beat{beats.length === 1 ? "" : "s"}
          </CardTitle>
          <div className="flex items-center gap-2">
            {plain > 0 && (
              <Badge variant="outline">{plain} showing plain text</Badge>
            )}
            {pending > 0 && (
              <Badge variant="outline">{pending} not designed yet</Badge>
            )}
            {flagged > 0 && (
              <Badge variant="destructive">{flagged} flagged on review</Badge>
            )}
            <Badge variant="secondary">{style.name}</Badge>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          Each beat is one graphic over its own words. Pick one to play it, and
          redesign any beat on its own — the others are untouched.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* The strip itself: a still per beat, frozen at its midpoint. */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {beats.map((beat, position) => (
            <button
              key={beat.index}
              type="button"
              onClick={() => setSelected(position)}
              aria-current={beat.index === current.index}
              className={`flex shrink-0 flex-col gap-1 rounded-md border p-1 text-left transition-colors ${
                beat.index === current.index
                  ? "border-primary bg-accent"
                  : "hover:bg-accent/50"
              }`}
              style={{ width: STILL_WIDTH + 10 }}
            >
              <BeatStill
                beat={beat}
                canvas={canvas}
                style={style}
                safeZone={safeZone}
              />
              <span className="text-muted-foreground px-1 text-[11px]">
                {beat.index + 1} · {beat.intent}
              </span>
            </button>
          ))}
        </div>

        {/* The selected beat, playing, with what it is and what to do about it. */}
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="shrink-0">
            {current.scene === null ? (
              <Placeholder width={PLAYER_WIDTH} canvas={canvas} />
            ) : (
              <MotionPreview
                scene={current.scene}
                canvas={canvas}
                style={style}
                safeZone={safeZone}
                durationSeconds={current.durationSeconds}
                width={PLAYER_WIDTH}
              />
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{current.intent}</Badge>
              <SourceBadge source={current.source} />
              {current.review !== null && current.review.verdict !== "ok" && (
                <Badge variant="destructive">{current.review.verdict}</Badge>
              )}
              <span className="text-muted-foreground text-xs">
                {current.startSeconds.toFixed(1)}s ·{" "}
                {current.durationSeconds.toFixed(1)}s long
              </span>
            </div>

            {/* VISION_CATCHES_WHAT_GEOMETRY_CANNOT — shown as a quoted
                OPINION, not as a verdict in our own voice. The geometry is
                provably fine by the time this ran, so the note is the one
                thing on this card a reviewer is entitled to disagree with. */}
            {current.review !== null && (
              <p className="text-muted-foreground border-l-2 pl-3 text-xs italic">
                {current.review.note}
              </p>
            )}

            <p className="text-sm leading-relaxed">
              {current.text === "" ? (
                <span className="text-muted-foreground">
                  This beat&apos;s words are no longer in the narration.
                </span>
              ) : (
                `“${current.text}”`
              )}
            </p>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={redesign.isPending || organizationId === undefined}
                onClick={() => {
                  if (organizationId === undefined) return;
                  redesign.mutate({
                    organizationId,
                    projectId,
                    beatIndex: current.index,
                  });
                }}
              >
                {redesign.isPending ? "Designing…" : "Redesign this beat"}
              </Button>
              <span className="text-muted-foreground text-xs">
                One model request. Every other beat stays as it is.
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: BeatStill, FROZEN_STILLS_ONE_PLAYER,
 *   THE_MIDPOINT_IS_THE_HONEST_FRAME
 *
 * One beat as a frozen thumbnail. THE_MIDPOINT_IS_THE_HONEST_FRAME: an element
 * that enters late is on screen by then and an entrance has finished, so the
 * still shows the beat as it is read rather than mid-animation — which is the
 * frame a reviewer is judging.
 */
function BeatStill({
  beat,
  canvas,
  style,
  safeZone,
}: {
  beat: MotionBeatView;
  canvas: React.ComponentProps<typeof MotionPreview>["canvas"];
  style: React.ComponentProps<typeof MotionPreview>["style"];
  safeZone: React.ComponentProps<typeof MotionPreview>["safeZone"];
}) {
  if (beat.scene === null) {
    return <Placeholder width={STILL_WIDTH} canvas={canvas} />;
  }

  return (
    <MotionPreview
      scene={beat.scene}
      canvas={canvas}
      style={style}
      safeZone={safeZone}
      durationSeconds={beat.durationSeconds}
      width={STILL_WIDTH}
      frozenAt={beat.durationSeconds / 2}
    />
  );
}

/* A beat the design stage has not reached. Sized from the canvas so the strip
 * does not reflow as the pictures arrive. */
function Placeholder({
  width,
  canvas,
}: {
  width: number;
  canvas: { width: number; height: number };
}) {
  return (
    <div
      className="bg-muted flex items-center justify-center rounded-md"
      style={{ width, height: (width * canvas.height) / canvas.width }}
    >
      <span className="text-muted-foreground text-[11px]">not designed</span>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: SourceBadge, A_FALLBACK_IS_VISIBLE
 *
 * How this beat came to look the way it does. `designed` says nothing on
 * purpose — the default state needs no label, and a badge on every beat would
 * make the one that matters invisible.
 */
function SourceBadge({ source }: { source: MotionBeatView["source"] }) {
  if (source === "fallback") {
    return <Badge variant="outline">plain — design failed</Badge>;
  }
  if (source === "repaired") {
    return <Badge variant="outline">repaired</Badge>;
  }
  return null;
}
