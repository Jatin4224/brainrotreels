/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: FootageStudio, COST_ON_THE_BUTTON,
 *   ZOD_SCHEMA_IS_THE_FORM, A_FAILED_CLIP_IS_STILL_SHOWN,
 *   POLL_WHILE_SOMETHING_IS_PROCESSING, THEME_TOKENS_ONLY,
 *   THE_REFUSAL_IS_THE_COPY
 *
 * WHAT:  The footage studio: a prompt box with examples, a length choice, the
 *        cost on the button, and the grid of clips this workspace has made.
 *
 * WHY:   COST_ON_THE_BUTTON is Phase 05's rule and it matters more here than
 *        anywhere else in the product: this is the most expensive thing a
 *        customer can do, and the price comes from the SERVER through the same
 *        estimator the hold uses. A number computed in the browser would be a
 *        second implementation of pricing, and the first time the rate changed
 *        the button would promise one figure while the ledger took another.
 *
 *        ZOD_SCHEMA_IS_THE_FORM, per CLAUDE.md rule 5: the resolver is
 *        `generateFootageSchema`, the same schema the procedure validates
 *        with, so the 500-character limit a customer meets on screen is the
 *        one the server enforces.
 *
 *        THE_REFUSAL_IS_THE_COPY. The three ways this can be refused — no
 *        provider, no allowance, a blocked prompt — all arrive as server
 *        messages written for a customer, and they are shown as written. A
 *        blocked prompt in particular has to say what to do differently
 *        ("avoid real people, brands and trademarks"), because "that prompt
 *        cannot be used" on its own produces a second identical attempt.
 *
 *        POLL_WHILE_SOMETHING_IS_PROCESSING, and only then. A generation takes
 *        minutes, so the grid refetches every few seconds while any clip is
 *        `processing` and stops when none is. Polling a quiet screen forever
 *        is a request every few seconds per open tab for a library that
 *        changes a few times a month.
 *
 *        A_FAILED_CLIP_IS_STILL_SHOWN, with its reason and a note that the
 *        credits came back — a customer who spent money and got nothing needs
 *        both facts without asking.
 *
 *        THEME_TOKENS_ONLY: dashboard chrome, so every colour is a token.
 * WHERE: /dashboard/footage.
 */

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useActiveOrganizationId } from "@/hooks/use-active-organization";
import {
  DEFAULT_FOOTAGE_DURATION,
  FOOTAGE_DURATIONS,
  footageFormSchema,
  type FootageDuration,
  type FootageFormValues,
} from "@/lib/types/footage";
import { trpc } from "@/trpc/react-provider";

import { InsertClipDialog } from "./insert-clip-dialog";

/**
 * SOURCE OF TRUTH KEYWORDS: PROMPT_EXAMPLES, EXAMPLES_TEACH_THE_LIMITS
 *
 * The phase's step 6 asks for examples, and these are chosen to teach what the
 * moderation rule enforces as much as what the model is good at: every one is
 * a SCENE with no person, no brand and no likeness in it. A customer who
 * starts from one of these does not meet the content refusal.
 */
const PROMPT_EXAMPLES = [
  "Slow aerial push over a misty pine forest at sunrise",
  "Close-up of coffee being poured into a glass cup, steam rising",
  "Neon city street at night after rain, shallow depth of field",
  "Hands kneading dough on a floured wooden table, overhead",
] as const;

