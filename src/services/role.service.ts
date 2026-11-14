/*

 */

import "server-only";

/**
 * SOURCE OF TRUTH KEYWORDS: processRole, resolveRoleName, roleDisplayName,
 *   getRolePermissionMap, parseRolePermissions
 *
 * WHAT:  Decodes the encoded `role` string the member sheet sends into a
 *        concrete OrganizationRole name, creating the role row on demand.
 * WHY:   The member sheet can send three things: a plain existing role name,
 *        `"<name>|||<JSON perms>"` (a named/admin role to create+assign), or a
 *        bare `"<JSON perms>"` (per-member custom permissions → a stable
 *        `custom-<hash>` role). Centralizing the decode here keeps the routers
 *        thin and matches the funnelmods team behavior. Roles are scoped by
 *        organizationId, so names aren't org-prefixed. Storage is the JSON
 *        statement map read by src/trpc/init.ts.
 * WHERE: Called by invitation.create and member.update; permission helpers used
 *        for the statement map. Pure DB access via the passed `db`.
 */

import type { DbClient } from "@/lib/config/prisma";
import {
  permissionsBeyondAuthority,
  permissionsToStatement,
  statementToPermissions,
} from "@/lib/permissions";
import {
  isOwnerRoleName,
  permissionStringSchema,
  type PermissionGrantAuthority,
} from "@/lib/types";

/**
 * SOURCE OF TRUTH KEYWORDS: RoleEscalationError, UnknownPermissionError,
 *   OWNER_IS_NEVER_ASSIGNABLE, PERMISSIONS_ARE_VALIDATED_NOT_TRUSTED
 *
 * WHAT:  The two ways an encoded role string can be refused.
 * WHY:   Thrown from the decode seam rather than returned, because every caller
 *        reaches it through the membership adapter and a sanitised-but-different
 *        role is worse than a refusal: the caller would believe it assigned what
 *        it asked for. Separate classes so the routers can map one to FORBIDDEN
 *        (an escalation attempt) and the other to BAD_REQUEST (a malformed
 *        payload) without inspecting a message string.
 * WHERE: Thrown by processRole; mapped by member.update and invitation.create.
 */
export class RoleEscalationError extends Error {
  readonly requestedRole: string;

  constructor(requestedRole: string) {
    super("The owner role cannot be assigned.");
    this.name = "RoleEscalationError";
    this.requestedRole = requestedRole;
  }
}

export class UnknownPermissionError extends Error {
  readonly unknownPermissions: readonly string[];

