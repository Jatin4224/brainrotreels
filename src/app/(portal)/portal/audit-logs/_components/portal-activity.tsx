/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: PortalActivity, DataTable, SERVER_TOTAL_PAGES,
 *   PORTAL_PAGE_SIZE, PLACEHOLDER_DIMMING, inferRouterOutputs
 *
 * WHAT:  Platform-wide audit log (all organizations) for the portal admin.
 * WHY:   Uses the same safe-select boundary as the tenant audit log, so
 *        forensic columns (ipAddress/userAgent) are never exposed.
 *
 *        Uses the shared <DataTable>. The hand-rolled version this replaces
 *        had the bug DataTable exists to end: `useQuery({ page })` with no
 *        `placeholderData`, so each page turn was a new query key, `isLoading`
 *        went true again and the list collapsed to a grey <Skeleton> on every
 *        Previous/Next. On an audit log that is worse than cosmetic — the
 *        reader loses their place in a chronological list.
 *
 *        SERVER_TOTAL_PAGES: `listPlatformActivity` already computes
 *        `totalPages`, so it is passed through rather than re-derived from
 *        `total / pageSize` on a page size the client only asserts matches.
 *        It is spread conditionally because `exactOptionalPropertyTypes` is on
 *        and the prop is optional — `totalPages={undefined}` is a type error.
 *
 *        ROW TYPE COMES FROM THE ROUTER via `inferRouterOutputs`, the same way
 *        the tenant audit table names its row, so it cannot drift from what
 *        the procedure returns.
 * WHERE: Rendered by /portal/audit-logs. Reads trpc.portal.listActivity.
 */

import * as React from "react";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/trpc/routers/_app";
import { trpc } from "@/trpc/react-provider";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/global/data-table";
import { Badge } from "@/components/ui/badge";

/* Mirrors PORTAL_PAGE_SIZE in src/trpc/routers/portal.ts. */
const PAGE_SIZE = 25;

type PortalActivityRow =
  inferRouterOutputs<AppRouter>["portal"]["listActivity"]["logs"][number];

const columns: readonly DataTableColumn<PortalActivityRow>[] = [
  {
    id: "event",
    header: "Event",
    cell: (log) => (
      <div className="min-w-0">
        <p className="truncate text-sm">
          {log.description ?? `${log.action} ${log.entity}`}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {log.user?.name ?? "Someone"}
        </p>
      </div>
    ),
  },
  {
    id: "when",
    header: "When",
    hideOnMobile: true,
    className: "text-muted-foreground whitespace-nowrap",
    cell: (log) => new Date(log.createdAt).toLocaleString(),
  },
  {
    id: "tags",
    header: "Type",
    className: "text-right",
    cell: (log) => (
      <div className="flex shrink-0 items-center justify-end gap-1">
        <Badge variant="secondary">{log.entity}</Badge>
        <Badge variant="outline" className="capitalize">
          {log.action}
        </Badge>
      </div>
    ),
  },
];

export function PortalActivity() {
  const [page, setPage] = React.useState(1);
  const query = trpc.portal.listActivity.useQuery(
    { page },
    { placeholderData: (previous) => previous, retry: false },
  );

  const data = query.data;

  return (
    <DataTable<PortalActivityRow>
      columns={columns}
      rows={data?.logs ?? []}
      getRowId={(log) => log.id}
      total={data?.total ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      {...(data ? { totalPages: data.totalPages } : {})}
      onPageChange={setPage}
      isLoading={query.isPending && data === undefined}
      isFetching={query.isFetching}
      error={query.error?.message ?? null}
      empty="No activity recorded yet."
      countLabel={["entry", "entries"]}
    />
  );
}
