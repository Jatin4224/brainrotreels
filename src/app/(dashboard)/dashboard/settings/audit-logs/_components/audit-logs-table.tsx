/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AuditLogsTable, DataTable, usePaginatedFilters,
 *   AUDIT_ROW_SUMMARY, SERVER_TOTAL_PAGES, audit log detail
 *
 * WHAT:  The organization's audit log: filterable, paginated, each row
 *        expanding to the full stored record.
 * WHY:   Pagination, debouncing, the page reset, loading/empty/error states
 *        and row expansion all live in <DataTable> and usePaginatedFilters
 *        now — this file is the audit-specific parts only.
 *        SERVER_TOTAL_PAGES: auditLogs.list returns `totalPages` from the
 *        procedure factory's paginate contract, so it is passed straight
 *        through rather than re-derived from total/pageSize.
 *        The filter bar goes in the `toolbar` slot as ONE unit because it owns
 *        its own search input and its Clear button needs that value.
 * WHERE: Rendered by /dashboard/settings/audit-logs.
 */

import { format, formatDistanceToNow } from "date-fns";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/trpc/routers/_app";
import { trpc } from "@/trpc/react-provider";
import { useActiveOrganizationId } from "@/hooks/use-active-organization";
import {
  AUDIT_FILTER_DEFAULTS,
  normalizeAuditFilters,
  type AuditLogFilterValues,
} from "@/lib/types/audit";
import { getAuditEntityLabel } from "@/lib/resources";
import {
  DataTable,
  type DataTableColumn,
  usePaginatedFilters,
} from "@/components/global/data-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AuditLogFilters } from "./audit-log-filters";

const PAGE_SIZE = 20;

/* Derived from the router output so the row shape follows the server — the
 * pattern docs/08-types-and-grep.md prescribes for client code mirroring a
 * server contract. */
type AuditLogEntry =
  inferRouterOutputs<AppRouter>["auditLogs"]["list"]["logs"][number];

/* AUDIT_ROW_SUMMARY — `description` is null on every auto-audited row (the
 * procedure factory records action + entity, not prose), so the summary is
 * COMPOSED when missing rather than printing `update organizationRoles` at the
 * reader. Imperative, not past tense: past tense needs irregular verbs
 * ("resend" → "resent", not "resended") and the timestamp already establishes
 * that it happened. */
function summarize(log: AuditLogEntry): string {
  if (log.description !== null) return log.description;
  const entityLabel = getAuditEntityLabel(log.entity).toLowerCase();
  return `${log.action.charAt(0).toUpperCase()}${log.action.slice(1)} ${entityLabel}`;
}

const columns: readonly DataTableColumn<AuditLogEntry>[] = [
  {
    id: "event",
    header: "Event",
    cell: (log) => {
      const actor = log.user?.name ?? "System";
      const createdAt = new Date(log.createdAt);
      return (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-8 shrink-0">
            {log.user?.image ? (
              <AvatarImage src={log.user.image} alt={actor} />
            ) : null}
            <AvatarFallback className="text-xs">
              {actor.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm">{summarize(log)}</p>
            <p className="truncate text-xs text-muted-foreground">
              {actor} ·{" "}
              <time dateTime={createdAt.toISOString()}>
                {formatDistanceToNow(createdAt, { addSuffix: true })}
              </time>
            </p>
          </div>
        </div>
      );
    },
  },
  {
    id: "entity",
    header: "Record",
    hideOnMobile: true,
    className: "w-px",
    cell: (log) => (
      <Badge variant="secondary">{getAuditEntityLabel(log.entity)}</Badge>
    ),
  },
  {
    id: "action",
    header: "Action",
    className: "w-px text-right",
    cell: (log) => (
      <Badge variant="outline" className="capitalize">
        {log.action}
      </Badge>
    ),
  },
];

/* Exact timestamps live here, not in the row: a forensic reader needs the real
 * time, while the list reads better relative. */
function AuditLogDetail({ log }: { log: AuditLogEntry }) {
  const createdAt = new Date(log.createdAt);

  return (
    <dl className="grid gap-2 text-xs sm:grid-cols-[7rem_1fr]">
      <dt className="text-muted-foreground">Recorded</dt>
      <dd>{format(createdAt, "MMMM d, yyyy · HH:mm:ss")}</dd>

      {log.entityId ? (
        <>
          <dt className="text-muted-foreground">Record ID</dt>
          <dd className="truncate font-mono">{log.entityId}</dd>
        </>
      ) : null}

      {log.metadata ? (
        <>
          <dt className="text-muted-foreground">Changes</dt>
          {/* Whatever the router stored, shown verbatim — the shape is
              per-entity, so any prettifier here would be a second schema to
              maintain and would hide fields it did not anticipate. */}
          <dd>
            <pre className="overflow-x-auto whitespace-pre-wrap wrap-break-word font-mono">
              {JSON.stringify(log.metadata, null, 2)}
            </pre>
          </dd>
        </>
      ) : null}
    </dl>
  );
}

export function AuditLogsTable() {
  const organizationId = useActiveOrganizationId();

  const { filters, setFilters, applied, page, setPage, isFiltered } =
    usePaginatedFilters<AuditLogFilterValues>({
      defaults: AUDIT_FILTER_DEFAULTS,
      searchKey: "search",
      normalize: normalizeAuditFilters,
    });

  const enabled = organizationId !== undefined;

  const query = trpc.auditLogs.list.useQuery(
    {
      organizationId: organizationId ?? "",
      page,
      pageSize: PAGE_SIZE,
      ...applied,
    },
    { enabled, retry: false, placeholderData: (previous) => previous },
  );

  const optionsQuery = trpc.auditLogs.filterOptions.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled, retry: false, staleTime: 60_000 },
  );

  if (!organizationId) return null;

  const data = query.data;

  return (
    <DataTable<AuditLogEntry>
      columns={columns}
      rows={data?.logs ?? []}
      getRowId={(log) => log.id}
      total={data?.total ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      {...(data?.totalPages !== undefined
        ? { totalPages: data.totalPages }
        : {})}
      onPageChange={setPage}
      isLoading={query.isPending && data === undefined}
      isFetching={query.isFetching}
      error={query.error?.message ?? null}
      isFiltered={isFiltered}
      toolbar={
        <AuditLogFilters
          values={filters}
          onChange={setFilters}
          options={optionsQuery.data ?? { actions: [], entities: [] }}
          isLoading={optionsQuery.isPending}
        />
      }
      expandedRow={(log) =>
        log.entityId !== null || log.metadata !== null ? (
          <AuditLogDetail log={log} />
        ) : null
      }
      empty="No activity recorded yet."
      emptyFiltered="No activity matches these filters."
      countLabel={["entry", "entries"]}
    />
  );
}
