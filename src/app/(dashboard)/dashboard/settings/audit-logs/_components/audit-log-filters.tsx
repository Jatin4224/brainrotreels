/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: AuditLogFilters, AuditLogFilterValues,
 *   AUDIT_FILTER_ALL, AUDIT_FILTERS_FROM_DATA, getAuditEntityLabel
 *
 * WHAT:  The audit-log toolbar — free-text search plus an action and an entity
 *        select, and a Clear affordance once anything is set.
 * WHY:   Fully CONTROLLED: it owns no state, so the table stays the single
 *        holder of "what is being queried" and cannot disagree with the rows
 *        on screen. Debouncing lives in the table for the same reason — the
 *        input must echo every keystroke immediately, while the query must not.
 *        AUDIT_FILTERS_FROM_DATA: `options` are the tenant's own distinct
 *        values, so a select never offers a filter that matches nothing. While
 *        they load, the selects render with only the "all" entry rather than
 *        disappearing — a toolbar that changes shape after a beat is worse than
 *        one briefly short of choices.
 *        Entity values are raw keys (`organizationRoles`) and are labelled
 *        through the registry, so a renamed resource renames itself here.
 *        Clear is shown only when something IS set: a permanently visible reset
 *        on an unfiltered list is a control that does nothing.
 * WHERE: Rendered by <AuditLogsTable />. Values/schema live in
 *        src/lib/types/audit.ts; options come from auditLogs.filterOptions.
 */

import { SearchIcon, XIcon } from "lucide-react";

/* Imported from the module rather than the @/lib/types barrel: the barrel is a
 * high-traffic shared file, and a direct path keeps this feature's imports from
 * depending on unrelated edits landing there. */
import {
  AUDIT_FILTER_ALL,
  AUDIT_SEARCH_MAX,
  getAuditEntityLabel,
  type AuditLogFilterValues,
} from "@/lib/types/audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface AuditLogFiltersProps {
  values: AuditLogFilterValues;
  onChange: (values: AuditLogFilterValues) => void;
  options: { actions: string[]; entities: string[] };
  isLoading: boolean;
}

/* Verbs are stored lowercase (`create`, `resend`); only the casing changes for
 * display so the option text always matches what is actually recorded. */
const actionLabel = (action: string): string =>
  action.charAt(0).toUpperCase() + action.slice(1);

/* Base UI renders the raw VALUE in the trigger unless told otherwise, which
 * showed a literal "all". These map a value back to the same text its option
 * carries, so the trigger and the open list never read differently. */
const triggerLabel = (
  value: unknown,
  allLabel: string,
  format: (raw: string) => string,
) =>
  typeof value !== "string" || value === AUDIT_FILTER_ALL
    ? allLabel
    : format(value);

export function AuditLogFilters({
  values,
  onChange,
  options,
  isLoading,
}: AuditLogFiltersProps) {
  const isFiltered =
    values.search.trim() !== "" ||
    values.action !== AUDIT_FILTER_ALL ||
    values.entity !== AUDIT_FILTER_ALL;

  const set = (patch: Partial<AuditLogFilterValues>) =>
    onChange({ ...values, ...patch });

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={values.search}
          onChange={(event) => set({ search: event.target.value })}
          maxLength={AUDIT_SEARCH_MAX}
          placeholder="Search activity, people, or IDs"
          aria-label="Search audit log"
          className="pl-9"
        />
      </div>

      {/* Base UI hands back null when a selection is cleared; that is the same
          intent as picking "all", so it collapses to the sentinel rather than
          leaving the control with no value. */}
      <Select
        value={values.action}
        onValueChange={(action) => set({ action: action ?? AUDIT_FILTER_ALL })}
      >
        <SelectTrigger
          className="sm:w-40"
          aria-label="Filter by action"
          disabled={isLoading}
        >
          <SelectValue>
            {(value) => triggerLabel(value, "All actions", actionLabel)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUDIT_FILTER_ALL}>All actions</SelectItem>
          {options.actions.map((action) => (
            <SelectItem key={action} value={action}>
              {actionLabel(action)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={values.entity}
        onValueChange={(entity) => set({ entity: entity ?? AUDIT_FILTER_ALL })}
      >
        <SelectTrigger
          className="sm:w-44"
          aria-label="Filter by type"
          disabled={isLoading}
        >
          <SelectValue>
            {(value) => triggerLabel(value, "All types", getAuditEntityLabel)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUDIT_FILTER_ALL}>All types</SelectItem>
          {options.entities.map((entity) => (
            <SelectItem key={entity} value={entity}>
              {getAuditEntityLabel(entity)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isFiltered ? (
        <Button
          variant="ghost"
          onClick={() =>
            onChange({
              search: "",
              action: AUDIT_FILTER_ALL,
              entity: AUDIT_FILTER_ALL,
            })
          }
        >
          <XIcon className="size-4" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
