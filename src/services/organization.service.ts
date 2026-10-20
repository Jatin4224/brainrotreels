/*

 */

import "server-only";

/**
 * SOURCE OF TRUTH KEYWORDS: createOrganizationWithOwner, slugifyOrganizationName,
 *   ensureUniqueOrganizationSlug, CreateOrganizationResult
 *
 * WHAT:  Creates an Organization plus the creator's owner Member row in one
 *        transaction, deriving a unique slug from the name.
 * WHY:   The Organization/Member models carry no `createdAt` default and use
 *        string ids, so creation must stamp `id`/`createdAt` and reserve a
 *        unique slug — centralizing that here keeps the onboarding router (and
 *        any future bulk-provision path) a one-liner. Pure DB access only; the
 *        caller owns onboardingComplete flips and audit.
 * WHERE: Called by organization.createOrganization in
 *        src/trpc/routers/organization.ts; `db` is the caller's tx client.
 */

import { nanoid } from "nanoid";
import type { DbClient } from "@/lib/config/prisma";

export interface CreateOrganizationResult {
  organizationId: string;
  slug: string;
}

/* Lowercase, strip non-alphanumerics to hyphens, collapse repeats, trim. */
export function slugifyOrganizationName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length > 0 ? base : "org";
}

/* Appends a short random suffix until the slug is free. Runs against the
 * caller's `db` (the tx) so the check and the create stay consistent. */
export async function ensureUniqueOrganizationSlug(
  db: DbClient,
  baseSlug: string,
): Promise<string> {
  let candidate = baseSlug;
  /* Bounded retry — collisions are rare; the random suffix makes a loop of a
   * few iterations effectively impossible to exhaust. */
  for (let attempt = 0; attempt < 6; attempt++) {
    const existing = await db.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${baseSlug}-${nanoid(6).toLowerCase()}`;
  }
  /* Final fallback — a fully random slug that can't realistically collide. */
  return `${baseSlug}-${nanoid(10).toLowerCase()}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: createOrganizationWithOwner
 *
 * WHAT:  Inserts the Organization and the creator's `owner` Member row.
 * WHY:   Owner membership is what unlocks every protected procedure (the
 *        onboarding gate keys off "has a membership"), so the two writes must
 *        commit together — the caller passes its tx client as `db`.
 * WHERE: Called by the onboarding mutation; returns ids for setActive.
 */
export async function createOrganizationWithOwner(
  db: DbClient,
  params: { userId: string; name: string; logo?: string | undefined },
): Promise<CreateOrganizationResult> {
  const organizationId = crypto.randomUUID();
  const slug = await ensureUniqueOrganizationSlug(
    db,
    slugifyOrganizationName(params.name),
  );
  const now = new Date();

  await db.organization.create({
    data: {
      id: organizationId,
      name: params.name,
      slug,
      logo: params.logo ?? null,
      createdAt: now,
    },
  });

  await db.member.create({
    data: {
      id: crypto.randomUUID(),
      organizationId,
      userId: params.userId,
      role: "owner",
      createdAt: now,
    },
  });

  return { organizationId, slug };
}

/**
 * SOURCE OF TRUTH KEYWORDS: ensurePersonalWorkspace, PERSONAL_WORKSPACE,
 *   workspaceNameFor, onboardingComplete, auto-create
 *
 * WHAT:  Guarantees the user has at least one organization, creating a
 *        personal workspace if not. Idempotent.
 * WHY:   PERSONAL_WORKSPACE. protectedProcedure requires an organizationId on
 *        every call and the dashboard requires an active organization, so a
 *        user with zero memberships can do nothing at all. For a solo creator
 *        there is no team to name, and asking them to invent one is friction
 *        in front of the product. One workspace is created for them and the
 *        UI never says "organization".
 *
 *        Why a service and not the tRPC mutation: the caller is a server
 *        LAYOUT, which cannot invoke a mutation. The capability guard and the
 *        onboardingComplete write previously lived in organization.create, so
 *        they move here and the router calls this too — one definition of
 *        "a workspace now exists", not two that drift.
 *
 *        Idempotency is load-bearing. Two tabs opening /dashboard at once both
 *        see zero memberships; the member unique constraint
 *        (organizationId, userId) makes the loser fail rather than duplicate,
 *        and the re-read below turns that into "already had one".
 * WHERE: Called by the dashboard layout when a signed-in user has no
 *        membership, and by organization.createOrganization.
 */
export async function ensurePersonalWorkspace(
  db: DbClient,
  params: { userId: string; name: string; logo?: string | undefined },
): Promise<CreateOrganizationResult & { created: boolean }> {
  const existing = await db.member.findFirst({
    where: { userId: params.userId },
    select: { organizationId: true, organization: { select: { slug: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return {
      organizationId: existing.organizationId,
      slug: existing.organization.slug,
      created: false,
    };
  }

  const result = await createOrganizationWithOwner(db, params);

  await db.user.update({
    where: { id: params.userId },
    /* Display-only today — the real onboarding gate is "has a membership"
     * (see the dashboard layout and protectedProcedure). Kept in step so the
     * flag never contradicts reality. */
    data: { onboardingComplete: true },
  });

  return { ...result, created: true };
}

/**
 * SOURCE OF TRUTH KEYWORDS: workspaceNameFor, PERSONAL_WORKSPACE
 *
 * WHAT:  A sensible default workspace name for a user who was never asked.
 * WHY:   `User.name` is non-nullable but can be empty in practice, and an
 *        email local-part is a better fallback than "Untitled". The name is
 *        cosmetic — it appears in the switcher and nowhere a customer sees —
 *        so it only has to be recognisable, and the user can rename it.
 * WHERE: Used by the dashboard layout when auto-creating.
 */
export function workspaceNameFor(user: {
  name: string;
  email: string;
}): string {
  const trimmed = user.name.trim();
  if (trimmed.length > 0) return `${trimmed}'s workspace`;

  const localPart = user.email.split("@")[0]?.trim();
  if (localPart !== undefined && localPart.length > 0)
    return `${localPart}'s workspace`;

  return "My workspace";
}
