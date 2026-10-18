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
 * SOURCE OF TRUTH KEYWORDS: usePaginatedFilters, SEARCH_DEBOUNCE_MS,
 *   PAGE_RESET_DURING_RENDER, debounced search, filterKey
 *
 * WHAT:  Holds filter state, debounces the free-text part, and resets the page
 *        whenever what is being filtered changes.
 * WHY:   PAGE_RESET_DURING_RENDER. The reset is derived during render by
 *        comparing a serialised filter key, NOT in an effect. An effect would
 *        let one request fire for "page 4 of the new filter" before the reset
 *        lands — the user sees an empty page, then the right one. Comparing
 *        during render means the component never commits the stale pairing.
 *        Only the free-text field is debounced. Selects apply immediately
 *        because picking an option is one deliberate act, not a keystroke
 *        stream, and delaying it feels broken.
 * WHERE: Used by list screens alongside <DataTable>.
 */

import * as React from 'react'

export const SEARCH_DEBOUNCE_MS = 300

export interface UsePaginatedFiltersResult<TFilters, TApplied> {
  /** Live values — bind the inputs to these. */
  filters: TFilters
  setFilters: (next: TFilters) => void
  /** Debounced and normalised — send these to the server. */
  applied: TApplied
  page: number
  setPage: (page: number) => void
  /** True when any filter is active, for the empty-state branch. */
  isFiltered: boolean
}

/**
 * Two type parameters, not one: `normalize` narrows a fully-populated filter
 * object down to only the keys that differ from their defaults, so the applied
 * shape is a PARTIAL of the live one. Typing both as `TFilters` would force
 * every normalizer to return empty strings for untouched fields, which is
 * exactly what the server must not receive — a blank `search` is not a search.
 */
export function usePaginatedFilters<
  TFilters extends Record<string, unknown>,
  TApplied extends Record<string, unknown> = Partial<TFilters>,
>(options: {
  defaults: TFilters
  /** Which key is free text. Omit when there is no search field. */
  searchKey?: keyof TFilters
  /** Strips defaults/empties so `isFiltered` and the query stay honest. */
  normalize: (filters: TFilters) => TApplied
  debounceMs?: number
}): UsePaginatedFiltersResult<TFilters, TApplied> {
  const { defaults, searchKey, normalize, debounceMs = SEARCH_DEBOUNCE_MS } = options

  const [filters, setFilters] = React.useState<TFilters>(defaults)
  const [page, setPage] = React.useState(1)

  const rawSearch = searchKey !== undefined ? filters[searchKey] : undefined
  const [debouncedSearch, setDebouncedSearch] = React.useState(rawSearch)

  React.useEffect(() => {
    if (searchKey === undefined) return
    const timer = setTimeout(() => setDebouncedSearch(rawSearch), debounceMs)
    return () => clearTimeout(timer)
  }, [rawSearch, searchKey, debounceMs])

  const applied = React.useMemo(() => {
    if (searchKey === undefined) return normalize(filters)
    /* Annotated rather than asserted: the spread already satisfies TFilters,
     * and an assertion here would be the kind that hides a real mismatch the
     * day the filter shape changes. */
    const merged: TFilters = { ...filters, [searchKey]: debouncedSearch }
    return normalize(merged)
  }, [filters, debouncedSearch, searchKey, normalize])

  /* PAGE_RESET_DURING_RENDER — see the WHY above. */
  const filterKey = JSON.stringify(applied)
  const [lastFilterKey, setLastFilterKey] = React.useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setPage(1)
  }

  return {
    filters,
    setFilters,
    applied,
    page,
    setPage,
    isFiltered: Object.keys(applied).length > 0,
  }
}
