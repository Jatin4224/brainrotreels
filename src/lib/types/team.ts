/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: inviteMemberSchema, updateMemberSchema,
 *   removeMemberSchema, cancelInvitationSchema, resendInvitationSchema,
 *   createRoleSchema, updateRoleSchema, deleteRoleSchema, roleNameSchema,
 *   permissionStringSchema, RESERVED_ROLE_NAMES, VALID_PERMISSION_STRINGS
 *
 * WHAT:  Zod schemas + inferred types for every member / invitation / custom-
 *        role input across the team-management routers and UI.
 * WHY:   One contract per input surface (CLAUDE.md). Permissions validate
 *        against the live RESOURCES-derived set so a role can never persist a
 *        permission the app doesn't define; `owner` is reserved so a custom
 *        role can't shadow the static owner role.
 * WHERE: Imported by src/trpc/routers/{member,invitation,organization-roles}.ts
 *        and the team UI. Re-exported via src/lib/types.
 */

import { z } from "zod";
import { RESOURCE_ENTRIES } from "@/lib/resources";

/* Built once from the registry — the set of every legal `resource:action`. */
const VALID_PERMISSION_SET = new Set<string>();
for (const [key, def] of RESOURCE_ENTRIES) {
  if (!def.permissions) continue;
  for (const action of def.permissions)
    VALID_PERMISSION_SET.add(`${key}:${action}`);
}

export const VALID_PERMISSION_STRINGS: readonly string[] = [
  ...VALID_PERMISSION_SET,
];

/** Role names the role builder must never create — owner is static. */
export const RESERVED_ROLE_NAMES: readonly string[] = ["owner"];

/**
 * SOURCE OF TRUTH KEYWORDS: OWNER_ROLE_NAMES, isOwnerRoleName,
 *   OWNER_IS_NEVER_ASSIGNABLE, role escalation, hasFullAccess
 *
 * WHAT:  Every role name that confers organization ownership, and the predicate
 *        that recognises one.
 * WHY:   `hasFullAccess` is `role === "owner"`, which short-circuits EVERY
 *        permission gate in the procedure factory — so "is this an owner role"
 *        is a security decision, and a second copy of the list is a second
 *        answer. It lived in two places before (the member router's local
 *        `OWNER_ROLES` and the membership adapter's), which is exactly how the
 *        role decoder came to accept `"owner"` from untrusted input.
 *
 *        OWNER_IS_NEVER_ASSIGNABLE: ownership is granted only where an
 *        organization is created (organization.service, portal.service write
 *        `role: "owner"` directly). Nothing reachable from a request may assign
 *        it, so `processRole` refuses it rather than this list gating on a
 *        caller's permissions.
 * WHERE: processRole (role.service) refuses these; the member router uses them
 *        to protect an owner's row from edit and removal.
 */
export const OWNER_ROLE_NAMES: readonly string[] = ["owner", "client-owner"];

export function isOwnerRoleName(role: string): boolean {
  return OWNER_ROLE_NAMES.includes(role.trim().toLowerCase());
}

export const permissionStringSchema = z
  .string()
  .refine((value) => VALID_PERMISSION_SET.has(value), "Unknown permission.");

export const roleNameSchema = z
  .string()
  .trim()
  .min(2, "Role name must be at least 2 characters.")
  .max(40, "Role name is too long.")
  .regex(
    /^[a-zA-Z0-9 _-]+$/,
    "Use letters, numbers, spaces, hyphens or underscores.",
  )
  .refine(
    (value) => !RESERVED_ROLE_NAMES.includes(value.toLowerCase()),
    "That role name is reserved.",
  );

const organizationIdSchema = z.string().min(1, "Organization ID is required.");

/* The member sheet sends an ENCODED role: a plain role name, `<name>|||<JSON
 * perms>` (named/admin role), or a bare `<JSON perms>` array (custom per-member
 * permissions). processRole (role.service) decodes it — so this is a loose
 * string, not roleNameSchema. */
export const encodedRoleSchema = z.string().min(1, "A role is required.");

export const inviteMemberSchema = z.object({
  organizationId: organizationIdSchema,
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Enter a valid email."),
  role: encodedRoleSchema,
});

/* THE_ENCODED_ROLE_IS_AUTHORITATIVE. The member sheet sends the selected
 * permissions twice: once inside `role` (the encoding processRole decodes) and
 * once here. The server reads them from `role`, so this field is accepted for
 * the sheet's convenience and is NOT the thing that gets stored — which is why
 * processRole validates the decoded array against `permissionStringSchema`
 * itself (PERMISSIONS_ARE_VALIDATED_NOT_TRUSTED) rather than relying on this
 * line. Validating here and trusting the string was the gap. */
export const updateMemberSchema = z.object({
  organizationId: organizationIdSchema,
  memberId: z.string().min(1),
  role: encodedRoleSchema,
  permissions: z.array(permissionStringSchema),
});

export const removeMemberSchema = z.object({
  organizationId: organizationIdSchema,
  memberId: z.string().min(1),
});

export const cancelInvitationSchema = z.object({
  organizationId: organizationIdSchema,
  invitationId: z.string().min(1),
});

export const resendInvitationSchema = z.object({
  organizationId: organizationIdSchema,
  invitationId: z.string().min(1),
});

export const createRoleSchema = z.object({
  organizationId: organizationIdSchema,
  roleName: roleNameSchema,
  permissions: z
    .array(permissionStringSchema)
    .min(1, "Select at least one permission."),
});

/* Role edit/delete are keyed by the OrganizationRole row id. */
export const updateRoleSchema = z.object({
  organizationId: organizationIdSchema,
  roleId: z.string().min(1),
  permissions: z
    .array(permissionStringSchema)
    .min(1, "Select at least one permission."),
});

export const deleteRoleSchema = z.object({
  organizationId: organizationIdSchema,
  roleId: z.string().min(1),
});

export type InviteMemberValues = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberValues = z.infer<typeof updateMemberSchema>;
export type CreateRoleValues = z.infer<typeof createRoleSchema>;
export type UpdateRoleValues = z.infer<typeof updateRoleSchema>;
