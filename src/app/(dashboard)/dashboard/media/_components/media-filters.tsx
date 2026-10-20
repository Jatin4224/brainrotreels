/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: MediaFilters, ASSET_TABS, ASSET_FILTER_ALL,
 *   TOOLBAR_IS_ONE_SLOT, ASSET_STATUS_LABEL, kindLabel
 *
 * WHAT:  The media toolbar: the tab row, a search box and a status facet.
 * WHY:   TOOLBAR_IS_ONE_SLOT — <DataTable> takes search AND filters as a single
 *        `toolbar` node, because the Clear button needs the search value (see
 *        the contract note in data-table.tsx). So the tabs live here with the
 *        inputs rather than above the table, which also keeps the whole filter
 *        state in one `usePaginatedFilters` call.
 *        The tabs are rendered from ASSET_TABS, so adding a tab — or adding a
 *        kind to one — is a change in src/lib/types/asset.ts and nothing here.
 * WHERE: Passed as <DataTable toolbar> by MediaTable.
 */

import { SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ASSET_FILTER_ALL,
  ASSET_FILTER_DEFAULTS,
  ASSET_STATUSES,
  ASSET_TABS,
  type AssetFilterValues,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * SOURCE OF TRUTH KEYWORDS: ASSET_KIND_LABEL, kindLabel, ASSET_STATUS_LABEL,
 *   statusLabel
 *
 * WHAT:  Display names for the stored kind and status strings.
 * WHY:   The columns are Strings (STRING_NOT_ENUM), so a row can hold a value
 *        no longer in the union — a kind written by an older release. Both
 *        lookups are widened to `Record<string, string>` and fall back to the
 *        raw value, so an unrecognised one renders as itself rather than as a
 *        blank cell. Exported because the table and the row menu both need
 *        them.
 * WHERE: media-table.tsx.
 */
export const ASSET_KIND_LABEL: Readonly<Record<string, string>> = {
  background: "Background",
  upload: "Upload",
  ai_footage: "AI footage",
  image: "Image",
  audio_tts: "Narration",
  audio_music: "Music",
  sfx: "Sound effect",
  render_output: "Render",
  avatar: "Avatar",
};

export const ASSET_STATUS_LABEL: Readonly<Record<string, string>> = {
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export function kindLabel(kind: string): string {
  return ASSET_KIND_LABEL[kind] ?? kind;
}

export function statusLabel(status: string): string {
  return ASSET_STATUS_LABEL[status] ?? status;
}

export function MediaFilters({
  values,
  onChange,
}: {
  values: AssetFilterValues;
  onChange: (next: AssetFilterValues) => void;
}) {
  const isDirty =
    values.search !== ASSET_FILTER_DEFAULTS.search ||
    values.tab !== ASSET_FILTER_DEFAULTS.tab ||
    values.status !== ASSET_FILTER_DEFAULTS.status;

  return (
    <div className="flex flex-col gap-3">
      {/* A button row rather than <Tabs>: the tab here only changes a filter
          value, and Base UI's Tabs owns panel content and focus management
          this surface has no use for. */}
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label="Media type"
      >
        {ASSET_TABS.map((tab) => (
          <Button
            key={tab.key}
            type="button"
            size="sm"
            variant={values.tab === tab.key ? "secondary" : "ghost"}
            aria-pressed={values.tab === tab.key}
            className={cn(values.tab === tab.key && "font-medium")}
            onClick={() => onChange({ ...values, tab: tab.key })}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={values.search}
            onChange={(event) =>
              onChange({ ...values, search: event.target.value })
            }
            placeholder="Search by file name"
            aria-label="Search media"
            className="pl-8"
          />
        </div>

        <Select
          value={values.status}
          onValueChange={(next) =>
            onChange({
              ...values,
              status: typeof next === "string" ? next : values.status,
            })
          }
        >
          <SelectTrigger className="sm:w-44" aria-label="Filter by status">
            <SelectValue>
              {(value) =>
                typeof value === "string" && value !== ASSET_FILTER_ALL
                  ? statusLabel(value)
                  : "Any status"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ASSET_FILTER_ALL}>Any status</SelectItem>
            {ASSET_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isDirty ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(ASSET_FILTER_DEFAULTS)}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
