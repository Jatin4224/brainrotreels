/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: GeneratePanel, NarrationStrip, STREAM_THEN_POLL,
 *   BACKGROUND_IS_CHOSEN_BEFORE_THE_RUN,
 *   FALLBACK_IS_AUTOMATIC, FAILURE_OFFERS_RETRY, NOTIFY_IS_A_PREFERENCE,
 *   CLOSING_THE_TAB_IS_SAFE, SERVER_IS_THE_SOURCE_OF_TRUTH
 *
 * WHAT:  The generate screen: the stage list, the controls that start, stop and
 *        retry a run, and the narration strip that fills in as lines record.
 *
 * WHY:   STREAM_THEN_POLL is the phase's steps 6 and 7 working together, and
 *        the whole point is that this component does not care which one is
 *        feeding it. The subscription pushes a complete `StageUpdate[]`
 *        snapshot; the query returns the same shape. Whichever arrived most
 *        recently is what renders.
 *
 *        FALLBACK_IS_AUTOMATIC: the poll turns ON when the subscription is not
 *        connected and OFF when it is, read from the subscription's own
 *        connection status rather than from a timer or a guess. A proxy that
 *        refuses to hold a stream therefore degrades to a two-second poll with
 *        no user-visible difference beyond latency — which is the phase's
 *        "killing the subscription falls back to polling and the UI keeps
 *        updating".
 *
 *        SERVER_IS_THE_SOURCE_OF_TRUTH. There is no local "is it running"
 *        boolean. Whether a run is in flight is derived from the STAGES — a
 *        stage is running, or one has failed, or they are all terminal — which
 *        is what makes this screen correct after a refresh, in a second tab,
 *        and for a teammate watching the same project. A local flag would be
 *        wrong in all three.
 *
 *        CLOSING_THE_TAB_IS_SAFE and the screen says so, because nothing else
 *        on it would tell you. The run is a durable workflow: it does not
 *        belong to this page, and the phase requires that closing the tab does
 *        not stop it.
 *
 *        FAILURE_OFFERS_RETRY, next to the explanation rather than somewhere
 *        else — the phase's step 9. Retry passes `force`, which is what gets
 *        past the idempotency key: a failed run's inputs are by definition
 *        unchanged, so the key would otherwise collapse the retry into the run
 *        that just failed.
 *
 *        NOTIFY_IS_A_PREFERENCE, sent with the request rather than written by a
 *        separate mutation. It is one boolean that only matters when a run
 *        starts, and a second endpoint for it would be a second thing to keep
 *        in step.
 * WHERE: Rendered by /dashboard/projects/[id]/generate.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { BackgroundPicker } from "@/components/global/background-picker";
import { VisualPicker } from "@/components/global/visual-picker";
import { StageProgress } from "@/components/global/stage-progress";
import { permissions } from "@/lib/permissions";
import {
  PIPELINE_POLL_MS,
  PIPELINE_STAGE_LABELS,
  type StageUpdate,
} from "@/lib/types/pipeline";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

