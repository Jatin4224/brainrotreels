/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: DataTable, DataTableColumn, DataTableProps,
 *   PAGINATION_SLOTS, expandedRow, toolbar slot, PLACEHOLDER_DIMMING,
 *   SERVER_TOTAL_PAGES, usePaginatedFilters
 *
 * WHAT:  The one list surface: owns pagination, loading, empty and error
 *        states, and row expansion. Everything app-specific arrives as a slot.
 * WHY:   Pagination had been hand-rolled twice (audit logs, portal users) and
 *        the two copies had already diverged — portal users has no
 *        placeholderData and no isFetching guard, so its rows blank out on
 *        every page change. One component ends that.
 *
 *        Three contract decisions worth stating, because the obvious API gets
 *        each of them wrong:
 *
 *        `toolbar` is ONE slot holding search AND filters together. Splitting
 *        them looks tidier but breaks the real caller: the audit filter bar
 *        contains its own search input and its Clear button needs the search
 *        value, so a separate `search` prop renders two boxes.
 *
 *        `expandedRow` exists because the audit log's row expands to a full
 *        -width detail panel. A columns-only API cannot express that, and
 *        omitting it would have silently dropped the feature during migration.
 *
 *        SERVER_TOTAL_PAGES: `totalPages` is optional and PREFERRED over the
 *        derived value. `auditLogs.list` computes it server-side (the
 *        procedure factory's paginate contract); deriving from `total/pageSize`
 *        instead would re-implement it on a pageSize the client merely
 *        asserts matches the server's.
 *
 *        PLACEHOLDER_DIMMING: with `placeholderData` the previous rows stay on
 *        screen during a refetch, so without the dim a filter change looks
 *        like nothing happened.
 * WHERE: Used by every list screen. See audit-logs-table.tsx for the reference
 *        caller, including the expanded row.
 */

import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface DataTableColumn<TRow> {
  /** Stable key — also used as the React key for cells. */
  id: string;
  header: React.ReactNode;
  cell: (row: TRow) => React.ReactNode;
  /** Tailwind classes applied to both the header and body cell. */
  className?: string;
  /** Hides the column below `md`. Use for secondary detail, never the label. */
  hideOnMobile?: boolean;
}

export interface DataTableProps<TRow> {
  columns: readonly DataTableColumn<TRow>[];
  rows: readonly TRow[];
  getRowId: (row: TRow) => string;

  total: number;
  page: number;
  pageSize: number;
  /** SERVER_TOTAL_PAGES — preferred over deriving from total/pageSize. */
  totalPages?: number;
  onPageChange: (page: number) => void;

  isLoading?: boolean;
  isFetching?: boolean;
  error?: string | null;

  /** Search and filters together. See the WHY above. */
  toolbar?: React.ReactNode;
  /** Create buttons, bulk actions. Rendered beside the toolbar. */
  actions?: React.ReactNode;
  rowActions?: (row: TRow) => React.ReactNode;
  /** Return null for a row with nothing to expand. */
  expandedRow?: (row: TRow) => React.ReactNode;

  empty?: React.ReactNode;
  /** Shown instead of `empty` when a filter is active — the two are different
   * situations and saying "nothing here yet" under an active filter is wrong. */
  emptyFiltered?: React.ReactNode;
  isFiltered?: boolean;

  /** Singular/plural noun for the count line, e.g. ['entry', 'entries']. */
  countLabel?: readonly [string, string];
  skeletonRows?: number;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

export function DataTable<TRow>({
  columns,
  rows,
  getRowId,
  total,
  page,
  pageSize,
  totalPages,
  onPageChange,
  isLoading = false,
  isFetching = false,
  error = null,
  toolbar,
  actions,
  rowActions,
  expandedRow,
  empty,
  emptyFiltered,
  isFiltered = false,
  countLabel = ["item", "items"],
  skeletonRows = 5,
}: DataTableProps<TRow>) {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const resolvedTotalPages =
    totalPages ?? Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const header = (toolbar !== undefined || actions !== undefined) && (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">{toolbar}</div>
      {actions !== undefined && (
        <div className="flex shrink-0 gap-2">{actions}</div>
      )}
    </div>
  );

  if (error !== null) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        {/* Deliberately a plain card, never an upgrade prompt — a failed query
            is not a plan problem, and conflating them sends the reader to
            billing for a network error. */}
        <Shell>{error}</Shell>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card>
          <CardContent className="flex flex-col gap-4 py-2">
            {Array.from({ length: skeletonRows }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Shell>
          {isFiltered
            ? (emptyFiltered ?? "Nothing matches these filters.")
            : (empty ?? "Nothing here yet.")}
        </Shell>
      </div>
    );
  }

  const columnCount = columns.length + (rowActions !== undefined ? 1 : 0);
  const [singular, plural] = countLabel;

  return (
    <div className="flex flex-col gap-4">
      {header}

      <Card className={cn("transition-opacity", isFetching && "opacity-60")}>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead
                    key={column.id}
                    className={cn(
                      column.hideOnMobile && "hidden md:table-cell",
                      column.className,
                    )}
                  >
                    {column.header}
                  </TableHead>
                ))}
                {rowActions !== undefined && (
                  <TableHead className="w-px">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>

            <TableBody>
              {rows.map((row) => {
                const id = getRowId(row);
                const detail = expandedRow?.(row) ?? null;
                const isOpen = expanded === id;

                return (
                  <React.Fragment key={id}>
                    <TableRow
                      {...(detail !== null
                        ? {
                            "data-expandable": true,
                            onClick: () => setExpanded(isOpen ? null : id),
                            className: "cursor-pointer",
                          }
                        : {})}
                    >
                      {columns.map((column) => (
                        <TableCell
                          key={column.id}
                          className={cn(
                            column.hideOnMobile && "hidden md:table-cell",
                            column.className,
                          )}
                        >
                          {column.cell(row)}
                        </TableCell>
                      ))}
                      {rowActions !== undefined && (
                        /* Stop a row action's click from toggling the row. */
                        <TableCell
                          className="w-px text-right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {rowActions(row)}
                        </TableCell>
                      )}
                    </TableRow>

                    {detail !== null && isOpen && (
                      <TableRow
                        data-slot="data-table-detail"
                        className="hover:bg-transparent"
                      >
                        <TableCell
                          colSpan={columnCount}
                          className="bg-muted/30 p-4"
                        >
                          {detail}
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {total} {total === 1 ? singular : plural} · page {page} of{" "}
          {resolvedTotalPages}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isFetching}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= resolvedTotalPages || isFetching}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
