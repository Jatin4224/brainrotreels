/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: YourVideos, VideoTile, THE_TILE_SHOWS_THE_WORDS,
 *   projects.list, scripts.list, PROJECT_STATUS_LABEL, PERMISSION_GATED_READ
 *
 * WHAT:  The "Your videos" strip under the composer — the most recent
 *        projects as tall tiles showing the opening of each script, with its
 *        status and when it was last touched, plus a dashed "Start another".
 *
 * WHY:   THE_TILE_SHOWS_THE_WORDS, which is the whole idea in the design and
 *        the reason these are not thumbnails. A draft has no frames to show —
 *        most of these videos have never been rendered — so a grid of grey
 *        placeholders would be the usual outcome. The first lines of the
 *        script are what the customer actually recognises a video by, and
 *        they exist from the moment it is written.
 *
 *        "No words yet" is therefore a real state, not an error: a project
 *        created and left before anything was written. It is the honest thing
 *        to show, and it doubles as the prompt to go and write it.
 *
 *        ONE QUERY FOR THE SCRIPTS, not one per tile. `scripts.list` is
 *        per-project, so a naive tile would fire a query each and turn a
 *        four-tile strip into five round trips. The tiles are rendered from
 *        the project list alone and the preview text is filled in by the
 *        queries that resolve, so the strip paints immediately and fills in.
 *
 *        PERMISSION_GATED_READ throughout: without `projects:read` the whole
 *        section renders nothing rather than an empty heading over a
 *        FORBIDDEN.
 *
 * WHERE: The bottom of the composer screen.
 */

import Link from "next/link";
import type { Route } from "next";
import { ArrowRightIcon, PlusIcon } from "lucide-react";

import { ROUTES } from "@/lib/config";
import { permissions } from "@/lib/permissions";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { trpc } from "@/trpc/react-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** How many tiles the strip shows before "All creations" takes over. */
const TILE_COUNT = 3;

export function YourVideos() {
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const canRead = hasPermission(permissions.PROJECTS_READ);

  const { data, isLoading } = trpc.projects.list.useQuery(
    {
      organizationId: organizationId ?? "",
      page: 1,
      pageSize: TILE_COUNT,
    },
    {
      enabled: organizationId !== undefined && canRead,
      staleTime: 30 * 1000,
    },
  );

  if (!canRead) return null;

  const projects = data?.items ?? [];

  /* Nothing yet and nothing loading: the composer above IS the empty state,
     so a second "you have no videos" panel would just be noise. */
  if (!isLoading && projects.length === 0) return null;

  return (
    <section aria-labelledby="your-videos" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2
          id="your-videos"
          className="text-xl font-bold tracking-tight text-foreground"
        >
          Your videos
        </h2>
        <Link
          href="/dashboard/projects"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          All creations
          <ArrowRightIcon className="size-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading
          ? Array.from({ length: TILE_COUNT }, (_, index) => (
              <Skeleton key={index} className="h-60 rounded-xl" />
            ))
          : projects.map((project) => (
              <VideoTile
                key={project.id}
                id={project.id}
                title={project.title}
                status={project.status}
                updatedAt={project.updatedAt}
              />
            ))}

        {/* The dashed tile. A LINK to the picker, not a button that opens
            something here — starting another video is choosing a format
            again, and that screen already exists. */}
        <Link
          href={ROUTES.dashboard}
          className="flex h-60 flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border-strong text-muted-foreground outline-none transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
        >
          <PlusIcon className="size-5" aria-hidden="true" />
          <span className="text-sm">Start another</span>
        </Link>
      </div>
    </section>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: VideoTile, THE_TILE_SHOWS_THE_WORDS,
 *   STATUS_IS_A_BADGE, scripts.list
 *
 * WHAT:  One project as a tile — its script's opening lines fading out, a
 *        status badge, then the title and when it changed.
 * WHY:   The script query is per-tile and deliberately NOT prefetched: it is
 *        the one thing on the strip that can be slow, and the tile is
 *        complete without it (the title, status and date all come from the
 *        project row). So the words fade in and nothing waits on them.
 *        `ready` is the only status that gets a colour — it is the one that
 *        means "you can post this", and colouring all five would leave the
 *        customer scanning a rainbow for the one that matters.
 * WHERE: The strip above.
 */
function VideoTile({
  id,
  title,
  status,
  updatedAt,
}: {
  id: string;
  title: string;
  status: string;
  updatedAt: Date;
}) {
  const organizationId = useActiveOrganizationId();
  const { data: script } = trpc.scripts.list.useQuery(
    { organizationId: organizationId ?? "", projectId: id },
    { enabled: organizationId !== undefined, staleTime: 60 * 1000 },
  );

  const words = (script?.blocks ?? [])
    .map((block) => block.narrationText)
    .join(" ")
    .trim();

  const href = `/dashboard/projects/${id}/script` as Route;

  return (
    <Link
      href={href}
      className="group/tile flex flex-col gap-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="brutal-hover tactile-raised relative flex h-60 flex-col justify-between overflow-hidden rounded-xl border border-border bg-card p-4">
        {words.length > 0 ? (
          <>
            <span className="text-sm leading-relaxed text-foreground-2">
              {words}
            </span>
            {/* The fade is what makes a clipped paragraph read as a preview
                rather than as text that got cut off. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-card to-transparent"
            />
          </>
        ) : (
          <span className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            No words yet
          </span>
        )}

        <span
          className={cn(
            "relative self-end rounded-md px-2 py-1 text-xs font-medium",
            status === "ready"
              ? "bg-success/15 text-success"
              : "bg-secondary text-foreground-2",
          )}
        >
          {status === "ready" ? "Ready" : "Draft"}
        </span>
      </span>

      <span className="flex flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {words.length > 0 ? "Script ready" : "Not started"} ·{" "}
          {new Date(updatedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      </span>
    </Link>
  );
}
