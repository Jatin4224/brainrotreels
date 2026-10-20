/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: invitationRouter
 *
 * WHAT:  Organization invitations — create (with seat enforcement), cancel,
 *        resend, and a public get for the accept page.
 * WHY:   A pending invitation consumes a `member` seat, but invitations are
 *        their own (non-limit) resource so the factory's auto limit-check /
 *        counter-bump don't apply. The create handler therefore enforces the
 *        seat cap with checkFeatureGate and bumps the `member` counter inside
 *        the tx (matching the forms.publish pattern in the docs); cancel
 *        releases the seat. Members are created on the accept page, not here,
 *        so the seat is counted once at invite time and never double-counted.
 * WHERE: Mounted as `invitation` in src/trpc/routers/_app. Emails via
 *        src/services/email.service; gate via src/lib/feature-gate.
 */

import { TRPCError } from "@trpc/server";

import { createTRPCRouter, createStructuredError } from "../init";
import {
  protectedProcedure,
  baseProcedure,
  authProcedure,
} from "../procedures";
import { permissions } from "@/lib/permissions";
import {
  inviteMemberSchema,
  cancelInvitationSchema,
  resendInvitationSchema,
} from "@/lib/types";
import { z } from "zod";
import { checkFeatureGate } from "@/lib/feature-gate";
import { incrementUsage, decrementUsage } from "@/services/usage.service";
import { ERROR_CODES } from "@/lib/errors";
import { getAuthAdapter } from "@/lib/adapters";

