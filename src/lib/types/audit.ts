/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: auditLogFilterSchema, AuditLogFilterValues,
 *   AUDIT_FILTER_ALL, AUDIT_SEARCH_MAX, normalizeAuditFilters,
 *   getAuditEntityLabel, AUDIT_ENTITY_LABEL
 *
 * WHAT:  The contract for the audit-log toolbar — free-text search plus an
 *        action and an entity filter — and the normalizer that turns those UI
 *        values into router input.
 * WHY:   The toolbar takes user input, so it gets a schema like every other
 *        input surface in the app (CLAUDE.md rule 5). `search` is capped
 *        because it reaches five `contains` predicates across an unbounded
 *        table — an unbounded string there is a scan the tenant can trigger at
 *        will, and no real query needs 200+ characters.
 *        AUDIT_FILTER_ALL exists because a Select cannot hold an empty-string
 *        value (Base UI treats `''` as "nothing selected" and the placeholder
 *        returns), so "no filter" needs a real sentinel. Stripping it back to
 *        `undefined` happens in ONE place — normalizeAuditFilters — so the
 *        sentinel never leaks into a query and no call site has to remember.
 *        Blank search collapses to undefined for the same reason: the service
 *        treats a falsy `search` as "no search", and sending `''` would build a
 *        pointless OR across five columns.
 * WHERE: Consumed by the audit-log toolbar and table under
 *        src/app/(dashboard)/dashboard/settings/audit-logs/_components.
 *        Router input lives in src/trpc/routers/audit-logs.ts.
 */

import { z } from "zod";

import { RESOURCES, isResourceKey } from "@/lib/resources";

/** Select sentinel meaning "don't filter on this field". */
export const AUDIT_FILTER_ALL = "all";

export const AUDIT_SEARCH_MAX = 200;

export const auditLogFilterSchema = z.object({
  search: z.string().trim().max(AUDIT_SEARCH_MAX),
  /* Free strings, not enums: the options are read from the tenant's own rows
   * (AUDIT_FILTERS_FROM_DATA), so no fixed union can describe them. */
  action: z.string(),
  entity: z.string(),
});

export type AuditLogFilterValues = z.infer<typeof auditLogFilterSchema>;

export const AUDIT_FILTER_DEFAULTS: AuditLogFilterValues = {
  search: "",
  action: AUDIT_FILTER_ALL,
  entity: AUDIT_FILTER_ALL,
};

/**
 * SOURCE OF TRUTH KEYWORDS: normalizeAuditFilters
 *
 * WHAT:  Toolbar values → the optional fields auditLogs.list actually accepts.
 * WHY:   One place converts "all"/blank into `undefined`, so the sentinel is a
 *        UI concern that never reaches the router or the `where` clause.
 *        Returns exact-optional fields (keys omitted rather than set to
 *        undefined) because `exactOptionalPropertyTypes` is on.
 * WHERE: The audit-log table, when building its query input.
 */
export function normalizeAuditFilters(values: AuditLogFilterValues): {
  search?: string;
  action?: string;
  entity?: string;
} {
  const parsed = auditLogFilterSchema.parse(values);
  const search = parsed.search.trim();
  const action = parsed.action === AUDIT_FILTER_ALL ? "" : parsed.action;
  const entity = parsed.entity === AUDIT_FILTER_ALL ? "" : parsed.entity;

  return {
    ...(search ? { search } : {}),
    ...(action ? { action } : {}),
    ...(entity ? { entity } : {}),
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: getAuditEntityLabel, AUDIT_ENTITY_LABEL,
 *   isResourceKey, RESOURCES
 *
 * WHAT:  The human name for the entity recorded on an audit row.
 * WHY:   AUDIT_ENTITY_LABEL. Audit rows store the raw key the procedure path
 *        produced — `organizationRoles`, not "Roles" — and printing that
 *        verbatim gives a timeline written in code identifiers. When the entity
 *        IS a registry resource, its `name` is the reviewed, env-aware label the
 *        pricing cards and gates already use, so reading it here means renaming
 *        a resource renames it in the audit log too, with no second list.
 *        The fallback is deliberate, not a throw: audit rows OUTLIVE the
 *        registry. `organization`, `subscription` and `session` are written by
 *        the auth and billing layers and are not resources at all, and a row
 *        recorded before a resource was deleted must still render. Splitting
 *        camelCase turns any such key into something readable rather than
 *        blanking the row or crashing the page on old history.
 * WHERE: The audit-log toolbar and timeline under
 *        src/app/(dashboard)/dashboard/settings/audit-logs/_components.
 */
export function getAuditEntityLabel(entity: string): string {
  if (isResourceKey(entity)) return RESOURCES[entity].name;
  const spaced = entity
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
