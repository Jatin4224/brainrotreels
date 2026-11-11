/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: PortalOrganizations, DataTable, PORTAL_PAGE_SIZE,
 *   PortalOrganizationRow, PLACEHOLDER_DIMMING, inferRouterOutputs
 *
 * WHAT:  Paginated list of every organization on the platform (name, plan,
 *        members, created), for the portal admin.
 * WHY:   Uses the shared <DataTable>. The hand-rolled version this replaces
 *        had the exact bug DataTable exists to end: `useQuery({ page })` with
 *        no `placeholderData`, so every page turn produced a new query key,
 *        `isLoading` went true again and the whole list collapsed to a grey
 *        <Skeleton>. /portal/users was migrated when DataTable landed and this
 *        page was missed, which is also why the two portal lists looked
 *        nothing alike — a real <Table> on one, a `divide-y` card stack with a
 *        differently-worded pager on the other.
 *
 *        ROW TYPE COMES FROM THE ROUTER, not from the service. The service
 *        exports `PortalOrganizationRow`, but it is `import 'server-only'` and
 *        this is a client component; `inferRouterOutputs` is how every other
 *        table in the app (audit-logs, media, projects) names its row, and it
 *        cannot drift from what the procedure actually returns.
 *
 *        PAGE_SIZE still mirrors PORTAL_PAGE_SIZE in src/trpc/routers/portal.ts
 *        — portal.listOrganizations returns `{ items, total }` with no
 *        `totalPages`, so the client derives it and the two must agree.
 * WHERE: Rendered by /portal/organizations. Reads trpc.portal.listOrganizations.
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

type PortalOrganizationRow =
  inferRouterOutputs<AppRouter>["portal"]["listOrganizations"]["items"][number];

const columns: readonly DataTableColumn<PortalOrganizationRow>[] = [
  {
    id: "organization",
    header: "Organization",
    cell: (org) => (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{org.name}</span>
          {org.isPortalOrganization ? (
            <Badge variant="secondary">Portal</Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">/{org.slug}</p>
      </div>
    ),
  },
  {
    id: "members",
    header: "Members",
    hideOnMobile: true,
    className: "text-muted-foreground whitespace-nowrap",
    cell: (org) => `${org.memberCount} member${org.memberCount === 1 ? "" : "s"}`,
  },
  {
    id: "created",
    header: "Created",
    hideOnMobile: true,
    className: "text-muted-foreground whitespace-nowrap",
    cell: (org) => new Date(org.createdAt).toLocaleDateString(),
  },
  {
    id: "plan",
    header: "Plan",
    className: "text-right",
    cell: (org) => (
      <div className="flex shrink-0 justify-end">
        <Badge variant="outline" className="capitalize">
          {org.plan ?? "free"}
          {org.subscriptionStatus ? ` · ${org.subscriptionStatus}` : ""}
        </Badge>
      </div>
    ),
  },
];

export function PortalOrganizations() {
  const [page, setPage] = React.useState(1);
  const query = trpc.portal.listOrganizations.useQuery(
    { page },
    { placeholderData: (previous) => previous, retry: false },
  );

  const data = query.data;

  return (
    <DataTable<PortalOrganizationRow>
      columns={columns}
      rows={data?.items ?? []}
      getRowId={(org) => org.id}
      total={data?.total ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      onPageChange={setPage}
      isLoading={query.isPending && data === undefined}
      isFetching={query.isFetching}
      error={query.error?.message ?? null}
      empty="No organizations yet."
      countLabel={["organization", "organizations"]}
    />
  );
}