export const invitationRouter = createTRPCRouter({
  /* Public — the accept page reads invitation details before the user signs
   * in, so this can't require org membership. Returns only display-safe fields. */
  get: baseProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const invitation = await ctx.prisma.invitation.findUnique({
        where: { id: input.invitationId },
        include: { organization: { select: { name: true } } },
      });
      if (!invitation) return null;
      return {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        organizationName: invitation.organization.name,
        expiresAt: invitation.expiresAt,
        expired: invitation.expiresAt.getTime() < Date.now(),
      };
    }),

  create: protectedProcedure({
    requirePermission: permissions.INVITATION_CREATE,
  })
    .input(inviteMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      if (email === ctx.user.email.toLowerCase()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You are already in this organization",
        });
      }

      /* Reject if the email already belongs to a member or a pending invite. */
      const existingUser = await ctx.db.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existingUser) {
        const existingMember = await ctx.db.member.findFirst({
          where: {
            organizationId: input.organizationId,
            userId: existingUser.id,
          },
          select: { id: true },
        });
        if (existingMember) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That person is already a member",
          });
        }
      }
      /* PROVIDER_NEUTRAL_MEMBERSHIP: the roster (members + pending invites) is
       * the adapter's, so the duplicate check works whichever provider stores
       * the invitation. */
      const adapter = await getAuthAdapter();
      const roster = await adapter.tenancy.listMembers(input.organizationId);
      if (
        roster.some((row) => row.isPending && row.email.toLowerCase() === email)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An invitation is already pending for that email",
        });
      }

      /* Seat cap — invitation consumes a `member` seat (see file header). */
      const gate = await checkFeatureGate(input.organizationId, "member", 1);
      if (!gate.allowed) {
        throw createStructuredError(
          "FORBIDDEN",
          gate.reason ?? "Seat limit reached",
          {
            errorCode: ERROR_CODES.USAGE_LIMIT_REACHED,
            resource: "member",
            limit: gate.limit ?? 0,
            current: gate.currentUsage ?? 0,
            currentPlan: gate.plan,
            upgradeRequired: true,
            message: gate.reason ?? "You have reached your plan seat limit",
            /* Same registry sentence the modal shows for a member-seat gate
             * anywhere else — an invite refused here reads identically to a
             * create refused by the procedure factory. */
            upgradeMessage: gate.upgradeMessage,
          },
        );
      }

      /* The adapter decodes the role, stores the invitation, and sends the
       * email — Better Auth through Resend with an app-hosted accept link; a
       * provider that owns invitations sends its own (hence a null link). */
      const result = await adapter.tenancy.inviteMember({
        organizationId: input.organizationId,
        email,
        role: input.role,
        inviterUserId: ctx.user.id,
        inviterName: ctx.user.name,
        organizationName: ctx.organization.name,
      });

      /* Seat accounting stays app-owned under every provider — billing
       * providers offer no numeric quotas beyond their own seat counts. */
      await incrementUsage(input.organizationId, "member", 1, ctx.db);

      return {
        invitationId: result.invitationId,
        invitationLink: result.invitationLink,
      };
    }),

  /* Accept — runs on authProcedure because the user is NOT yet a member of the
   * target org (protectedProcedure would reject them). Creates the member row
   * and deletes the invitation in one tx; the seat was already counted at
   * invite time, so acceptance is counter-neutral. Returns ids for setActive. */
  accept: authProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      /* PROVIDER_ISOLATION: when the PROVIDER owns invitations it also owns
       * acceptance — the invitee follows the provider's own link and the
       * provider creates the membership. This app-hosted accept path would look
       * at an empty local Invitation table and report "not found", which reads
       * as a broken link. Fail loudly with the real reason instead. */
      const adapter = await getAuthAdapter();
      if (adapter.capabilities.providerInvitations) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Invitations are handled by the auth provider. Use the link in the invitation email.",
        });
      }

      const invitation = await ctx.prisma.invitation.findUnique({
        where: { id: input.invitationId },
        include: { organization: { select: { id: true, slug: true } } },
      });
      if (!invitation)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invitation not found",
        });
      if (invitation.expiresAt.getTime() < Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invitation has expired",
        });
      }
      if (invitation.email.toLowerCase() !== ctx.user.email.toLowerCase()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `This invitation was sent to ${invitation.email}`,
        });
      }

      const organizationId = invitation.organization.id;

      const alreadyMember = await ctx.prisma.member.findFirst({
        where: { organizationId, userId: ctx.user.id },
        select: { id: true },
      });
      if (alreadyMember) {
        /* Idempotent — clean up the dangling invite and proceed. */
        await ctx.prisma.invitation
          .delete({ where: { id: invitation.id } })
          .catch(() => {});
        return { organizationId, slug: invitation.organization.slug };
      }

      await ctx.prisma.$transaction(async (tx) => {
        await tx.member.create({
          data: {
            id: crypto.randomUUID(),
            organizationId,
            userId: ctx.user.id,
            role: invitation.role ?? "member",
            createdAt: new Date(),
          },
        });
        await tx.invitation.delete({ where: { id: invitation.id } });
      });

      return { organizationId, slug: invitation.organization.slug };
    }),

  cancel: protectedProcedure({
    requirePermission: permissions.INVITATION_CANCEL,
  })
    .input(cancelInvitationSchema)
    .mutation(async ({ ctx, input }) => {
      const adapter = await getAuthAdapter();
      await adapter.tenancy.cancelInvitation({
        organizationId: input.organizationId,
        invitationId: input.invitationId,
      });
      /* Release the seat the pending invite was holding. */
      await decrementUsage(input.organizationId, "member", 1, ctx.db);
      return { id: input.invitationId };
    }),

  resend: protectedProcedure({
    requirePermission: permissions.INVITATION_CREATE,
    audit: { entity: "invitation", action: "resend" },
  })
    .input(resendInvitationSchema)
    .mutation(async ({ ctx, input }) => {
      const adapter = await getAuthAdapter();
      /* Counter-neutral: the seat was already consumed when the invitation was
       * first issued, and re-issuing does not consume another. */
      const result = await adapter.tenancy.resendInvitation({
        organizationId: input.organizationId,
        invitationId: input.invitationId,
        inviterUserId: ctx.user.id,
        inviterName: ctx.user.name,
        organizationName: ctx.organization.name,
      });
      return {
        invitationId: result.invitationId,
        invitationLink: result.invitationLink,
      };
    }),
});
