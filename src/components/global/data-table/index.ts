/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: DataTable barrel, usePaginatedFilters
 *
 * WHAT:  Public surface of the data-table component.
 * WHERE: Imported by list screens as '@/components/global/data-table'.
 */

export { DataTable, type DataTableColumn, type DataTableProps } from './data-table'
export {
  usePaginatedFilters,
  SEARCH_DEBOUNCE_MS,
} from './use-paginated-filters'
export type { UsePaginatedFiltersResult } from './use-paginated-filters'
