/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: permissions, Permission, PermissionGroup,
 *   getPermissionGroups, getAdminPresetPermissions, permissionsToStatement,
 *   statementToPermissions, PermissionStatement, ADMIN_PRESET_EXCLUDED,
 *   PROVIDER_NEUTRAL_RBAC
 *
 * WHAT:  The app's OWN role-based access control vocabulary — every
 *        `resource:action` string, the typed constants, the role-builder groups,
 *        and the conversions between a flat permission list and the stored
 *        statement map.
 * WHY:   PROVIDER_NEUTRAL_RBAC — this layer belongs to the APP, not to any auth
 *        provider, and it lived under src/lib/better-auth/ only for historical
 *        reasons. Nothing here calls Better Auth: every symbol is derived from
 *        the RESOURCES registry, so it is identical whichever provider is
 *        selected. Keeping it provider-neutral is what lets per-tenant dynamic
 *        roles survive a provider swap — hosted providers cap custom roles per
 *        INSTANCE rather than per tenant, so the role builder could never live
 *        in a provider.
 *        Better Auth's access-control objects (`ac`, `roles`) are the ONLY
 *        provider-specific part and stay in src/lib/better-auth/access-control.ts.
 * WHERE: Imported by routers, services, the role-builder UI, and every tenancy
 *        adapter. Derived from src/lib/resources.ts.
 */

import {
  RESOURCE_ENTRIES,
  type Permission as DerivedPermission,
  type PermissionedResourceKey,
  type PermissionAction,
  type ResourceKey,
} from "@/lib/resources";
/* The leaf module, not the `@/lib/types` barrel: the barrel pulls in schemas
 * that have no business in a module every router and adapter imports. */
import type { PermissionGrantAuthority } from "@/lib/types/team";

export type Permission = DerivedPermission;

type CamelToScreamSnake<
  S extends string,
  Acc extends string = "",
> = S extends `${infer Head}${infer Tail}`
  ? Head extends Uppercase<Head>
    ? Head extends Lowercase<Head>
      ? CamelToScreamSnake<Tail, `${Acc}${Head}`>
      : Acc extends ""
        ? CamelToScreamSnake<Tail, Head>
        : CamelToScreamSnake<Tail, `${Acc}_${Head}`>
    : CamelToScreamSnake<Tail, `${Acc}${Uppercase<Head>}`>
  : Acc;

type PermissionConstants = {
  readonly [
    K in {
      [
        R in PermissionedResourceKey
      ]: `${CamelToScreamSnake<R & string>}_${Uppercase<PermissionAction<R> & string>}`;
    }[PermissionedResourceKey]
  ]: Permission;
};

function buildPermissionConstants(): PermissionConstants {
  const constants: Record<string, Permission> = {};
  for (const [resourceKey, def] of RESOURCE_ENTRIES) {
    if (!def.permissions) continue;
    for (const action of def.permissions) {
      const constantName = `${resourceKey.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}_${action.toUpperCase()}`;
      /* `action` widens to `string` because RESOURCE_ENTRIES is typed against
       * the broad `ResourceDefinition` shape (`permissions: readonly string[]`)
       * rather than each resource's `as const` tuple. The cast restores the
       * literal-union type that the runtime value always satisfies, since
       * `Permission` is generated from the same RESOURCES at the type level. */
      constants[constantName] = `${resourceKey}:${action}` as Permission;
    }
  }
  /* The mapped-type narrowing of Record<string, Permission> to the fully-keyed
   * shape is a TS limitation — the loop above visits every required key by
   * construction (CamelToScreamSnake mirrors the runtime regex). */
  return constants as PermissionConstants;
}

/**
 * SOURCE OF TRUTH KEYWORDS: permissions
 *
 * WHAT:  Frozen SCREAM_SNAKE record of every permission constant
 *        (e.g. `permissions.MEMBER_CREATE === 'member:create'`).
 * WHY:   Ergonomic, autocomplete-friendly access — prefer these over
 *        hand-typed `'resource:action'` literals at callsites.
 * WHERE: Imported by routers, services, and UI gating utilities.
 */
export const permissions: PermissionConstants = buildPermissionConstants();

/**
 * SOURCE OF TRUTH KEYWORDS: PermissionGroup
 *
 * WHAT:  One permissioned resource rendered as a role-builder group.
 * WHERE: Produced by getPermissionGroups; rendered by permission-switches.
 */
export interface PermissionGroup {
  resourceKey: ResourceKey;
  resourceName: string;
  description: string;
  permissions: { permission: Permission; action: string }[];
}

/** The JSON map shape stored in OrganizationRole.permission. */
export type PermissionStatement = Record<string, string[]>;

/**
 * SOURCE OF TRUTH KEYWORDS: getPermissionGroups
 *
 * WHAT:  One group per permissioned resource, each listing its `resource:action`
 *        permissions with the bare action label + the resource description.
 * WHERE: Rendered by the permission-switches component in the role builder.
 */
