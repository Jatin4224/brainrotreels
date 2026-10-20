/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: PortalUsers, DataTable, PORTAL_PAGE_SIZE
 *
 * WHAT:  Paginated list of every user on the platform (display-safe fields).
 * WHY:   Uses the shared <DataTable>, which fixes two bugs the hand-rolled
 *        version had: no `placeholderData`, so rows blanked out on every page
 *        change, and no `isFetching` guard on the pager, so a fast double
 *        click could skip a page.
 *        PAGE_SIZE still mirrors PORTAL_PAGE_SIZE in src/trpc/routers/portal.ts
 *        — portal.listUsers returns `{ items, total }` with no `totalPages`,
 *        so the client derives it and the two constants must agree.
 * WHERE: Rendered by /portal/users. Reads trpc.portal.listUsers.
 */

import * as React from "react";

import { trpc } from "@/trpc/react-provider";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/global/data-table";
import { Badge } from "@/components/ui/badge";

/* Mirrors PORTAL_PAGE_SIZE in src/trpc/routers/portal.ts. */
const PAGE_SIZE = 25;

type PortalUserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  banned: boolean;
  createdAt: Date | string;
};

const columns: readonly DataTableColumn<PortalUserRow>[] = [
  {
    id: "user",
    header: "User",
    cell: (user) => (
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {user.name || user.email}
        </p>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
      </div>
    ),
  },
  {
    id: "joined",
    header: "Joined",
    hideOnMobile: true,
    className: "text-muted-foreground whitespace-nowrap",
    cell: (user) => new Date(user.createdAt).toLocaleDateString(),
  },
  {
    id: "status",
    header: "Status",
    className: "text-right",
    cell: (user) => (
      <div className="flex shrink-0 items-center justify-end gap-1">
        {user.banned ? <Badge variant="destructive">Banned</Badge> : null}
        {user.emailVerified ? (
          <Badge variant="secondary">Verified</Badge>
        ) : (
          <Badge variant="outline">Unverified</Badge>
        )}
      </div>
    ),
  },
];

export function PortalUsers() {
  const [page, setPage] = React.useState(1);
  const query = trpc.portal.listUsers.useQuery(
    { page },
    { placeholderData: (previous) => previous, retry: false },
  );

  const data = query.data;

  return (
    <DataTable<PortalUserRow>
      columns={columns}
      rows={data?.items ?? []}
      getRowId={(user) => user.id}
      total={data?.total ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      onPageChange={setPage}
      isLoading={query.isPending && data === undefined}
      isFetching={query.isFetching}
      error={query.error?.message ?? null}
      empty="No users yet."
      countLabel={["user", "users"]}
    />
  );
}
