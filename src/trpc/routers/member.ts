/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: memberRouter, OrganizationMember,
 *   COPYABLE_INVITE_LINK, invitationLink
 *
 * WHAT:  Team-member management — list (members + pending invitations merged
 *        into one array), change a member's role/permissions, and remove a
 *        member.
 * WHY:   Built on protectedProcedure so auth, org-scoping, permission gates,
 *        audit, and tx are automatic. `list` returns ONE array (with an
 *        `isPending` flag) so the team UI renders members and invites uniformly,
 *        and carries each pending row's copyable accept link (COPYABLE_INVITE_LINK)
 *        so the roster's `⋯` menu can hand it over without re-issuing the invite.
 *        `update` accepts the encoded role string and decodes it via processRole
 *        (creating the role row if needed). `member.delete` auto-decrements the
 *        `member` seat counter via the factory. Owners + the caller's own row
 *        are protected.
 * WHERE: Mounted as `member` in src/trpc/routers/_app.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import { updateMemberSchema, removeMemberSchema } from "@/lib/types";
import { roleDisplayName, getRolePermissionMap } from "@/services/role.service";
import { getAuthAdapter } from "@/lib/adapters";

const OWNER_ROLES = ["owner", "client-owner"];

export const memberRouter = createTRPCRouter({
  /* Members + pending invitations as one list; each carries isPending, the
   * display roleName, and the flattened permissions. */
  list: protectedProcedure({ requirePermission: permissions.MEMBER_READ })
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      /* PROVIDER_NEUTRAL_MEMBERSHIP: the roster comes from the adapter, so this
       * payload — and therefore the entire Teams UI — is identical whichever
       * provider stores the membership. Permissions are always app-owned, so
       * they are joined on here rather than asked of the provider. */
      const adapter = await getAuthAdapter();
      const [rows, roleMap] = await Promise.all([
        adapter.tenancy.listMembers(input.organizationId),
        getRolePermissionMap(ctx.db, input.organizationId),
      ]);

      /* COPYABLE_INVITE_LINK: the accept URL IS the credential — following it is
       * how someone joins — so it ships only to a caller who could re-issue the
       * invitation anyway. MEMBER_READ is enough to SEE that a row is pending;
       * it is not enough to be handed the means to admit someone. Withheld on
       * the SERVER rather than hidden in the UI, so it never reaches a browser
       * that has no business with it. */
      const canIssueInvitations =
        ctx.memberHasFullAccess ||
        ctx.organization.permissions.includes(permissions.INVITATION_CREATE);

      return rows.map((row) => {
        const isOwner = OWNER_ROLES.includes(row.role);
        return {
          id: row.id,
          user: {
            name: row.isPending
              ? (row.email.split("@")[0] ?? row.email)
              : row.name,
            email: row.email,
            image: row.image,
          },
          role: row.role,
          isPending: row.isPending,
          permissions:
            isOwner || row.isPending ? [] : (roleMap.get(row.role) ?? []),
          roleName: isOwner ? "owner" : roleDisplayName(row.role),
          invitationId: row.invitationId,
          invitationLink: canIssueInvitations ? row.invitationLink : null,
        };
      });
    }),

  /* Reassign a member's role. Owner rows and the caller's own row are locked. */
  update: protectedProcedure({ requirePermission: permissions.MEMBER_UPDATE })
    .input(updateMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const adapter = await getAuthAdapter();
      const rows = await adapter.tenancy.listMembers(input.organizationId);
      const member = rows.find(
        (row) => row.id === input.memberId && !row.isPending,
      );
      if (!member)
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      if (OWNER_ROLES.includes(member.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The owner role cannot be changed",
        });
      }
      if (member.userId === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot change your own role",
        });
      }

      await adapter.tenancy.updateMemberRole({
        organizationId: input.organizationId,
        memberId: member.id,
        role: input.role,
      });
      return { id: member.id };
    }),

  /* Remove a member. Factory auto-decrements the `member` seat counter. */
  delete: protectedProcedure({ requirePermission: permissions.MEMBER_DELETE })
    .input(removeMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const adapter = await getAuthAdapter();
      const rows = await adapter.tenancy.listMembers(input.organizationId);
      const member = rows.find(
        (row) => row.id === input.memberId && !row.isPending,
      );
      if (!member)
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      if (OWNER_ROLES.includes(member.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The owner cannot be removed",
        });
      }
      if (member.userId === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot remove yourself",
        });
      }

      await adapter.tenancy.removeMember({
        organizationId: input.organizationId,
        memberId: member.id,
      });
      return { id: member.id };
    }),
});