export function getPermissionGroups(): PermissionGroup[] {
  const groups: PermissionGroup[] = [];
  for (const [key, def] of RESOURCE_ENTRIES) {
    if (!def.permissions || def.permissions.length === 0) continue;
    groups.push({
      resourceKey: key,
      resourceName: def.name,
      description: def.description ?? "",
      permissions: def.permissions.map((action) => ({
        /* `${key}:${action}` is a Permission by construction; RESOURCE_ENTRIES
         * is widened to the base ResourceDefinition so TS only sees string. */
        permission: `${key}:${action}` as Permission,
        action,
      })),
    });
  }
  return groups;
}

/**
 * SOURCE OF TRUTH KEYWORDS: getAdminPresetPermissions, ADMIN_PRESET_EXCLUDED
 *
 * WHAT:  The "admin" preset — every declared permission except billing (an
 *        admin manages the team/app but not payments).
 * WHY:   Pre-selected when inviting/creating an admin role. Derived from the
 *        registry so new resources are included automatically.
 * WHERE: member sheet (invite default) + role-command-selector admin preset.
 */
const ADMIN_PRESET_EXCLUDED: readonly string[] = ["billing"];

export function getAdminPresetPermissions(): string[] {
  const perms: string[] = [];
  for (const group of getPermissionGroups()) {
    if (ADMIN_PRESET_EXCLUDED.includes(group.resourceKey)) continue;
    for (const { permission } of group.permissions) perms.push(permission);
  }
  return perms;
}

/**
 * SOURCE OF TRUTH KEYWORDS: permissionsBeyondAuthority,
 *   A_GRANT_CANNOT_EXCEED_THE_GRANTER, PermissionGrantAuthority,
 *   role escalation, hasFullAccess
 *
 * WHAT:  Which of `requested` the granter does not themselves hold — empty when
 *        the grant is legitimate.
 *
 * WHY:   A_GRANT_CANNOT_EXCEED_THE_GRANTER, written once, here, because it is
 *        the single invariant three separate write surfaces were missing
 *        (organizationRoles.create, organizationRoles.update, and processRole's
 *        three decode branches). A copy per surface is how the original gap
 *        came about — the one nobody updated is the one that leaks.
 *
 *        Returns the offending list rather than a boolean so the refusal can
 *        name what was over-reached for. A caller told only "forbidden" files a
 *        bug report; a caller told "you cannot grant billing:read" fixes their
 *        own payload.
 *
 *        Pure and registry-free on purpose: it compares two sets and nothing
 *        else, so it is cheap enough to call on every role write and testable
 *        without a database. Validity of each string is a SEPARATE question,
 *        already answered by `permissionStringSchema`
 *        (PERMISSIONS_ARE_VALIDATED_NOT_TRUSTED) — a permission that is unknown
 *        AND over-reaching should be reported as unknown first, so this does
 *        not re-check the registry.
 * WHERE: organizationRoles.create / .update, and processRole's three branches.
 */
export function permissionsBeyondAuthority(
  requested: readonly string[],
  granter: PermissionGrantAuthority,
): string[] {
  /* An owner holds everything, and the factory hands them an empty permission
   * array as a deliberate shortcut — so this has to come first or ownership
   * would read as holding nothing. */
  if (granter.hasFullAccess) return [];

  const held = new Set(granter.permissions);
  return [...new Set(requested)].filter((perm) => !held.has(perm));
}

/**
 * SOURCE OF TRUTH KEYWORDS: permissionsToStatement
 *
 * WHAT:  Folds a flat `Permission[]` into a `{ resource: [actions] }` map for
 *        storage on OrganizationRole.permission.
 * WHERE: Called by organizationRoles.create / .update before persisting.
 */
export function permissionsToStatement(
  perms: readonly string[],
): PermissionStatement {
  const statement: PermissionStatement = {};
  for (const perm of perms) {
    const [resource, action] = perm.split(":");
    if (!resource || !action) continue;
    const existing = statement[resource];
    if (existing) {
      if (!existing.includes(action)) existing.push(action);
    } else {
      statement[resource] = [action];
    }
  }
  return statement;
}

/**
 * SOURCE OF TRUTH KEYWORDS: statementToPermissions
 *
 * WHAT:  Flattens a stored statement map back into permission strings.
 * WHY:   Lets the role-edit UI pre-tick the toggles for an existing role; the
 *        toggles compare against the typed permission keys from
 *        getPermissionGroups, and every Permission is a string so the compare
 *        is sound without a cast.
 * WHERE: Called when loading a role into the builder.
 */
export function statementToPermissions(
  statement: PermissionStatement,
): string[] {
  const out: string[] = [];
  for (const [resource, actions] of Object.entries(statement)) {
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      out.push(`${resource}:${action}`);
    }
  }
  return out;
}
