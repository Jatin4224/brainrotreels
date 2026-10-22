/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: VideoOpsConsole, OpsStat, COST_IS_AN_ESTIMATE,
 *   ONE_QUERY_SIX_PANELS, MARGIN_IS_THE_HEADLINE, STALE_IS_THE_ALARM
 *
 * WHAT:  The video-operations console: volume, reliability, render speed,
 *        economics, provider health and queue depth.
 *
 * WHY:   MARGIN_IS_THE_HEADLINE. The phase's own test of this screen is that it
 *        answers "what did yesterday's videos cost us, and what did we charge?"
 *        without anybody writing a query — so cost against revenue is the FIRST
 *        panel and the only one with a number large enough to read across the
 *        room. Everything else on the page explains that number.
 *
 *        COST_IS_AN_ESTIMATE, said on the screen and not only in a comment. The
 *        figures multiply units we recorded by list prices entered by hand; they
 *        are not an invoice (OUR_RECORDS_NOT_THEIR_INVOICE in
 *        src/services/video-ops.service.ts). An operator who believes this is
 *        the bill will eventually be wrong by a margin that matters, so the
 *        caveat is in the panel rather than in a tooltip.
 *
 *        ONE_QUERY_SIX_PANELS — all six come from `portal.videoOps` in one
 *        round trip, so every panel describes the same window. Six queries
 *        would let the panels drift apart while the page loaded.
 *
 *        STALE_IS_THE_ALARM: queue depth is shown, but the number that is
 *        styled as a warning is the STALE count — work in flight for over an
 *        hour. Depth alone cannot tell a busy afternoon from a silent
 *        breakage, and that distinction is the whole reason the panel exists.
 * WHERE: Rendered by /portal/videos.
 */

import * as React from "react";

import { trpc } from "@/trpc/react-provider";
import { PIPELINE_STAGE_LABELS } from "@/lib/types/pipeline";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

/* The windows an operator actually asks for. A free-form range would need a
 * date picker and answer no question this console is for. */
const WINDOWS = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
] as const;

