/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: MotionGallery, GALLERY_IS_THE_REVIEW_SURFACE,
 *   CHECKS_ARE_SHOWN_NOT_HIDDEN, REVIEW_BOTH_ASPECTS, THEME_TOKENS_FOR_CHROME
 *
 * WHAT:  The review surface for the motion primitive library — every
 *        hand-written scene, drawn live, with the palette, the aspect and the
 *        safe zone switchable, and each card's deterministic check result
 *        beside it.
 *
 * WHY:   GALLERY_IS_THE_REVIEW_SURFACE. architecture.md names motion quality
 *        as depending on the PRIMITIVE LIBRARY rather than on the model, so
 *        the phase requires a human to look at all of it before any AI is
 *        connected — while there is still nothing else to blame for a bad
 *        frame. This screen is that review.
 *
 *        CHECKS_ARE_SHOWN_NOT_HIDDEN. Each card runs `checkScene` for the
 *        chosen palette, aspect and safe zone and prints the result. A gallery
 *        that only drew pictures would make a reviewer the overflow detector,
 *        which is the job the engine exists to do — and the combination that
 *        actually fails is usually a specific one (this layout, at this
 *        aspect, inside TikTok's insets), which is exactly what a static
 *        screenshot set would miss.
 *
 *        REVIEW_BOTH_ASPECTS, and the aspect switch is the first control for a
 *        reason: `split-2` and `grid-3` divide the LONGER side of the safe
 *        rectangle (SPLIT_ALONG_THE_LONG_AXIS), so they are columns on 16:9
 *        and rows on 9:16. That is the design decision in this engine most
 *        worth a second opinion, and it cannot be judged at one aspect.
 *
 *        THEME_TOKENS_FOR_CHROME. The CARDS contain literal render colours,
 *        because video has no theme (RENDER_COLOURS_ARE_LITERAL) — but every
 *        pixel of this screen's own furniture uses the theme tokens, like
 *        every other dashboard surface. The two colour systems meet at the
 *        edge of the preview and nowhere else.
 * WHERE: /dashboard/projects/[id]/motion.
 */

import * as React from "react";

import { MotionPreview } from "@/components/global/motion-preview";
import { DesignStylePanel } from "./design-style-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getMotionStyle, listMotionStyles } from "@/lib/motion-styles";
import { listPalettes } from "@/lib/palettes";
import { checkScene, GALLERY_SCENES } from "@/lib/scene";
import { ASPECT_RATIOS, CANVAS_BY_ASPECT, type AspectRatio } from "@/lib/types";
import { SAFE_ZONES, type SafeZone } from "@/lib/types/caption";

/* Wide enough that a numeral at the role's floor is legible on screen, narrow
 * enough that three cards fit a laptop. */
const CARD_WIDTH = 300;

export function MotionGallery() {
  const [aspect, setAspect] = React.useState<AspectRatio>("9:16");
  const [styleId, setStyleId] = React.useState("studio");
  /* An empty string means "use the style's own palette", which is what a real
   * render does. The override exists because the phase requires reviewing
   * every primitive in every PALETTE, not only in the five the styles pick. */
  const [paletteId, setPaletteId] = React.useState("");
  const [safeZone, setSafeZone] = React.useState<SafeZone>("none");
  const [showSafeZone, setShowSafeZone] = React.useState(false);

  const canvas = CANVAS_BY_ASPECT[aspect];
  const palettes = listPalettes();
  const styles = listMotionStyles();
  /* Resolved here rather than inside the preview — see A_RESOLVED_STYLE_NOT_AN_ID. */
  const style = getMotionStyle(styleId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4">
        <Field label="Aspect">
          {/* The Select's `onValueChange` can report null (a cleared
              selection), which none of these three controls offers — so the
              null is ignored rather than cast away. A cast would compile and
              then set `undefined` as a palette id the first time the component
              library changed its mind about clearing. */}
          <Select
            value={aspect}
            onValueChange={(value) => {
              if (isAspectRatio(value)) setAspect(value);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASPECT_RATIOS.map((ratio) => (
                <SelectItem key={ratio} value={ratio}>
                  {ratio}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Style">
          <Select
            value={styleId}
            onValueChange={(value) => {
              if (value !== null) setStyleId(value);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {styles.map((style) => (
                <SelectItem key={style.id} value={style.id}>
                  {style.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Palette">
          <Select
            value={paletteId}
            onValueChange={(value) => {
              if (value !== null) setPaletteId(value);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Style default</SelectItem>
              {palettes.map((palette) => (
                <SelectItem key={palette.id} value={palette.id}>
                  {palette.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Safe zone">
          <Select
            value={safeZone}
            onValueChange={(value) => {
              if (isSafeZone(value)) setSafeZone(value);
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SAFE_ZONES.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="flex items-center gap-2 pb-1">
          <Switch
            id="show-safe-zone"
            checked={showSafeZone}
            onCheckedChange={setShowSafeZone}
          />
          <Label htmlFor="show-safe-zone" className="text-sm font-normal">
            Show the safe rectangle
          </Label>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        Every primitive and layout, hand-written — no model is involved. Switch
        the aspect: <code>split-2</code> and <code>grid-3</code> divide the
        longer side of the frame, so they are columns at 16:9 and rows at 9:16.
      </p>

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {GALLERY_SCENES.map((entry) => {
          /* CHECKS_ARE_SHOWN_NOT_HIDDEN — re-run for the chosen combination,
             because the combination is what fails. */
          const result = checkScene(entry.scene, {
            canvas,
            safeZone,
            /* The gallery's scenes are timed in seconds, never anchored: there
               is no transcript behind a hand-written fixture, so a word anchor
               would be unresolvable by construction. */
            wordCount: 0,
            durationSeconds: entry.durationSeconds,
          });

          return (
            <Card key={entry.id} className="overflow-hidden">
              <CardHeader className="gap-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{entry.title}</CardTitle>
                  <Badge variant={result.ok ? "secondary" : "destructive"}>
                    {result.ok ? "checks pass" : `${result.errors.length} issue${result.errors.length === 1 ? "" : "s"}`}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {entry.note}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <MotionPreview
                  scene={entry.scene}
                  canvas={canvas}
                  style={style}
                  paletteId={paletteId === "" ? undefined : paletteId}
                  safeZone={safeZone}
                  durationSeconds={entry.durationSeconds}
                  width={CARD_WIDTH}
                  showSafeZone={showSafeZone}
                />
                {result.ok ? null : (
                  <ul className="flex flex-col gap-1">
                    {result.errors.map((error) => (
                      <li
                        key={`${error.path}-${error.code}`}
                        className="text-destructive text-xs"
                      >
                        <span className="font-mono">{error.path}</span>{" "}
                        {error.message}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* The phase's step 9. Last on the screen because the library above it is
          what a reviewer judges first — a designed style is only trustworthy
          once the primitives it is made of have been looked at. */}
      <DesignStylePanel canvas={canvas} safeZone={safeZone} width={CARD_WIDTH} />
    </div>
  );
}

/* Narrowing rather than casting — the two unions are the app's own closed
 * vocabularies, so membership is checkable and a cast would only hide a value
 * that is not in them. */
function isAspectRatio(value: string | null): value is AspectRatio {
  return value !== null && (ASPECT_RATIOS as readonly string[]).includes(value);
}

function isSafeZone(value: string | null): value is SafeZone {
  return value !== null && (SAFE_ZONES as readonly string[]).includes(value);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      {children}
    </div>
  );
}