  constructor(unknownPermissions: readonly string[]) {
    super(`Unknown permission: ${unknownPermissions.join(", ")}.`);
    this.name = "UnknownPermissionError";
    this.unknownPermissions = unknownPermissions;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: PermissionEscalationError,
 *   A_GRANT_CANNOT_EXCEED_THE_GRANTER, permissionsBeyondAuthority
 *
 * WHAT:  The refusal when a caller tries to hand out a permission they do not
 *        themselves hold.
 * WHY:   A third class rather than reusing RoleEscalationError, because the two
 *        are different events and only one of them is an attack on a reserved
 *        name. An owner-role request can never be legitimate from any caller;
 *        an over-reaching permission set is legitimate for an owner and refused
 *        only for this caller, so the message has to name what was over-reached
 *        for and the audit trail should be able to tell them apart.
 *
 *        Still a FORBIDDEN rather than a BAD_REQUEST: the payload is
 *        well-formed and every permission in it is real (UnknownPermissionError
 *        already covers the malformed case). What is missing is authority, and
 *        retrying the same payload will not acquire any.
 * WHERE: Thrown by processRole; mapped to FORBIDDEN by src/trpc/role-error.ts.
 */
export class PermissionEscalationError extends Error {
  readonly excessPermissions: readonly string[];

  constructor(excessPermissions: readonly string[]) {
    super(
      `You cannot grant a permission you do not hold yourself: ${excessPermissions.join(", ")}.`,
    );
    this.name = "PermissionEscalationError";
    this.excessPermissions = excessPermissions;
  }
}

/* Normalizes a display name to a stable role key. */
function normalizeRoleName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

/* Stable short hash of a permission set → the `custom-<hash>` role name, so the
 * same custom permission set reuses one role row instead of piling up. */
function customRoleName(permissions: string[]): string {
  const sorted = [...permissions].sort();
  const hash = Buffer.from(sorted.join(",")).toString("base64").slice(0, 8);
  return `custom-${hash}`.toLowerCase();
}

/* Creates the role row if (org, role) doesn't exist yet. */
async function ensureRole(
  db: DbClient,
  organizationId: string,
  role: string,
  permissions: string[],
): Promise<void> {
  const existing = await db.organizationRole.findFirst({
    where: { organizationId, role },
    select: { id: true },
  });
  if (existing) return;
  await db.organizationRole.create({
    data: {
      id: crypto.randomUUID(),
      organizationId,
      role,
      permission: JSON.stringify(permissionsToStatement(permissions)),
    },
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: processRole, A_GRANT_CANNOT_EXCEED_THE_GRANTER,
 *   PermissionGrantAuthority, assertWithinAuthority, EVERY_BRANCH_IS_A_GRANT
 *
 * WHAT:  Resolves the encoded role string to a stored role name (creating the
 *        role when needed) and returns that name for Member.role / Invitation.role.
 *
 * WHY:   `granter` is required, not optional, and that is deliberate:
 *        A_GRANT_CANNOT_EXCEED_THE_GRANTER has to hold on every path into this
 *        function, and an optional parameter defaulting to "unrestricted" would
 *        make the insecure call the easy one to write. A new caller now cannot
 *        compile without stating whose authority the grant is made under.
 *
 *        EVERY_BRANCH_IS_A_GRANT. All THREE decode branches assign power and
 *        all three are checked, including the plain-role-name branch that looks
 *        like a no-op. It is not: naming an EXISTING role hands the target
 *        whatever that row already holds, so a caller with `member:update`
 *        could assign the finance role — `billing:*` and all — to a second
 *        account without ever encoding a permission. That branch was the
 *        quietest of the three and needed the lookup the others do not.
 * WHERE: invitation.create and member.update, both via the membership adapter,
 *        which threads the caller's authority down from `ctx`.
 */
export async function processRole(
  db: DbClient,
  organizationId: string,
  role: string,
  granter: PermissionGrantAuthority,
): Promise<string> {
  /* OWNER_IS_NEVER_ASSIGNABLE. Checked on the RAW input as well as on every
   * resolved name below, so neither `"owner"` nor `"Owner |||[…]"` (which
   * normalizes to it) can reach Member.role. `hasFullAccess` is a role-string
   * comparison, so one unchecked path here is a bypass of every gate. */
  if (isOwnerRoleName(role)) throw new RoleEscalationError(role);

  /* Named role with embedded permissions: "<name>|||<JSON perms>". */
  if (role.includes("|||") && role.includes("[")) {
    const separatorIndex = role.indexOf("|||");
    const namePart = role.slice(0, separatorIndex);
    const permsPart = role.slice(separatorIndex + 3);
    const permissions = parsePermissions(permsPart);
    const roleName = normalizeRoleName(namePart);
    if (isOwnerRoleName(roleName)) throw new RoleEscalationError(role);
    assertWithinAuthority(permissions, granter);
    await ensureRole(db, organizationId, roleName, permissions);
    return roleName;
  }

  /* Bare permission array → per-member custom role. `custom-<hash>` can never
   * collide with an owner name, so only the permissions need checking. */
  if (role.startsWith("[")) {
    const permissions = parsePermissions(role);
    assertWithinAuthority(permissions, granter);
    const roleName = customRoleName(permissions);
    await ensureRole(db, organizationId, roleName, permissions);
    return roleName;
  }

  /* Plain, already-existing role name — a grant of whatever that row holds,
   * so it is checked against the stored permissions rather than waved through.
   * A name with no row carries nothing to over-reach for and resolves as it
   * always did; the member gains no permissions from it. */
  const existing = await db.organizationRole.findFirst({
    where: { organizationId, role },
    select: { permission: true },
  });
  if (existing) {
    assertWithinAuthority(parseRolePermissions(existing.permission), granter);
  }
  return role;
}

/**
 * SOURCE OF TRUTH KEYWORDS: assertWithinAuthority,
 *   A_GRANT_CANNOT_EXCEED_THE_GRANTER, PermissionEscalationError
 *
 * WHAT:  Throws unless every permission being granted is one the granter holds.
 * WHY:   The three call sites above would otherwise each repeat the compare and
 *        the throw, and a fourth branch added later would quietly repeat
 *        neither. Thin on purpose — the comparison itself lives in
 *        `permissionsBeyondAuthority` so it can be unit-tested without a db.
 * WHERE: processRole's three branches.
 */
function assertWithinAuthority(
  requested: readonly string[],
  granter: PermissionGrantAuthority,
): void {
  const excess = permissionsBeyondAuthority(requested, granter);
  if (excess.length > 0) throw new PermissionEscalationError(excess);
}

/**
 * SOURCE OF TRUTH KEYWORDS: parsePermissions,
 *   PERMISSIONS_ARE_VALIDATED_NOT_TRUSTED, permissionStringSchema
 *
 * WHAT:  Decodes the JSON permission array carried inside an encoded role and
 *        REFUSES any entry the registry does not define.
 * WHY:   PERMISSIONS_ARE_VALIDATED_NOT_TRUSTED. This array arrives inside a
 *        free-form string, so it never passed `updateMemberSchema`'s
 *        `permissionStringSchema` validation — the previous version filtered on
 *        `typeof === "string"` only, which let a caller mint a role carrying any
 *        permission it could spell, including ones no plan or preset grants.
 *        Validated against the SAME schema the input surface uses, so there is
 *        one definition of a legal permission.
 *
 *        It throws rather than dropping unknown entries: silently storing a
 *        smaller permission set would tell the caller it saved what it sent.
 * WHERE: processRole's two permission-carrying branches.
 */
function parsePermissions(json: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const candidates = parsed.filter((p): p is string => typeof p === "string");
  const unknown = candidates.filter(
    (p) => !permissionStringSchema.safeParse(p).success,
  );
  if (unknown.length > 0) throw new UnknownPermissionError(unknown);

  return candidates;
}

/**
 * SOURCE OF TRUTH KEYWORDS: roleDisplayName
 *
 * WHAT:  The label shown for a role: '' for auto-generated custom roles (the UI
 *        shows a permission count instead), otherwise the role name.
 * WHERE: member.list enrichment.
 */
export function roleDisplayName(role: string): string {
  if (role === "owner") return "owner";
  if (role.startsWith("custom-")) return "";
  return role;
}

/**
 * SOURCE OF TRUTH KEYWORDS: getRolePermissionMap
 *
 * WHAT:  Loads all OrganizationRole rows for an org into a role → permission
 *        strings map (parsed from the stored JSON statement).
 * WHY:   member.list needs each member's permissions; one query + a map avoids
 *        N lookups.
 * WHERE: member.list.
 */
export async function getRolePermissionMap(
  db: DbClient,
  organizationId: string,
): Promise<Map<string, string[]>> {
  const rows = await db.organizationRole.findMany({
    where: { organizationId },
    select: { role: true, permission: true },
  });
  const map = new Map<string, string[]>();
  for (const row of rows) {
    map.set(row.role, parseRolePermissions(row.permission));
  }
  return map;
}

/**
 * SOURCE OF TRUTH KEYWORDS: parseRolePermissions
 *
 * WHAT:  Parses a stored permission JSON string into a `resource:action[]` list.
 * WHERE: getRolePermissionMap and the organizationRoles list.
 */
export function parseRolePermissions(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return statementToPermissions(parsed as Record<string, string[]>);
    }
  } catch {
    /* corrupt row — no permissions */
  }
  return [];
}
