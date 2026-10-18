/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: AuditLogsTable, AuditLogRow, auditLogs.list,
 *   FACTORY_PAGINATION, AUDIT_FILTERS_FROM_DATA, getAuditEntityLabel
 *
 * WHAT:  The organization's activity timeline — searchable, filterable,
 *        paginated, with the full record of each entry available on demand.
 * WHY:   FACTORY_PAGINATION: the page/pageSize input is clamped and turned into
 *        skip/take by protectedProcedure({ paginate: true }), so this component
 *        sends a page NUMBER and never computes an offset. `totalPages` comes
 *        back with the rows, which is why "Next" can be disabled correctly on
 *        the last page without a second request.
 *        SEARCH IS DEBOUNCED, the input is not: `filters` echoes every
 *        keystroke so typing never feels laggy, while `query` trails it, so one
 *        request goes out per pause instead of per character across five
 *        `contains` predicates.
 *        PAGE RESETS ON FILTER CHANGE — derived from the filters themselves
 *        rather than an effect. Landing on page 4 of a filter that has one page
 *        renders an empty list that looks like "no results", which is the bug
 *        this avoids; deriving it means there is no ordering to get wrong.
 *        A REAL ERROR IS NOT AN UPGRADE PROMPT. This screen previously showed
 *        "upgrade your plan" for ANY failure, so a 500 read as a billing
 *        problem. The plan case is already handled globally — the procedure
 *        factory throws FEATURE_NOT_AVAILABLE and <UpgradeModalProvider> opens
 *        the upgrade modal from the error itself — and in practice the route
 *        gate in the dashboard layout redirects before this renders at all.
 *        So this only has to be honest about the failure it is actually given.
 * WHERE: Rendered by the audit-logs settings page. Data: auditLogs.list and
 *        auditLogs.filterOptions. Filter contract: src/lib/types/audit.ts.
 */

import * as React from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { ChevronDownIcon } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganizationId } from '@/hooks/use-active-organization'
import {
  AUDIT_FILTER_DEFAULTS,
  getAuditEntityLabel,
  normalizeAuditFilters,
  type AuditLogFilterValues,
} from '@/lib/types/audit'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AuditLogFilters } from './audit-log-filters'

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

type AuditLogEntry = ReturnType<typeof useAuditLogsQuery>['data'] extends
  | { logs: (infer T)[] }
  | undefined
  ? T
  : never

/* Extracted so the row type above can be inferred from the router output rather
 * than restated — the same reason member-types.ts derives its shapes. */
function useAuditLogsQuery(input: {
  organizationId: string
  page: number
  filters: ReturnType<typeof normalizeAuditFilters>
  enabled: boolean
}) {
  return trpc.auditLogs.list.useQuery(
    {
      organizationId: input.organizationId,
      page: input.page,
      pageSize: PAGE_SIZE,
      ...input.filters,
    },
    { enabled: input.enabled, retry: false, placeholderData: (previous) => previous }
  )
}

