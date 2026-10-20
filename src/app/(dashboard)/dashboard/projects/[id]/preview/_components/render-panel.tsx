/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: RenderPanel, LOCKED_NOT_HIDDEN, POLL_WHILE_RUNNING,
 *   REUSE_IS_INVISIBLE, RENDER_GATE_FROM_THE_REGISTRY, WATERMARK_IS_EXPLAINED
 *
 * WHAT:  The export surface: pick a size, start a render, watch it, download
 *        it, retry it if it failed.
 *
 * WHY:   LOCKED_NOT_HIDDEN is the phase's own rule and the reason this panel
 *        renders EVERY resolution rather than only the ones the plan includes.
 *        A locked option is disabled, labelled with the plan that unlocks it,
 *        and opens the upgrade modal — because an option a customer never sees
 *        is one they have no reason to pay for. The set comes from
 *        RESOLUTION_PER_PLAN, so a pricing change moves this UI with no edit
 *        here.
 *
 *        RENDER_GATE_FROM_THE_REGISTRY: the monthly cap is enforced by
 *        `<FeatureGate resource="renders">` rather than by anything in this
 *        file. `renders` declares its `limit` in src/lib/resources.ts, so the
 *        gate knows the number, the usage and the upgrade sentence already —
 *        and a workspace at its cap gets the same modal here as it would from
 *        a server refusal.
 *
 *        WATERMARK_IS_EXPLAINED, not silently applied. A free workspace is
 *        told before it spends a render that the export will carry a mark, and
 *        told what removes it. Discovering it afterwards is how a render slot
 *        gets wasted and a customer concludes the product is broken rather
 *        than that they are on the free plan.
 *
 *        POLL_WHILE_RUNNING: nothing pushes a render's progress to the
 *        browser, so the list polls — and the predicate form means it stops by
 *        itself once nothing is unfinished. Same mechanism and same reason as
 *        the media table's POLL_WHILE_PROCESSING.
 *
 *        REUSE_IS_INVISIBLE in the happy sense: `renders.create` answers
 *        instantly with the existing render when the project has not changed,
 *        so the panel simply shows a finished render where it would have shown
 *        a progress bar. The toast says so, because a button that produces a
 *        completed render in no time otherwise reads as a bug.
 * WHERE: Rendered beside the player on /dashboard/projects/[id]/preview.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { FeatureGate, usePlanTier } from "@/components/feature-gate";
import { useUpgradeModal } from "@/components/global/upgrade-modal";
import { permissions } from "@/lib/permissions";
import { PLANS } from "@/lib/config/plans";
import { RESOURCES } from "@/lib/resources";
import {
  RENDER_ATTEMPT_LIMIT,
  RENDER_RESOLUTIONS,
  bestResolutionForPlan,
  isResolutionAllowedForPlan,
  resolutionsForPlan,
  type RenderResolution,
  type RenderStatus,
} from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Two seconds, as on the media table — fast enough to feel live, slow enough
 *  that a long render is not hundreds of requests. */
const RUNNING_POLL_MS = 2000;

/** The states that mean work is still happening, so the list keeps polling. */
const RUNNING_STATUSES: readonly RenderStatus[] = ["queued", "rendering"];

function isRunning(status: string): boolean {
  return (RUNNING_STATUSES as readonly string[]).includes(status);
}

/**
 * SOURCE OF TRUTH KEYWORDS: RENDER_STATUS_COPY
 *
 * WHAT:  What each state says to a customer.
 * WHY:   A full record over RenderStatus rather than a lookup with a fallback,
 *        so adding a state is a compile error here — a render showing a raw
 *        column value like `timedOut` is the kind of leak nobody notices until
 *        a customer quotes it back.
 * WHERE: The row below.
 */
const RENDER_STATUS_COPY: Readonly<
  Record<
    RenderStatus,
    { label: string; tone: "default" | "secondary" | "destructive" }
  >
> = {
  queued: { label: "Queued", tone: "secondary" },
  rendering: { label: "Rendering", tone: "secondary" },
  completed: { label: "Ready", tone: "default" },
  failed: { label: "Failed", tone: "destructive" },
  timedOut: { label: "Timed out", tone: "destructive" },
};

