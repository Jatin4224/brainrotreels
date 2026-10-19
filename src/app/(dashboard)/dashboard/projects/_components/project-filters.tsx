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
 * SOURCE OF TRUTH KEYWORDS: ProjectFilters, PROJECT_KIND_LABEL,
 *   PROJECT_STATUS_LABEL, PROJECT_FILTER_ALL, toolbar slot
 *
 * WHAT:  The projects toolbar — search, a kind facet, a status facet, and a
 *        Clear button.
 * WHY:   One component for all four controls because <DataTable>'s `toolbar` is
 *        a single slot, and deliberately so: Clear needs the search value, so
 *        splitting search out would render two boxes. Same shape as
 *        AuditLogFilters, which is the reference caller.
 *        The labels live here, not in lib/types, because they are display copy
 *        — the kinds and statuses themselves are the shared union.
 * WHERE: Passed to <DataTable toolbar> by ProjectsTable.
 */

import { SearchIcon, XIcon } from 'lucide-react'

import {
  PROJECT_FILTER_ALL,
  PROJECT_KINDS,
  PROJECT_SEARCH_MAX,
  PROJECT_STATUSES,
  type ProjectFilterValues,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * SOURCE OF TRUTH KEYWORDS: PROJECT_KIND_LABEL, PROJECT_STATUS_LABEL
 *
 * WHAT:  What each stored value is called on screen.
 * WHY:   Full Records over the unions, so adding a format or a lifecycle state
 *        fails to compile here until it has copy — rather than showing a
 *        customer the raw `reddit-story`.
 * WHERE: This toolbar and the table's badges.
 */
export const PROJECT_KIND_LABEL: Readonly<Record<(typeof PROJECT_KINDS)[number], string>> = {
  'reddit-story': 'Reddit story',
  voiceover: 'Voiceover',
  quiz: 'Quiz',
  motion: 'Motion graphics',
}

export const PROJECT_STATUS_LABEL: Readonly<Record<(typeof PROJECT_STATUSES)[number], string>> = {
  draft: 'Draft',
  generating: 'Generating',
  ready: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

/* Both columns read a Prisma `String`, so a row can hold a value that is no
 * longer in the union — a format we retired, a status an older release wrote.
 * The lookups are widened to Record<string, string> so such a value shows AS
 * ITSELF rather than being silently relabelled as some other format, which is
 * what a `find(...) ?? 'voiceover'` fallback would do. */
const KIND_LABEL_LOOKUP: Readonly<Record<string, string>> = PROJECT_KIND_LABEL
const STATUS_LABEL_LOOKUP: Readonly<Record<string, string>> = PROJECT_STATUS_LABEL

export function kindLabel(value: string): string {
  return KIND_LABEL_LOOKUP[value] ?? value
}

export function statusLabel(value: string): string {
  return STATUS_LABEL_LOOKUP[value] ?? value
}

export interface ProjectFiltersProps {
  values: ProjectFilterValues
  onChange: (values: ProjectFilterValues) => void
}

export function ProjectFilters({ values, onChange }: ProjectFiltersProps) {
  const isFiltered =
    values.search.trim() !== '' ||
    values.kind !== PROJECT_FILTER_ALL ||
    values.status !== PROJECT_FILTER_ALL

  const set = (patch: Partial<ProjectFilterValues>) => onChange({ ...values, ...patch })

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={values.search}
          onChange={(event) => set({ search: event.target.value })}
          maxLength={PROJECT_SEARCH_MAX}
          placeholder="Search projects by title"
          aria-label="Search projects"
          className="pl-9"
        />
      </div>

      {/* Base UI hands back null when a selection is cleared, which is the same
          intent as picking "all" — so it collapses to the sentinel. */}
      <Select value={values.kind} onValueChange={(kind) => set({ kind: kind ?? PROJECT_FILTER_ALL })}>
        <SelectTrigger className="sm:w-44" aria-label="Filter by format">
          <SelectValue>
            {(value) =>
              typeof value !== 'string' || value === PROJECT_FILTER_ALL
                ? 'All formats'
                : kindLabel(value)
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PROJECT_FILTER_ALL}>All formats</SelectItem>
          {PROJECT_KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {PROJECT_KIND_LABEL[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={values.status}
        onValueChange={(status) => set({ status: status ?? PROJECT_FILTER_ALL })}
      >
        <SelectTrigger className="sm:w-40" aria-label="Filter by status">
          <SelectValue>
            {(value) =>
              typeof value !== 'string' || value === PROJECT_FILTER_ALL
                ? 'All statuses'
                : statusLabel(value)
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PROJECT_FILTER_ALL}>All statuses</SelectItem>
          {PROJECT_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {PROJECT_STATUS_LABEL[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isFiltered ? (
        <Button
          variant="ghost"
          onClick={() =>
            onChange({ search: '', kind: PROJECT_FILTER_ALL, status: PROJECT_FILTER_ALL })
          }
        >
          <XIcon className="size-4" />
          Clear
        </Button>
      ) : null}
    </div>
  )
}
