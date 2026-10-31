/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: DesignStylePanel, THREE_QUESTIONS,
 *   CODE_VALIDATES_NOT_THE_EYE, DESIGNED_IS_PREVIEWED_NOT_SAVED,
 *   ZOD_SCHEMA_IS_THE_FORM
 *
 * WHAT:  "Design one for me" — three questions, a model proposes tokens, and
 *        the result is previewed live beside the library styles.
 *
 * WHY:   THREE_QUESTIONS, and the phase file is specific about the number. The
 *        point is not to gather requirements; it is to give a model just enough
 *        to make a defensible choice while keeping the form something somebody
 *        finishes. A seven-field version produces fewer designed styles than a
 *        three-field one.
 *
 *        ZOD_SCHEMA_IS_THE_FORM, per CLAUDE.md rule 5: the resolver is
 *        `designMotionStyleSchema`, the same schema the procedure validates
 *        with. The field lengths a customer bumps into on screen are therefore
 *        the ones the server enforces, and neither can drift.
 *
 *        DESIGNED_IS_PREVIEWED_NOT_SAVED. The result lives in this component's
 *        state and nothing is written. Applying a style to a project is 16d's
 *        job, because the field it writes (`style.motionStyleId` on a motion
 *        document) only exists on a project once a motion document does. A
 *        save button here would write a field no renderer reads yet.
 *
 *        CODE_VALIDATES_NOT_THE_EYE is visible in the failure path rather than
 *        the success one: when the model's proposal is refused twice the
 *        procedure throws, and the copy says to pick from the library instead.
 *        A half-valid style shown with a warning would put an unreadable video
 *        one click away.
 * WHERE: Rendered by the motion gallery route beneath the library.
 */

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { MotionPreview } from "@/components/global/motion-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useActiveOrganizationId } from "@/hooks/use-active-organization";
import { GALLERY_SCENES } from "@/lib/scene";
import { trpc } from "@/trpc/react-provider";
import {
  designMotionStyleSchema,
  type DesignMotionStyleValues,
  type MotionStyle,
} from "@/lib/types/motion-style";
import type { CanvasSpec } from "@/lib/timeline";
import type { SafeZone } from "@/lib/types/caption";

/* The three cards a designed style is previewed on. Chosen to show what the
 * tokens actually change: a title shows the fonts and the entrance curve, a
 * counter shows the accent and the numeral face, and the graph shows radius and
 * stroke weight — which are invisible on text alone. */
const PREVIEW_SCENE_IDS = ["title-and-subhead", "stat-hero", "flow"] as const;

export function DesignStylePanel({
  canvas,
  safeZone,
  width,
}: {
  canvas: CanvasSpec;
  safeZone: SafeZone;
  width: number;
}) {
  const organizationId = useActiveOrganizationId();
  const [designed, setDesigned] = React.useState<{
    style: MotionStyle;
    rationale: string;
  } | null>(null);

  const form = useForm<DesignMotionStyleValues>({
    resolver: zodResolver(designMotionStyleSchema),
    defaultValues: {
      organizationId: organizationId ?? "",
      subject: "",
      audience: "",
      feeling: "",
    },
  });

  const design = trpc.motionStudio.designStyle.useMutation({
    onSuccess: (result) => {
      setDesigned({ style: result.style, rationale: result.rationale });
      toast.success(`Designed "${result.style.name}"`);
    },
    onError: (error) => {
      /* The procedure throws UNPROCESSABLE_CONTENT when the model's proposal
       * failed validation twice, and its message already tells the customer to
       * pick from the library — so it is shown as written rather than wrapped
       * in copy of our own. */
      toast.error(error.message);
    },
  });

  const onSubmit = (values: DesignMotionStyleValues) => {
    /* `useActiveOrganizationId` is undefined until the session resolves, and
     * the procedure needs it to pick the workspace — so the submit is a no-op
     * rather than a request that would be refused. The button is disabled for
     * the same window. */
    if (organizationId === undefined) return;
    design.mutate({ ...values, organizationId });
  };

  const previews = GALLERY_SCENES.filter((entry) =>
    (PREVIEW_SCENE_IDS as readonly string[]).includes(entry.id),
  );

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="text-base">Design one for me</CardTitle>
        <p className="text-muted-foreground text-sm">
          Three questions. The model picks from the same menu the library uses —
          a palette, two fonts, a radius, a stroke weight, a motion personality,
          a caption treatment and a music mood — and code checks the result
          before you see it.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4 sm:grid-cols-3"
          >
            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What are the videos about?</FormLabel>
                  <FormControl>
                    <Input placeholder="Our new audit log" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="audience"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Who is watching?</FormLabel>
                  <FormControl>
                    <Input placeholder="Security teams" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="feeling"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>How should it feel?</FormLabel>
                  <FormControl>
                    <Input placeholder="Serious and precise" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="sm:col-span-3">
              <Button
                type="submit"
                disabled={design.isPending || organizationId === undefined}
              >
                {design.isPending ? "Designing…" : "Design a style"}
              </Button>
            </div>
          </form>
        </Form>

        {designed === null ? null : (
          <div className="flex flex-col gap-4 border-t pt-6">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{designed.style.name}</p>
              <p className="text-muted-foreground text-sm">
                {designed.rationale}
              </p>
              <p className="text-muted-foreground text-xs">
                {designed.style.paletteId} · {designed.style.radius} corners ·{" "}
                {designed.style.strokeWeight} strokes ·{" "}
                {designed.style.motionPersonality} motion ·{" "}
                {designed.style.captionTreatment} captions ·{" "}
                {designed.style.musicMood} music
              </p>
            </div>

            {/* Previewed on three cards rather than one, because no single beat
                shows every token — radius and stroke weight are invisible on
                text alone. */}
            <div className="flex flex-wrap gap-4">
              {previews.map((entry) => (
                <MotionPreview
                  key={entry.id}
                  scene={entry.scene}
                  canvas={canvas}
                  /* The proposal itself, not its id — it is not in the library,
                     so an id would resolve to the default and every token
                     would silently be the wrong one. See
                     A_RESOLVED_STYLE_NOT_AN_ID. */
                  style={designed.style}
                  safeZone={safeZone}
                  durationSeconds={entry.durationSeconds}
                  width={width}
                />
              ))}
            </div>

            <p className="text-muted-foreground text-xs">
              Not saved. Applying a style to a project arrives with the motion
              designer.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