export function RenderPanel({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const upgradeModal = useUpgradeModal();
  const router = useRouter();
  const plan = usePlanTier();

  const enabled = organizationId !== undefined;
  const canRender = hasPermission(permissions.RENDERS_CREATE);

  /**
   * SOURCE OF TRUTH KEYWORDS: CHOICE_IS_DERIVED_NOT_SYNCED
   *
   * The state is what the customer CHOSE, which is nothing until they click.
   * The resolution in effect is derived from that choice falling back to the
   * plan's best option — deliberately not a `useEffect` that writes the
   * default into state once the plan resolves. That version both trips
   * react-hooks/set-state-in-effect and is genuinely worse: it renders once
   * with no selection and again with one, and it has to guard against
   * overwriting a deliberate choice to export something smaller. Derived, the
   * default simply appears the moment the plan does, and a click still wins.
   */
  const [chosen, setChosen] = React.useState<RenderResolution | null>(null);
  const resolution: RenderResolution | null =
    chosen ?? (plan === null ? null : bestResolutionForPlan(plan));

  const rendersQuery = trpc.renders.list.useQuery(
    { organizationId: organizationId ?? "", projectId },
    {
      enabled,
      retry: false,
      placeholderData: (previous) => previous,
      /* POLL_WHILE_RUNNING — the predicate is re-evaluated after every fetch,
       * so polling stops by itself when the last render settles. */
      refetchInterval: (query) =>
        (query.state.data?.rows ?? []).some((render) =>
          isRunning(render.status),
        )
          ? RUNNING_POLL_MS
          : false,
    },
  );

  const latest = rendersQuery.data?.rows[0] ?? null;

  /* The download URL is signed per request and therefore cannot live on the
   * list row (DOWNLOAD_URL_IS_SIGNED_ON_READ) — so it is fetched only for the
   * render that actually has something to download. */
  const detailQuery = trpc.renders.get.useQuery(
    { organizationId: organizationId ?? "", id: latest?.id ?? "" },
    {
      enabled: enabled && latest !== null && latest.status === "completed",
      retry: false,
    },
  );

  const createRender = trpc.renders.create.useMutation({
    onSuccess: (result) => {
      if (result.reused) {
        /* REUSE_IS_INVISIBLE — said out loud, because a render that completes
         * instantly otherwise reads as a bug rather than as a saving. */
        toast.success("This version has already been rendered", {
          description:
            "Nothing changed since the last export, so it did not cost a render.",
        });
      } else {
        toast.success("Rendering started", {
          description: "This takes a few minutes. You can leave this page.",
        });
      }
      void utils.renders.invalidate();
      /* The monthly counter moved, so the gate and any meter reading it are
         stale — unless this was a reuse, which spends nothing. The invalidate
         is unconditional because it is cheap and being wrong in the other
         direction shows a customer a quota they have already spent. */
      void utils.usage.invalidate();
    },
    onError: (error) => {
      toast.error("That render could not be started", {
        description: error.message,
      });
    },
  });

  const retryRender = trpc.renders.retry.useMutation({
    onSuccess: () => {
      toast.success("Trying that render again");
      void utils.renders.invalidate();
    },
    onError: (error) => {
      toast.error("That render could not be retried", {
        description: error.message,
      });
    },
  });

  if (!enabled || plan === null)
    return <Skeleton className="h-56 w-full rounded-xl" />;

  /* COST_ON_THE_BUTTON. The price comes from the SERVER, through the same
   * estimator the refusal and the hold use — a cost computed here would be a
   * second implementation of pricing, and the button would promise one number
   * while the handler charged another. Re-queried per resolution because that
   * is exactly what changes it. */
  const estimateQuery = trpc.renders.estimate.useQuery(
    {
      organizationId: organizationId ?? "",
      projectId,
      resolution: resolution ?? "1080p",
    },
    { enabled: enabled && resolution !== null, retry: false },
  );

  const cost = estimateQuery.data?.cost ?? null;
  const affordable = estimateQuery.data?.affordable ?? true;

  const allowed = resolutionsForPlan(plan);
  const watermarked = !planHasCleanExport(plan);
  const busy =
    createRender.isPending || (latest !== null && isRunning(latest.status));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Export</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* LOCKED_NOT_HIDDEN — every resolution is rendered; the ones this plan
            does not include are disabled and say what unlocks them. */}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Quality</p>
          <div className="flex flex-wrap gap-2">
            {RENDER_RESOLUTIONS.map((option) => {
              const unlocked = isResolutionAllowedForPlan(plan, option);
              const selected = resolution === option;

              return (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  onClick={() => {
                    if (unlocked) {
                      setChosen(option);
                      return;
                    }
                    /* The same modal a server refusal would produce, so the two
                       paths land on one screen. */
                    upgradeModal.open({
                      resource: "renders",
                      upgradeMessage: `${option} exports are included from ${PLANS.starter.name} upwards.`,
                    });
                  }}
                  /* NOT disabled when locked — a disabled button cannot be
                     clicked, and clicking is what opens the upgrade path. It is
                     styled as unavailable and behaves as an upsell. */
                  className={unlocked ? undefined : "opacity-60"}
                >
                  {option}
                  {unlocked ? null : (
                    <span className="ml-1.5 text-xs">· Upgrade</span>
                  )}
                </Button>
              );
            })}
          </div>
          {allowed.length < RENDER_RESOLUTIONS.length ? (
            <p className="text-xs text-muted-foreground">
              Your plan exports at {allowed.join(" and ")}.
            </p>
          ) : null}
        </div>

        {/* WATERMARK_IS_EXPLAINED — before the render is spent, not after. */}
        {watermarked ? (
          <Alert>
            <AlertTitle>Exports carry a watermark on your plan</AlertTitle>
            <AlertDescription>
              Upgrade to {PLANS.starter.name} to export without it.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {/* RENDER_GATE_FROM_THE_REGISTRY — the monthly cap, the usage and the
              upgrade copy all come from the `renders` registry entry. */}
          <FeatureGate resource="renders">
            <Button
              type="button"
              disabled={!canRender || busy || resolution === null}
              onClick={() => {
                if (resolution === null) return;
                /* A short balance sends them where they can fix it rather than
                   firing a request we already know the server will refuse with
                   INSUFFICIENT_CREDITS. The server still refuses it if they
                   get here another way — this is the affordance, not the
                   boundary. */
                if (!affordable) {
                  router.push("/dashboard/settings/credits");
                  return;
                }
                createRender.mutate({
                  organizationId,
                  projectId,
                  resolution,
                });
              }}
            >
              {/* COST_ON_THE_BUTTON, and the label switches to the REMEDY when
                  the balance is short — a disabled "Render (12 credits)" tells
                  a customer they cannot proceed but not what to do about it,
                  which is the version of this that generates support tickets.
                  The cost is omitted while it loads rather than shown as 0,
                  because a price that flickers from 0 to 12 reads as a bait. */}
              {busy
                ? "Rendering…"
                : !affordable
                  ? "Top up credits"
                  : cost === null
                    ? "Render video"
                    : `Render video (${cost.total} credits)`}
            </Button>
          </FeatureGate>

          {!canRender ? (
            <p className="text-xs text-muted-foreground">
              You do not have permission to render in this workspace.
            </p>
          ) : null}
        </div>

        {rendersQuery.isPending && rendersQuery.data === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : latest === null ? (
          <p className="text-sm text-muted-foreground">
            This project has not been exported yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={RENDER_STATUS_COPY[toRenderStatus(latest.status)].tone}
              >
                {RENDER_STATUS_COPY[toRenderStatus(latest.status)].label}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {latest.resolution}
                {latest.watermark ? " · watermarked" : ""}
              </span>
            </div>

            {isRunning(latest.status) ? (
              <div className="flex flex-col gap-1">
                {/* A plain bar rather than a component import — this is the one
                    progress indicator in the app, and a shared component for a
                    single caller is the duplication rule applied backwards. */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.round(latest.progress * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {Math.round(latest.progress * 100)}% · this can take a few
                  minutes
                </p>
              </div>
            ) : null}

            {latest.error !== null ? (
              <p className="text-sm text-destructive">{latest.error}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {latest.status === "completed" ? (
                detailQuery.data?.downloadUrl ? (
                  /* A plain anchor styled with buttonVariants rather than a
                     <Button>: this Button has no `asChild`, and the element
                     has to BE an anchor — the URL is signed and points at the
                     bucket, and routing the download through the app would
                     stream tens of megabytes through a serverless function for
                     nothing. */
                  <a
                    href={detailQuery.data.downloadUrl}
                    download
                    className={buttonVariants({ size: "sm" })}
                  >
                    Download
                  </a>
                ) : (
                  <Button size="sm" disabled>
                    Preparing download…
                  </Button>
                )
              ) : null}

              {(latest.status === "failed" || latest.status === "timedOut") &&
              latest.attempts < RENDER_ATTEMPT_LIMIT ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canRender || retryRender.isPending}
                  onClick={() =>
                    retryRender.mutate({ organizationId, id: latest.id })
                  }
                >
                  Try again
                </Button>
              ) : null}

              {(latest.status === "failed" || latest.status === "timedOut") &&
              latest.attempts >= RENDER_ATTEMPT_LIMIT ? (
                <p className="text-xs text-muted-foreground">
                  This render has already been retried once.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: toRenderStatus, STRING_NOT_ENUM
 *
 * WHAT:  Narrows the row's `status` string to the union the copy map is keyed
 *        by.
 * WHY:   `Render.status` is a Prisma `String` (STRING_NOT_ENUM), so what
 *        arrives at the client is typed as a string. Falling back to `failed`
 *        rather than throwing: a value this build does not recognise came from
 *        a newer deploy, and showing a render as failed is wrong but
 *        survivable, whereas an exception blanks the whole panel including the
 *        download button for every OTHER render on the screen.
 * WHERE: The row above.
 */
function toRenderStatus(value: string): RenderStatus {
  return value in RENDER_STATUS_COPY ? (value as RenderStatus) : "failed";
}

/**
 * SOURCE OF TRUTH KEYWORDS: planHasCleanExport, watermarkFree
 *
 * WHAT:  Whether this plan exports without a watermark.
 * WHY:   Read from the registry's own `watermarkFree` flag rather than
 *        restated here, so the banner and the render agree by construction.
 *        This is UX only — the server resolves the same entitlement through
 *        `checkBooleanFeature` and is the thing that decides the pixels
 *        (WATERMARK_RESOLVED_ONCE).
 * WHERE: The watermark notice above.
 */
function planHasCleanExport(plan: keyof typeof PLANS): boolean {
  return RESOURCES.watermarkFree.flag.perPlan[plan];
}
