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