export function VideoOpsConsole() {
  const [days, setDays] = React.useState("7");

  const ops = trpc.portal.videoOps.useQuery(
    { days: Number(days) },
    {
      retry: false,
      placeholderData: (previous) => previous,
      /* The console is a monitoring surface, so it refreshes itself — an
       * operator leaves it open on a second screen. A minute is far longer
       * than the data's own cadence and cheap enough to leave running. */
      refetchInterval: 60_000,
    },
  );

  if (ops.isPending) return <Skeleton className="h-[40rem] w-full rounded-xl" />;

  if (ops.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{ops.error.message}</AlertDescription>
      </Alert>
    );
  }

  const data = ops.data;
  if (data === undefined) return null;

  const { economics, renderTimes, queue, stages, providers, volume } = data;
  const totalVideos = volume.reduce((sum, row) => sum + row.total, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {totalVideos.toLocaleString("en-US")} project
          {totalVideos === 1 ? "" : "s"} created since{" "}
          {new Date(data.since).toLocaleDateString("en-US")}
        </p>
        {/* The Select yields `string | null` — null is "cleared", which this
            control never offers — so the window falls back rather than being
            set to an empty value that would widen the query to the clamp. */}
        <Select value={days} onValueChange={(value) => setDays(value ?? "7")}>
          <SelectTrigger className="w-[11rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOWS.map((window) => (
              <SelectItem key={window.value} value={window.value}>
                {window.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* MARGIN_IS_THE_HEADLINE. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost against revenue</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <OpsStat label="Cost to us" value={usd(economics.costUsd)} />
            <OpsStat label="Charged" value={usd(economics.chargedUsd)} />
            <OpsStat
              label="Margin"
              value={usd(economics.marginUsd)}
              /* The one figure on the page worth colouring, because its SIGN is
                 the whole message. */
              tone={economics.marginUsd < 0 ? "bad" : "good"}
            />
            <OpsStat
              label="Cost per video"
              value={usd(economics.costPerVideoUsd)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["Render", economics.spend.render],
                ["Models", economics.spend.llm],
                ["Voices", economics.spend.tts],
                ["Alignment", economics.spend.stt],
              ] as const
            ).map(([label, amount]) => (
              <Badge key={label} variant="secondary" className="font-normal">
                {label} {usd(amount)}
              </Badge>
            ))}
          </div>

          {/* COST_IS_AN_ESTIMATE — on the screen, not in a tooltip. */}
          <p className="text-xs text-muted-foreground">
            Estimated from our own usage records at list prices, not from
            provider invoices. Treat it as directional: it cannot see tiered
            discounts, minimum charges or egress. Revenue counts committed
            credits only — holds and refunds are excluded.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Render time</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <OpsStat
              label="Median"
              value={seconds(renderTimes.medianSeconds)}
            />
            {/* P95_NOT_AVERAGE — the number a customer complains about. */}
            <OpsStat label="p95" value={seconds(renderTimes.p95Seconds)} />
            <OpsStat label="Slowest" value={seconds(renderTimes.maxSeconds)} />
            <p className="col-span-full text-xs text-muted-foreground">
              Completed renders only, from {renderTimes.samples.toLocaleString("en-US")}{" "}
              sample{renderTimes.samples === 1 ? "" : "s"}. A failed render
              measures how long it took to break, so it is excluded.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">In flight</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <OpsStat
              label="Generating"
              value={String(queue.generatingProjects)}
            />
            <OpsStat
              label="Rendering"
              value={String(queue.queuedRenders + queue.renderingRenders)}
            />
            {/* STALE_IS_THE_ALARM. */}
            <OpsStat
              label="Stuck over an hour"
              value={String(queue.staleProjects + queue.staleRenders)}
              tone={queue.staleProjects + queue.staleRenders > 0 ? "bad" : "good"}
            />
            <OpsStat
              label="Awaiting review"
              value={String(queue.pendingModeration)}
              tone={queue.pendingModeration > 0 ? "warn" : "good"}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Failure rate by stage</CardTitle>
        </CardHeader>
        <CardContent>
          {/* In pipeline order, not sorted by failure count — an operator reads
              this as a pipeline, so the order has to be the pipeline's. */}
          <ul className="flex flex-col gap-2">
            {stages.map((stage) => (
              <li key={stage.stage} className="flex items-center gap-3">
                <span className="w-44 shrink-0 text-sm">
                  {PIPELINE_STAGE_LABELS[stage.stage].label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      stage.failureRate > 0.1
                        ? "bg-destructive"
                        : "bg-primary",
                    )}
                    style={{ width: `${Math.min(stage.failureRate * 100, 100)}%` }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {stage.attempts === 0
                    ? "not run"
                    : `${percent(stage.failureRate)} of ${stage.attempts}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Skipped stages are excluded from both the failures and the total, so
            a stage a format never runs cannot dilute the rate.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Providers</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {providers.map((provider) => (
              <div
                key={provider.provider}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="text-sm capitalize">{provider.provider}</span>
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    provider.failureRate > 0.1
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {provider.attempts === 0
                    ? "no traffic"
                    : `${percent(provider.failureRate)} failed of ${provider.attempts}`}
                </span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Our own failure records, not a provider status page. A provider
              that is slow but succeeding looks healthy here. For moderation,
              the failures column counts classifications that could not be
              performed — which block generation by design.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Volume by format</CardTitle>
          </CardHeader>
          <CardContent>
            {volume.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No projects were created in this window.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {volume.slice(-14).map((row) => (
                  <li
                    key={row.day}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="text-muted-foreground tabular-nums">
                      {row.day}
                    </span>
                    <span className="flex gap-2 text-xs">
                      {Object.entries(row.byKind)
                        .filter(([, count]) => count > 0)
                        .map(([kind, count]) => (
                          <span key={kind} className="tabular-nums">
                            {kind} {count}
                          </span>
                        ))}
                      <span className="font-medium tabular-nums">
                        {row.total}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: OpsStat, TONE_IS_NOT_THE_ONLY_SIGNAL
 *
 * WHAT:  One labelled figure.
 * WHY:   TONE_IS_NOT_THE_ONLY_SIGNAL — the colour is an accent and the LABEL
 *        and the number carry the meaning, so the panel still reads in
 *        greyscale. Every colour is a theme token; nothing here hardcodes one.
 * WHERE: Throughout the console.
 */
function OpsStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "bad" && "text-destructive",
          tone === "warn" && "text-primary",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/* Dollars with two decimals and a sign, because a negative margin is the point
 * of the panel and `-$4.10` reads faster than `($4.10)`. */
function usd(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

function seconds(value: number): string {
  if (value === 0) return "—";
  if (value < 60) return `${value.toFixed(1)}s`;
  const minutes = Math.floor(value / 60);
  return `${minutes}m ${Math.round(value % 60)}s`;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