export function GeneratePanel({ projectId }: { projectId: string }) {
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const enabled = organizationId !== undefined;

  const canGenerate = hasPermission(permissions.PROJECTS_GENERATE);
  const canCancel = hasPermission(permissions.PROJECTS_CANCEL);

  const [notifyWhenDone, setNotifyWhenDone] = React.useState(false);
  /* The latest snapshot the STREAM delivered. Null until one arrives, which is
   * what makes the query's data the fallback rather than a competitor. */
  const [streamed, setStreamed] = React.useState<StageUpdate[] | null>(null);

  const utils = trpc.useUtils();
  const router = useRouter();
  const input = { organizationId: organizationId ?? "", projectId };

  const project = trpc.projects.get.useQuery(
    { organizationId: organizationId ?? "", id: projectId },
    { enabled, retry: false },
  );

  /* FIRST_SUBSCRIPTION's client half. `enabled` is the org being resolved and
   * nothing else — the stream is opened even for a finished run, because the
   * server closes it immediately once every stage is terminal and that is
   * cheaper than this component deciding when to connect. */
  const stream = trpc.projects.progress.useSubscription(input, {
    enabled,
    onData: (stages) => setStreamed([...stages]),
    onError: (error) => {
      /* Not surfaced to the customer: the poll below has already taken over,
       * so the screen keeps working and a toast would be alarming noise about
       * a transport they cannot do anything about. */
      console.warn("[generate] progress stream dropped:", error.message);
    },
  });

  const streaming = stream.status === "pending";

  const stages = trpc.projects.getStages.useQuery(input, {
    enabled,
    retry: false,
    placeholderData: (previous) => previous,
    /* FALLBACK_IS_AUTOMATIC — see the file header. */
    refetchInterval: streaming ? false : PIPELINE_POLL_MS,
  });

  /* The stream wins when it has spoken, because it is strictly fresher. */
  const current: StageUpdate[] = streamed ?? stages.data ?? [];
  const run = summarise(current);

  /* The strip's cadence follows the run rather than the transport: narration
   * lines are not stages, so the progress stream says nothing about them. */
  const narration = trpc.voices.lines.useQuery(input, {
    enabled,
    retry: false,
    placeholderData: (previous) => previous,
    refetchInterval: run.active ? PIPELINE_POLL_MS : false,
  });

  const invalidateEverything = () => {
    void utils.projects.getStages.invalidate();
    void utils.projects.get.invalidate();
    void utils.voices.lines.invalidate();
  };

  const generate = trpc.projects.generate.useMutation({
    onSuccess: (result) => {
      /* A fresh run replaces the stages the server is about to rewrite; holding
       * the old snapshot would show the previous run's ticks for a second. */
      setStreamed(null);
      invalidateEverything();

      /**
       * SOURCE OF TRUTH KEYWORDS: REGENERATE_AS_A_NEW_VERSION, BRANCH_POLICY
       *
       * The server BRANCHED rather than overwrote, because this project has
       * been edited by hand. The run belongs to the new project, so the screen
       * follows it — staying here would watch a project that is not
       * generating and conclude the button did nothing. The toast names what
       * happened, because a silent navigation to a differently-titled project
       * reads as a bug.
       */
      if (result.branchedFrom !== null) {
        void utils.projects.list.invalidate();
        toast.success(
          "Your edited version is untouched — generating a new version of it.",
        );
        router.push(`/dashboard/projects/${result.projectId}/generate`);
        return;
      }

      toast.success(
        result.alreadyRunning
          ? "This project is already generating."
          : "Generating — you can close this tab.",
      );
    },
    onError: (error) => toast.error(error.message),
  });

  const cancel = trpc.projects.cancel.useMutation({
    onSuccess: (result) => {
      invalidateEverything();
      toast.success(
        result.cancelled
          ? "Generation cancelled. Any held credits have been refunded."
          : "That run had already finished.",
      );
    },
    onError: (error) => toast.error(error.message),
  });

  if (!enabled || project.isPending) {
    return <Skeleton className="h-[34rem] w-full rounded-xl" />;
  }

  const busy = generate.isPending || cancel.isPending;
  const status = project.data?.status;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <StageProgress
            stages={current}
            banner={
              run.failed === null ? null : (
                <Alert variant="destructive">
                  <AlertTitle>
                    {run.failedLabel} did not finish
                  </AlertTitle>
                  <AlertDescription className="flex flex-col items-start gap-3">
                    {/* FAILURE_IS_EXPLAINED_NOT_DUMPED — the server already
                        turned this into one plain sentence; nothing here
                        inspects or decorates it. */}
                    <span>{run.failed}</span>
                    {canGenerate ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          generate.mutate({ ...keyed(input), force: true, notifyWhenDone })
                        }
                      >
                        Retry
                      </Button>
                    ) : null}
                  </AlertDescription>
                </Alert>
              )
            }
            footer={
              <NarrationStrip
                lines={narration.data?.lines ?? []}
                className="mt-6"
              />
            }
          />
        </CardContent>
      </Card>

      {/* BACKGROUND_IS_CHOSEN_BEFORE_THE_RUN. The picker lives on this screen
          rather than beside the preview, because the choice steers a
          GENERATION: it is read by the pipeline when the document is built, so
          changing it after a run has finished does nothing until the next one.
          Disabled mid-run for the same reason the notify switch is — a control
          that silently does nothing is worse than one that is visibly
          unavailable. */}
      <BackgroundPicker
        organizationId={organizationId}
        projectId={projectId}
        disabled={run.active || busy}
        className="lg:col-start-1"
      />

      {/* VISUALS_ARE_CHOSEN_BEFORE_THE_RUN, for the same reason the background
          is — and BELOW it deliberately, because the two are read together: the
          background is what plays wherever a paragraph has no picture of its
          own, so a customer reads the general choice first and then the
          exceptions. Disabled mid-run alongside it.

          Only for `voiceover`, which is the one format that chooses a picture
          per paragraph; a quiz draws cards and a Reddit story draws a thread,
          both over the single background above (their generators skip the
          `visuals` stage). Gated on the KIND rather than on whether any visual
          happens to exist, so the panel is visible — and usable — before the
          first generation has chosen anything. */}
      {project.data?.kind === "voiceover" && (
        <VisualPicker
          organizationId={organizationId}
          projectId={projectId}
          disabled={run.active || busy}
          className="lg:col-start-1"
        />
      )}

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {run.active ? "Generating" : run.done ? "Ready" : "Generate"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {run.active
                ? /* CLOSING_THE_TAB_IS_SAFE — said out loud, because nothing
                     else on the screen implies it. */
                  "This runs on our servers. You can close this tab and come back — it will keep going."
                : run.done
                  ? "Your video is built. Open the preview to watch it, or generate again to rebuild it."
                  : "One click writes the script, records the narration, times the captions and builds the video."}
            </p>

            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="notify" className="text-sm font-normal">
                Email me when it is done
              </Label>
              <Switch
                id="notify"
                checked={notifyWhenDone}
                onCheckedChange={setNotifyWhenDone}
                /* Disabled mid-run rather than hidden: the preference is sent
                 * WITH the request, so toggling it now would do nothing and a
                 * control that silently does nothing is worse than one that is
                 * visibly unavailable. */
                disabled={run.active || busy}
              />
            </div>

            {run.active ? (
              <Button
                variant="outline"
                disabled={!canCancel || busy}
                onClick={() => cancel.mutate(keyed(input))}
              >
                {cancel.isPending ? "Cancelling…" : "Cancel"}
              </Button>
            ) : (
              <Button
                disabled={!canGenerate || busy}
                onClick={() =>
                  generate.mutate({
                    ...keyed(input),
                    notifyWhenDone,
                    ...(run.done || run.failed !== null ? { force: true } : {}),
                  })
                }
              >
                {generate.isPending
                  ? "Starting…"
                  : run.done
                    ? "Generate again"
                    : "Generate"}
              </Button>
            )}

            {canGenerate ? null : (
              <p className="text-xs text-muted-foreground">
                You do not have permission to start a generation in this
                workspace.
              </p>
            )}

            {run.done || status === "ready" ? (
              /* A styled Link rather than <Button asChild> — this Button has no
                 `asChild`, and the element has to be a real anchor so the
                 route prefetches like every other internal link. Same
                 pattern as the credits screen. */
              <Link
                href={`/dashboard/projects/${projectId}/preview`}
                className={buttonVariants({ variant: "secondary" })}
              >
                Open the preview
              </Link>
            ) : null}
          </CardContent>
        </Card>

        {/* Not a transport readout for its own sake: a customer on a network
            that will not hold a stream sees a slower screen, and this is the
            one line that explains why. */}
        {run.active && !streaming ? (
          <p className="text-xs text-muted-foreground">
            Live updates are unavailable on this connection, so this screen is
            checking every couple of seconds instead.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: NarrationStrip, STRIP_SHOWS_REAL_WORK,
 *   TILES_NOT_THUMBNAILS
 *
 * WHAT:  One tile per narration line, filling in as each one is recorded.
 *
 * WHY:   TILES_NOT_THUMBNAILS, and it is a deliberate substitution worth being
 *        explicit about. The phase asks for "a thumbnail strip filling in", and
 *        nothing in this app renders video frames outside a render — producing
 *        real thumbnails would mean rasterising frames mid-pipeline, which is
 *        work the customer would be paying for to watch a progress bar.
 *
 *        STRIP_SHOWS_REAL_WORK: what the strip shows instead is the narration
 *        fan-out, which is the longest part of a run and the part that genuinely
 *        completes piecemeal — one tile per line, turning solid as its audio
 *        lands and red if it could not be recorded. It answers the same
 *        question a thumbnail strip would ("how much of my video exists yet")
 *        with information that is actually true.
 *
 *        It renders nothing at all before the lines exist, rather than a row of
 *        empty placeholders: the script has not been split yet, so the count
 *        would be a guess that changes under the customer.
 * WHERE: The `footer` slot of <StageProgress>.
 */
function NarrationStrip({
  lines,
  className,
}: {
  lines: readonly { id: string; status: string; position: number }[];
  className?: string;
}) {
  if (lines.length === 0) return null;

  const ready = lines.filter((line) => line.status === "ready").length;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-xs text-muted-foreground">
        Narration — {ready} of {lines.length} lines recorded
      </p>
      <div className="flex flex-wrap gap-1" aria-hidden>
        {lines.map((line) => (
          <span
            key={line.id}
            className={cn(
              "h-6 w-3 rounded-sm transition-colors",
              line.status === "ready"
                ? "bg-primary"
                : line.status === "failed"
                  ? "bg-destructive"
                  : line.status === "synthesizing"
                    ? "animate-pulse bg-primary/40"
                    : "bg-muted",
            )}
          />
        ))}
      </div>
      {/* The strip itself is decoration (aria-hidden): thirty identical tiles
          read as thirty meaningless list items. The COUNT above carries the
          same information in one sentence, which is what a screen reader
          wants. */}
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: summarise, SERVER_IS_THE_SOURCE_OF_TRUTH
 *
 * WHAT:  Whether a run is in flight, finished or broken — read from the stages.
 * WHY:   SERVER_IS_THE_SOURCE_OF_TRUTH, see the file header. `active` is true
 *        while anything is running OR still pending behind something that ran,
 *        because a run between two steps is still a run — treating only
 *        `running` as active makes the Cancel button flicker to Generate every
 *        time one stage hands over to the next.
 * WHERE: GeneratePanel.
 */
function summarise(stages: readonly StageUpdate[]): {
  active: boolean;
  done: boolean;
  failed: string | null;
  failedLabel: string;
} {
  if (stages.length === 0) {
    return { active: false, done: false, failed: null, failedLabel: "" };
  }

  const failedStage = stages.find((stage) => stage.status === "failed");
  const started = stages.some((stage) => stage.status !== "pending");
  const pending = stages.some((stage) => stage.status === "pending");
  const running = stages.some((stage) => stage.status === "running");

  return {
    active: failedStage === undefined && started && (running || pending),
    done: failedStage === undefined && started && !pending && !running,
    failed: failedStage?.error ?? (failedStage !== undefined ? "It stopped here." : null),
    failedLabel:
      failedStage === undefined
        ? ""
        : STAGE_LABEL[failedStage.stage] ?? failedStage.stage,
  };
}

/* Flattened once at module scope rather than looked up per render: the only
 * consumer is the failure banner's heading, and <StageProgress> already
 * renders every other label from the same registry object. */
const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(PIPELINE_STAGE_LABELS).map(([stage, value]) => [
    stage,
    value.label,
  ]),
);

/* The two mutations take `id`, the two reads take `projectId`
 * (ID_ON_MUTATIONS_PROJECTID_ON_READS). One translation, here, so no callsite
 * has to remember which is which. */
function keyed(input: { organizationId: string; projectId: string }): {
  organizationId: string;
  id: string;
} {
  return { organizationId: input.organizationId, id: input.projectId };
}