export function AuditLogsTable() {
  const organizationId = useActiveOrganizationId()
  const [filters, setFilters] = React.useState<AuditLogFilterValues>(AUDIT_FILTER_DEFAULTS)
  /* Trails `filters.search`; the two selects apply immediately because picking
   * an option is a single deliberate act, not a stream of keystrokes. */
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [page, setPage] = React.useState(1)

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [filters.search])

  const applied = React.useMemo(
    () => normalizeAuditFilters({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch]
  )

  /* Any change to what is being filtered invalidates the current page number. */
  const filterKey = JSON.stringify(applied)
  const [lastFilterKey, setLastFilterKey] = React.useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setPage(1)
  }

  const enabled = organizationId !== undefined
  const query = useAuditLogsQuery({
    organizationId: organizationId ?? '',
    page,
    filters: applied,
    enabled,
  })
  const optionsQuery = trpc.auditLogs.filterOptions.useQuery(
    { organizationId: organizationId ?? '' },
    { enabled, retry: false, staleTime: 60_000 }
  )

  if (!organizationId) return null

  if (query.error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {query.error.message || 'Could not load the audit log.'}
        </CardContent>
      </Card>
    )
  }

  const data = query.data
  const isFirstLoad = query.isPending && data === undefined

  return (
    <div className="flex flex-col gap-4">
      <AuditLogFilters
        values={filters}
        onChange={setFilters}
        options={optionsQuery.data ?? { actions: [], entities: [] }}
        isLoading={optionsQuery.isPending}
      />

      {isFirstLoad ? (
        <Card>
          <CardContent className="flex flex-col gap-4 py-2">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : !data || data.logs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {Object.keys(applied).length > 0
              ? 'No activity matches these filters.'
              : 'No activity recorded yet.'}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* `isFetching` dims the list while a filtered/paged request is in
              flight — placeholderData keeps the previous rows on screen, and
              without this the change would look like nothing happened. */}
          <Card className={cn('transition-opacity', query.isFetching && 'opacity-60')}>
            <CardContent className="flex flex-col divide-y p-0">
              {data.logs.map((log) => (
                <AuditLogRow key={log.id} log={log} />
              ))}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              {data.total} {data.total === 1 ? 'entry' : 'entries'} · page {data.page} of{' '}
              {data.totalPages || 1}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || query.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages || query.isFetching}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: AuditLogRow, getAuditEntityLabel, AUDIT_ROW_SUMMARY
 *
 * WHAT:  One entry — who did what to which record, when — expanding to the full
 *        stored record.
 * WHY:   AUDIT_ROW_SUMMARY. `description` is null on every auto-audited row
 *        (the procedure factory records action + entity, not prose), so the
 *        summary is COMPOSED when it is missing rather than printing
 *        `update organizationRoles` at the reader.
 *        Composed in the IMPERATIVE ("Resend invitation"), not the past tense.
 *        Past tense needs irregular verbs — `resend` becomes "resent", not
 *        "resended" — and a generic +ed rule silently produces the wrong word
 *        for every verb a router adds later. The timestamp already establishes
 *        that it happened.
 *        Details are collapsed by default and rendered ONLY when there is
 *        something to show, so the common row stays one line while nothing is
 *        hidden from someone who needs it. Exact timestamps live in the detail
 *        because a forensic reader needs the real time, while the list reads
 *        better relative.
 * WHERE: Rendered by <AuditLogsTable /> from auditLogs.list rows.
 */
function AuditLogRow({ log }: { log: AuditLogEntry }) {
  const [open, setOpen] = React.useState(false)

  const entityLabel = getAuditEntityLabel(log.entity)
  const summary =
    log.description ??
    `${log.action.charAt(0).toUpperCase()}${log.action.slice(1)} ${entityLabel.toLowerCase()}`
  const actor = log.user?.name ?? 'System'
  const createdAt = new Date(log.createdAt)
  const hasDetails = log.entityId !== null || log.metadata !== null

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Avatar className="size-8 shrink-0">
          {log.user?.image ? <AvatarImage src={log.user.image} alt={actor} /> : null}
          <AvatarFallback className="text-xs">{actor.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{summary}</p>
          <p className="truncate text-xs text-muted-foreground">
            {actor} · <time dateTime={createdAt.toISOString()}>
              {formatDistanceToNow(createdAt, { addSuffix: true })}
            </time>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="secondary" className="hidden sm:inline-flex">
            {entityLabel}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {log.action}
          </Badge>
          {hasDetails ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-expanded={open}
              aria-label={open ? 'Hide details' : 'Show details'}
              onClick={() => setOpen((current) => !current)}
            >
              <ChevronDownIcon
                className={cn('size-4 transition-transform', open && 'rotate-180')}
              />
            </Button>
          ) : null}
        </div>
      </div>

      {open && hasDetails ? (
        <dl className="mt-3 grid gap-2 rounded-lg bg-muted/50 p-3 text-xs sm:grid-cols-[7rem_1fr]">
          <dt className="text-muted-foreground">Recorded</dt>
          <dd>{format(createdAt, 'MMMM d, yyyy · HH:mm:ss')}</dd>

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
                <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">
                  {JSON.stringify(log.metadata, null, 2)}
                </pre>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </div>
  )
}
