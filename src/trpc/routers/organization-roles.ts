/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: organizationRolesRouter
 *
 * WHAT:  Custom-role CRUD — list, create, update, delete per-org roles, each a
 *        single OrganizationRole row whose `permission` column stores a JSON
 *        statement map `{ resource: [actions] }`.
 * WHY:   This is the storage the context resolver (src/trpc/init.ts) parses to
 *        grant non-owner members their permissions. Conversions go through the
 *        registry-derived permission-helpers so a role can only hold verbs the
 *        app defines. `owner` is reserved (schema) and never stored here.
 * WHERE: Mounted as `organizationRoles` in src/trpc/routers/_app; consumed by
 *        the role-builder UI on the team page.
 */

import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";

import { createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import {
  createRoleSchema,
  updateRoleSchema,
  deleteRoleSchema,
} from "@/lib/types";
import {
  permissionsBeyondAuthority,
  permissionsToStatement,
  statementToPermissions,
  type PermissionStatement,
} from "@/lib/permissions";

/**
 * SOURCE OF TRUTH KEYWORDS: assertGrantWithinAuthority,
 *   A_GRANT_CANNOT_EXCEED_THE_GRANTER, permissionsBeyondAuthority,
 *   role escalation
 *
 * WHAT:  Refuses a role write carrying any permission the caller does not hold.
 * WHY:   `organizationRoles:update` is in the admin preset, and a role row IS
 *        the permission source the context resolver reads — so without this an
 *        admin could write `billing:*` into any role and have it granted on
 *        their next request. The permission gate on the procedure answers "may
 *        you edit roles at all", which is a different question from "may you
 *        hand out THIS".
 *
 *        Local to this router rather than pushed into the procedure factory:
 *        the factory gates on a permission the PATH implies, and it has no way
 *        to know that `input.permissions` here is a grant rather than ordinary
 *        payload. processRole covers the member/invitation surfaces for the
 *        same invariant, which is why the comparison itself lives in
 *        lib/permissions and not in either caller.
 * WHERE: organizationRoles.create and .update, before the row is written.
 */
function assertGrantWithinAuthority(
  requested: readonly string[],
  granter: { hasFullAccess: boolean; permissions: readonly string[] },
): void {
  const excess = permissionsBeyondAuthority(requested, granter);
  if (excess.length > 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You cannot grant a permission you do not hold yourself: ${excess.join(", ")}.`,
    });
  }
}

/* Parse the stored JSON statement back to a permission-string list. */
function parsePermissions(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return statementToPermissions(parsed as PermissionStatement);
    }
  } catch {
    /* Corrupt row — surface no permissions rather than throwing. */
  }
  return [];
}

export const organizationRolesRouter = createTRPCRouter({
  list: protectedProcedure({
    requirePermission: permissions.ORGANIZATION_ROLES_READ,
  })
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.organizationRole.findMany({
        where: { organizationId: input.organizationId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((row) => ({
        id: row.id,
        role: row.role,
        permissions: parsePermissions(row.permission),
      }));
    }),

  create: protectedProcedure({
    requirePermission: permissions.ORGANIZATION_ROLES_CREATE,
  })
    .input(createRoleSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.organizationRole.findFirst({
        where: { organizationId: input.organizationId, role: input.roleName },
        select: { id: true },
      });
      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A role with that name already exists",
        });
      }

      assertGrantWithinAuthority(input.permissions, {
        hasFullAccess: ctx.memberHasFullAccess,
        permissions: ctx.organization.permissions,
      });

      const statement = permissionsToStatement(input.permissions);
      return ctx.db.organizationRole.create({
        data: {
          id: nanoid(),
          organizationId: input.organizationId,
          role: input.roleName,
          permission: JSON.stringify(statement),
        },
      });
    }),

  update: protectedProcedure({
    requirePermission: permissions.ORGANIZATION_ROLES_UPDATE,
  })
    .input(updateRoleSchema)
    .mutation(async ({ ctx, input }) => {
      const role = await ctx.db.organizationRole.findFirst({
        where: { id: input.roleId, organizationId: input.organizationId },
        select: { id: true, role: true },
      });
      if (!role)
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });

      /* YOU_CANNOT_EDIT_THE_ROLE_YOU_HOLD. Checked BEFORE the authority
       * comparison, because against your own row that comparison can never
       * refuse anything useful: the permissions you are adding are measured
       * against the row that is about to define them, so every self-grant looks
       * legitimate one request later. member.update already locks a caller out
       * of their own membership row; this is the same rule for the role that
       * row points at, and without it that lock was trivially side-stepped.
       *
       * Full-access members are exempt: ownership is never stored here (the
       * name is reserved), so they cannot be editing their own row. */
      if (!ctx.memberHasFullAccess && role.role === ctx.organization.role) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "You cannot change the permissions of the role you hold yourself. Ask an owner to change it.",
        });
      }

      assertGrantWithinAuthority(input.permissions, {
        hasFullAccess: ctx.memberHasFullAccess,
        permissions: ctx.organization.permissions,
      });

      const statement = permissionsToStatement(input.permissions);
      return ctx.db.organizationRole.update({
        where: { id: role.id },
        data: { permission: JSON.stringify(statement) },
      });
    }),

  delete: protectedProcedure({
    requirePermission: permissions.ORGANIZATION_ROLES_DELETE,
  })
    .input(deleteRoleSchema)
    .mutation(async ({ ctx, input }) => {
      const role = await ctx.db.organizationRole.findFirst({
        where: { id: input.roleId, organizationId: input.organizationId },
        select: { id: true, role: true },
      });
      if (!role)
        throw new TRPCError({ code: "NOT_FOUND", message: "Role not found" });

      /* Block deletion while members still hold the role — they'd be left
       * with an unresolvable role and zero permissions. */
      const inUse = await ctx.db.member.count({
        where: { organizationId: input.organizationId, role: role.role },
      });
      if (inUse > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Reassign the ${inUse} member(s) using this role before deleting it`,
        });
      }

      return ctx.db.organizationRole.delete({ where: { id: role.id } });
    }),
});
