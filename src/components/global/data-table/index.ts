/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: DataTable barrel, usePaginatedFilters
 *
 * WHAT:  Public surface of the data-table component.
 * WHERE: Imported by list screens as '@/components/global/data-table'.
 */

export {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
} from "./data-table";
export {
  usePaginatedFilters,
  SEARCH_DEBOUNCE_MS,
} from "./use-paginated-filters";
export type { UsePaginatedFiltersResult } from "./use-paginated-filters";