export function FootageStudio() {
  const organizationId = useActiveOrganizationId();
  const utils = trpc.useUtils();

  const [duration, setDuration] =
    React.useState<FootageDuration>(DEFAULT_FOOTAGE_DURATION);

  /* The clip whose "Use in project" dialog is open, or null. */
  const [inserting, setInserting] = React.useState<{
    id: string;
    prompt: string;
  } | null>(null);

  const form = useForm<FootageFormValues>({
    resolver: zodResolver(footageFormSchema),
    defaultValues: {
      organizationId: organizationId ?? "",
      prompt: "",
      durationSec: DEFAULT_FOOTAGE_DURATION,
    },
  });

  const clips = trpc.aiFootage.list.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled: organizationId !== undefined,
      /* POLL_WHILE_SOMETHING_IS_PROCESSING — and not otherwise. */
      refetchInterval: (query) =>
        query.state.data?.clips.some((clip) => clip.status === "processing")
          ? 5_000
          : false,
    },
  );

  const quote = trpc.aiFootage.estimate.useQuery(
    { organizationId: organizationId ?? "", durationSec: duration },
    { enabled: organizationId !== undefined },
  );

  const generate = trpc.aiFootage.generate.useMutation({
    onSuccess: (result) => {
      void utils.aiFootage.list.invalidate();
      void utils.aiFootage.estimate.invalidate();
      form.reset({
        organizationId: organizationId ?? "",
        prompt: "",
        durationSec: duration,
      });

      toast.success(
        result.reused
          ? "You had already generated this clip, so it was not charged again."
          : "Generating. It usually takes a minute or two.",
      );
    },
    /* THE_REFUSAL_IS_THE_COPY — the server's sentence, as written. */
    onError: (error) => toast.error(error.message),
  });

  const onSubmit = (values: FootageFormValues) => {
    if (organizationId === undefined) return;
    generate.mutate({
      ...values,
      organizationId,
      durationSec: duration,
      regenerate: false,
    });
  };

  /**
   * SOURCE OF TRUTH KEYWORDS: regenerateClip, A_SECOND_TAKE_IS_A_SECOND_SPEND,
   *   THE_PROMPT_GOES_BACK_IN_THE_BOX
   *
   * Asks for another take of a clip's prompt, bypassing the cache.
   *
   * THE_PROMPT_GOES_BACK_IN_THE_BOX as well as being submitted, so the
   * customer can see what was sent and edit it for a third attempt without
   * retyping it. The form is the record of what is being asked.
   *
   * A_SECOND_TAKE_IS_A_SECOND_SPEND — this is charged, so the toast says the
   * price rather than letting the balance change silently.
   */
  const regenerateClip = (clip: { prompt: string; durationSec: number | null }) => {
    if (organizationId === undefined) return;

    /* A clip generated before this release, or one whose probe corrected the
     * length to something off the closed set, falls back to the current
     * choice rather than sending a duration the schema would refuse. */
    const asked = FOOTAGE_DURATIONS.find(
      (seconds) => seconds === clip.durationSec,
    );
    const next = asked ?? duration;

    setDuration(next);
    form.setValue("prompt", clip.prompt);

    generate.mutate({
      organizationId,
      prompt: clip.prompt,
      durationSec: next,
      regenerate: true,
    });
  };

  const unavailable = quote.data?.available === false;
  const disallowed = quote.data?.allowed === false;
  const cost = quote.data?.cost.total ?? null;
  const balance = quote.data?.balance ?? null;
  const affordable = cost === null || balance === null || balance >= cost;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="text-base">Generate a clip</CardTitle>
          <p className="text-muted-foreground text-sm">
            Describe a scene and a few seconds of footage are made for you. Keep
            real people, brands and trademarks out of it — prompts are checked
            before anything is generated.
          </p>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {unavailable && (
            <p className="text-muted-foreground border-l-2 pl-3 text-sm">
              Footage generation is not configured on this deployment yet.
              Everything else works meanwhile.
            </p>
          )}

          {disallowed && !unavailable && (
            <p className="text-muted-foreground border-l-2 pl-3 text-sm">
              {quote.data?.upgradeMessage}
            </p>
          )}

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
            >
              <FormField
                control={form.control}
                name="prompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scene</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder={PROMPT_EXAMPLES[0]}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-wrap gap-2">
                {PROMPT_EXAMPLES.map((example) => (
                  <Button
                    key={example}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => form.setValue("prompt", example)}
                  >
                    {example.split(" ").slice(0, 3).join(" ")}…
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Length</Label>
                  <div className="flex gap-2">
                    {FOOTAGE_DURATIONS.map((seconds) => (
                      <Button
                        key={seconds}
                        type="button"
                        variant={seconds === duration ? "default" : "outline"}
                        size="sm"
                        onClick={() => setDuration(seconds)}
                      >
                        {seconds}s
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <Button
                    type="submit"
                    disabled={
                      generate.isPending ||
                      organizationId === undefined ||
                      unavailable ||
                      disallowed ||
                      !affordable
                    }
                  >
                    {generate.isPending
                      ? "Starting…"
                      : /* COST_ON_THE_BUTTON — the server's number. */
                        cost === null
                        ? "Generate"
                        : `Generate · ${cost} credits`}
                  </Button>
                  {!affordable && cost !== null && (
                    <span className="text-muted-foreground text-xs">
                      {balance} credits available. Top up to generate.
                    </span>
                  )}
                </div>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="text-base">Your clips</CardTitle>
          <p className="text-muted-foreground text-sm">
            Generated footage lives in your media library and can be used as a
            background in any project.
          </p>
        </CardHeader>

        <CardContent>
          {clips.isPending ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="aspect-[9/16] w-full" />
              ))}
            </div>
          ) : clips.error !== null ? (
            <p className="text-muted-foreground text-sm">
              {clips.error.message}
            </p>
          ) : clips.data.clips.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No clips yet. Describe a scene above and one will appear here.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {clips.data.clips.map((clip) => (
                <div key={clip.id} className="flex flex-col gap-2">
                  <div className="bg-muted relative aspect-[9/16] overflow-hidden rounded-md">
                    {clip.status === "ready" && clip.url !== null ? (
                      /* The PROXY, not the master — see SIGNED_ON_READ in the
                         service. `preload="none"` so a grid of a dozen clips
                         does not fetch a dozen videos nobody has played. */
                      <video
                        src={clip.url}
                        {...(clip.posterUrl !== null
                          ? { poster: clip.posterUrl }
                          : {})}
                        controls
                        preload="none"
                        playsInline
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-4 text-center">
                        <span className="text-muted-foreground text-xs">
                          {clip.status === "failed"
                            ? (clip.error ??
                              "This clip could not be generated.")
                            : "Generating…"}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <p className="text-muted-foreground line-clamp-2 text-xs">
                      {clip.prompt}
                    </p>
                    {clip.status === "failed" && (
                      <Badge variant="outline">failed</Badge>
                    )}
                  </div>

                  {/* The phase's step 6: regenerate, and insert into a
                      project. Both are offered on a FAILED clip too —
                      regenerating is the obvious next move after a failure,
                      and the prompt is right there. A clip still processing
                      has nothing to act on yet. */}
                  {clip.status !== "processing" && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          generate.isPending ||
                          organizationId === undefined ||
                          unavailable ||
                          disallowed ||
                          !affordable
                        }
                        onClick={() => regenerateClip(clip)}
                      >
                        {cost === null
                          ? "Regenerate"
                          : `Regenerate · ${cost} credits`}
                      </Button>

                      {clip.status === "ready" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setInserting({ id: clip.id, prompt: clip.prompt })
                          }
                        >
                          Use in project
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {inserting !== null && organizationId !== undefined && (
        <InsertClipDialog
          organizationId={organizationId}
          assetId={inserting.id}
          prompt={inserting.prompt}
          onClose={() => setInserting(null)}
        />
      )}
    </div>
  );
}
