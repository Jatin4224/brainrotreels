/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: RESOURCES, ResourceDefinition, ResourceKey,
 *   LimitResourceKey, FlagResourceKey, PermissionedResourceKey, Permission,
 *   PermissionAction, ResourceLimit, ResourceFlag, ResourceNav, ResourceAudit,
 *   ResourceRateLimit, PLAN_KEYS, RESOURCE_ENTRIES, LIMIT_RESOURCE_KEYS,
 *   getAuditEntityLabel, AUDIT_ENTITY_LABEL,
 *   FLAG_RESOURCE_KEYS, getResourceLimitForPlan, getResourceFlagForPlan,
 *   getResourceFromPath, getMutationFeatureMap, isResourceKey,
 *   interpolateAuditDescribe, getOrganizationStatement, getPlanFeatureRows,
 *   PlanFeatureRow, getFeatureCategories, getUpgradeMessage, formatLimitAmount,
 *   formatLimitNoun, formatBytes
 *
 * WHAT:  Unified registry of every resource concept — permissions, limits, flags,
 *        sidebar nav, audit description templates, rate-limit overrides.
 * WHY:   Single source of truth — adding a verb to RESOURCES wires up the
 *        permission string, owner-role grant, role-builder UI metadata, sidebar
 *        item, optimistic-update mapping, and audit entity automatically.
 * WHERE: Consumed by procedureFactory (src/trpc/procedures/protected.ts),
 *        permission constants (src/lib/permissions/index.ts), feature
 *        gates (src/lib/feature-gate.ts), and optimistic UI
 *        (src/trpc/react-provider.tsx); depends on src/lib/config/plans.ts.
 */

import type { Route } from 'next'

import { PLAN_KEYS, PLANS, getNextPlan, type PlanKey } from '@/lib/config/plans'
import { BRANDING } from '@/lib/config/branding'

/* PLAN_KEYS / PlanKey are the single source of truth in plans.ts (RESOURCES only
 * consumes them for perPlan exhaustiveness). Re-exported here so existing
 * importers of `@/lib/resources` keep resolving without a second declaration. */
export { PLAN_KEYS }

type PerPlan<T> = Record<PlanKey, T>

export interface ResourceLimit {
  perPlan: PerPlan<number | 'unlimited'>
  upgradeMessage: string
  availableOnFreeTrial: boolean
  unit?: string
  /**
   * How the cap is consumed over time.
   *
   * Omitted means ABSOLUTE: a standing count of things that currently exist,
   * released by deleting them. `member` seats and `storage` bytes are both
   * absolute — resetting either would be a bug, letting a free workspace
   * invite one person a month forever, or decoupling the byte counter from
   * the objects actually in R2.
   *
   * `'month'` means PERIODIC: the counter refills on a schedule and is never
   * released by a delete. Only a resource that genuinely accrues — API calls,
   * renders, generated images — may declare it.
   *
   * Absolute is the default precisely because the unsafe direction is the one
   * that must be typed out deliberately.
   */
  period?: 'month'
}

export interface ResourceFlag {
  perPlan: PerPlan<boolean>
  availableOnFreeTrial: boolean
  /**
   * Copy shown when the plan does not include the feature. Optional because a
   * flag reads the same way every time — getUpgradeMessage falls back to
   * BRANDING.upgradeModal.flagMessageTemplate, so only a feature that deserves
   * its own sentence has to write one. `{nextPlan}` / `{resourceName}` are
   * interpolated the same way as on a limit.
   */
  upgradeMessage?: string
}

export interface ResourceNav {
  label: string
  /* TYPED_ROUTE_GUARANTEE: a real route, not a string. This href is also the
   * key ROUTE_AUTHORIZATION matches the pathname against, so a stale value
   * both 404s the link and leaves the page ungated — it must not compile. */
  href: Route
  icon: string
  section?: 'main' | 'settings' | (string & {})
  /** Defaults to 'read' when omitted. */
  requirePermission?: string
  requireFlag?: boolean
}

export interface ResourceAudit {
  entity?: string
  /** Templates support {input.field} and {output.field} interpolation. */
  describe?: Record<string, string>
}

export interface ResourceRateLimit {
  [action: string]: { count: number; window: `${number} ${'s' | 'm' | 'h' | 'd'}` }
}

/**
 * A feature surface — any combination of fields below. Only `name` is required.
 *
 *   permissions only          → RBAC-gated action with no UI page
 *   flag only                 → plan-tier on/off toggle (e.g., bulk export button)
 *   limit only                → plan-tier quota with no dedicated page
 *   nav only                  → sidebar page with no quotas
 *   permissions + nav + audit → full CRUD entity (the typical case)
 *
 * `<FeatureGate resource="...">` and `useFeatureGate('...')` work on ANY entry
 * that declares `limit` or `flag`, regardless of whether `nav` is present.
 */
export interface ResourceDefinition {
  name: string
  description?: string
  /**
   * Which group this resource sits under in the pricing comparison table.
   * Optional: omitted entries fall into the default group for their kind
   * (limits vs. flags) via getFeatureCategories, so the table is complete
   * whether or not anyone has curated the grouping.
   */
  category?: string
  permissions?: readonly string[]
  /** limit and flag are mutually exclusive — pick at most one. */
  limit?: ResourceLimit
  flag?: ResourceFlag
  nav?: ResourceNav
  audit?: ResourceAudit
  rateLimit?: ResourceRateLimit
}

/**
 * SOURCE OF TRUTH KEYWORDS: RESOURCES
 *
 * WHAT:  The feature registry — every feature surface the app exposes is
 *        declared here. A surface can be a CRUD entity, a flag-only toggle,
 *        a quota with no page, or any combination (see ResourceDefinition).
 * WHY:   Single source of truth: permission constants, owner-role grants,
 *        sidebar items, limit/flag values, audit templates, rate-limit
 *        overrides, and optimistic update mappings all derive from this.
 * WHERE: Read everywhere via RESOURCE_ENTRIES / typed helpers below.
 *
 * Naming: Better-Auth-owned surfaces (member, invitation) use singular keys
 * so auto-derived permission strings line up with Better Auth's internal
 * checks. App-owned surfaces use plural.
 */
export const RESOURCES = {
  member: {
    name: 'Team Members',
    description: 'Add, remove, and modify organization members',
    permissions: ['create', 'read', 'update', 'delete'],
    limit: {
      perPlan: { free: 1, starter: 3, pro: 10, enterprise: 'unlimited', portal: 'unlimited' },
      upgradeMessage: 'Upgrade to {nextPlan} to invite more teammates',
      availableOnFreeTrial: true,
      unit: 'seats',
    },
    nav: {
      label: 'Team',
      href: '/dashboard/team',
      icon: 'Users',
      section: 'main',
    },
  },

  /* The product's primary noun. `limit` is ABSOLUTE, not periodic — a plan caps
   * how many projects a workspace HOLDS, so deleting one frees a slot. Adding
   * `period` here would refill the cap monthly and let a free workspace
   * accumulate projects forever (see src/lib/usage-period.ts). */
  projects: {
    name: 'Projects',
    description: 'Videos being made in this workspace',
    permissions: ['create', 'read', 'update', 'delete'],
    limit: {
      perPlan: { free: 3, starter: 30, pro: 300, enterprise: 'unlimited', portal: 'unlimited' },
      upgradeMessage: 'Upgrade to {nextPlan} for more projects',
      availableOnFreeTrial: true,
      unit: 'projects',
    },
    nav: {
      label: 'Projects',
      href: '/dashboard/projects',
      icon: 'Folder',
      section: 'main',
    },
    audit: {
      describe: {
        create: 'Created project {output.title}',
        update: 'Updated project {output.title}',
        delete: 'Deleted project {input.id}',
      },
    },
  },

  /**
   * SOURCE OF TRUTH KEYWORDS: RESOURCES.assets, BYTES_METERED_ON_STORAGE,
   *   MANUAL_COUNTER_BUMP, assets.completeUpload
   *
   * The media library. Declares NO `limit` of its own, deliberately: the thing
   * a plan caps is bytes, and bytes already have a resource — `storage`. A
   * resource declares `limit` or `flag`, never both and never a SECOND
   * resource's quota, so there is no way to say "assets are capped by storage"
   * in the registry. The consequence is explicit rather than hidden:
   *
   * MANUAL_COUNTER_BUMP — because `assets.create` is not a limit path, the
   * factory's automatic gate and counter do NOT fire for media. The handlers do
   * it by hand against `storage` (`assets.completeUpload` adds the byte count,
   * `assets.delete` subtracts it), the same documented pattern
   * `invitation.create` uses for seats. Grep BYTES_METERED_ON_STORAGE for every
   * site that implements this.
   *
   * `update` is on the permission list although Phase 02's brief omitted it:
   * the phase also asks for a rename row action, and an action with no
   * permission to gate it is an action every member can take regardless of
   * their role. Rename is the only thing it grants — a filename is a label, and
   * nothing about the bytes is editable.
   *
   * The audit templates are keyed by the PATH VERB, not by the CRUD word.
   * writeAuditRow looks the template up as `describe[pathAction]`
   * (src/trpc/procedures/protected.ts), so `completeUpload` — the mutation that
   * actually creates the row — is the key that resolves. Keying it `create`
   * would compile, read correctly, and silently produce audit rows with no
   * description at all.
   */
  assets: {
    name: 'Media',
    description: 'Uploaded and generated media in this workspace',
    permissions: ['create', 'read', 'update', 'delete'],
    nav: {
      label: 'Media',
      href: '/dashboard/media',
      icon: 'Library',
      section: 'main',
    },
    audit: {
      describe: {
        completeUpload: 'Uploaded {output.filename}',
        update: 'Renamed asset to {output.filename}',
        delete: 'Deleted asset {input.id}',
      },
    },
    /* Presigning is cheap but it is also the step that decides whether bytes
     * may land at all, so it is the one worth a per-resource cap: a client
     * looping `createUploadUrl` would otherwise hold a drawer full of valid
     * write URLs for an hour. Generous enough for a real bulk drop of a few
     * dozen files. */
    rateLimit: {
      createUploadUrl: { count: 60, window: '1 m' },
    },
  },
  /**
   * SOURCE OF TRUTH KEYWORDS: RESOURCES.renders, PERIODIC_RENDERS,
   *   RENDERS_HAVE_NO_DELETE, renders.create
   *
   * Paid cloud renders. `limit` is PERIODIC (`period: 'month'`), which is the
   * one field here that cannot be guessed from the rest: a render is consumed
   * rather than held, so the cap has to refill, and `periodicResourceKeys()`
   * in src/lib/usage-period.ts picks this entry up with no cron wiring — the
   * Phase 00 `usage.reset` workflow already iterates whatever declares it.
   * Declaring it absolute (the default) would hand a free workspace five
   * renders for the lifetime of the account.
   *
   * RENDERS_HAVE_NO_DELETE, and that is deliberate rather than unfinished.
   * `delete` is absent from the permission list because the factory
   * auto-DECREMENTS a limit resource's counter on `<resource>.delete`
   * (section 13 of src/trpc/procedures/protected.ts) — so a delete verb would
   * refund the monthly quota every time a customer tidied up their render
   * history, which is a free render for the price of two clicks. The output is
   * an Asset and is deleted through `assets.delete` like any other media.
   *
   * The audit template is keyed `create`, which is the path verb here
   * (`renders.create`) — unlike `assets`, where the mutation that creates the
   * row is called `completeUpload`. See the note on that entry for why the key
   * has to be the PATH verb and not the CRUD word.
   */
  renders: {
    name: 'Renders',
    description: 'Videos rendered per month',
    permissions: ['create', 'read'],
    limit: {
      perPlan: { free: 5, starter: 100, pro: 1000, enterprise: 'unlimited', portal: 'unlimited' },
      upgradeMessage: 'Upgrade to {nextPlan} to render more videos each month',
      availableOnFreeTrial: true,
      unit: 'renders',
      period: 'month',
    },
    audit: {
      describe: {
        create: 'Started a render for project {input.projectId}',
        retry: 'Retried render {input.id}',
      },
    },
    /* A render is the most expensive thing a customer can trigger, and the
     * plan cap is a MONTHLY number — it does nothing about thirty renders in
     * one minute from a stuck client, which on an unlimited plan is unbounded
     * spend. The monthly quota is the budget; this is the blast radius. */
    rateLimit: {
      create: { count: 10, window: '1 m' },
      retry: { count: 5, window: '1 m' },
    },
  },

  /**
   * SOURCE OF TRUTH KEYWORDS: RESOURCES.watermarkFree, WATERMARK_BY_ENTITLEMENT
   *
   * WATERMARK_BY_ENTITLEMENT. A flag with no `permissions` and no `nav`, which
   * is the registry's shape for a pure plan entitlement: nothing calls
   * `watermarkFree.*`, so there is no procedure path for the factory's flag
   * gate (section 10) to fire on. It is read directly, exactly once, by
   * `checkBooleanFeature(organizationId, 'watermarkFree')` in the render
   * pre-flight — see WATERMARK_IS_DECIDED_BEFORE_THE_RENDER in
   * src/inngest/functions/project-render.ts for why that is the only place
   * allowed to ask, and why a generator must never put the answer in a
   * document.
   *
   * `availableOnFreeTrial: false` on purpose: a trial that shipped
   * watermark-free exports would make the trial the product.
   */
  watermarkFree: {
    name: 'Watermark-free export',
    description: 'Export finished videos without the watermark',
    flag: {
      perPlan: { free: false, starter: true, pro: true, enterprise: true, portal: true },
      availableOnFreeTrial: false,
      upgradeMessage: 'Upgrade to {nextPlan} to export without the watermark',
    },
  },

  /**
   * SOURCE OF TRUTH KEYWORDS: RESOURCES.credits, CREDITS_HAVE_NO_LIMIT,
   *   credits.purchase, LEDGER_NOT_A_COUNTER
   *
   * The credit balance and its history.
   *
   * CREDITS_HAVE_NO_LIMIT, and this is the entry's whole point — it declares
   * NEITHER `limit` NOR `flag`. That looks like an omission and is the
   * opposite: the registry's `limit` is a COUNTER with a `UsageMetrics` row
   * behind it, which can only increment on create and decrement on delete.
   * Credits need a hold, a partial commit and a refund, and a counter has no
   * vocabulary for any of them. Declaring a limit here would make the factory
   * gate and bump a second, parallel number that disagrees with the ledger
   * within one failed render.
   *
   * So the balance lives in `CreditLedger` + `Organization.creditBalance`, and
   * the refusal is thrown by hand with `ERROR_CODES.INSUFFICIENT_CREDITS`
   * rather than by the factory. The two systems sit side by side on purpose:
   * countable product objects (`projects`, `renders`, `storage`) keep the
   * automatic gates; variable-cost work (render minutes, TTS seconds,
   * generated footage) goes on the ledger. Grep LEDGER_NOT_A_COUNTER.
   *
   * `purchase` is a permission of its own rather than `create`, for two
   * reasons that both matter: the factory auto-gates and auto-counts on the
   * path verb `create`, which must not happen here, and spending real money is
   * genuinely a different authority from making things — a workspace can
   * reasonably let a member render while reserving top-ups to whoever owns the
   * card. The audit template is keyed by that same PATH verb.
   */
  credits: {
    name: 'Credits',
    description: 'Credit balance and purchase history',
    permissions: ['read', 'purchase'],
    category: 'Billing',
    nav: {
      label: 'Credits',
      href: '/dashboard/settings/credits',
      icon: 'CreditCard',
      section: 'settings',
      requirePermission: 'credits:read',
    },
    audit: {
      describe: { purchase: 'Purchased {input.packKey} credits' },
    },
    /* Each attempt is a real payment-intent round trip against a real card.
     * A loop here is both a Stripe bill and a fraud signal on the account. */
    rateLimit: {
      purchase: { count: 10, window: '1 m' },
    },
  },

  invitation: {
    name: 'Invitations',
    description: 'Send invites and cancel pending invitations',
    permissions: ['create', 'cancel'],
  },

  organizationRoles: {
    name: 'Organization Roles',
    description: 'Create and manage custom roles and their permissions',
    permissions: ['create', 'read', 'update', 'delete'],
  },

  storage: {
    name: 'Storage',
    description: 'File storage capacity',
    limit: {
      perPlan: {
        free: 100 * 1024 * 1024,
        starter: 5 * 1024 * 1024 * 1024,
        pro: 25 * 1024 * 1024 * 1024,
        enterprise: 'unlimited',
        portal: 'unlimited',
      },
      upgradeMessage: 'Upgrade to {nextPlan} to expand your storage',
      availableOnFreeTrial: true,
      unit: 'bytes',
    },
  },

  apiCalls: {
    name: 'API Calls',
    description: 'Total API calls per month',
    limit: {
      perPlan: { free: 1_000, starter: 50_000, pro: 500_000, enterprise: 'unlimited', portal: 'unlimited' },
      upgradeMessage: 'Upgrade to {nextPlan} for more API calls',
      availableOnFreeTrial: true,
      /* `unit` is the noun the pricing copy uses — "50,000 API calls". */
      unit: 'API calls',
      /* The only periodic resource today. The description has always said "per
       * month"; this is the machine-readable half that usage.reset acts on. */
      period: 'month',
    },
  },

  auditLogs: {
    name: 'Audit Logs',
    description: 'Access full audit log history with forensic detail',
    permissions: ['read'],
    flag: {
      perPlan: { free: false, starter: false, pro: true, enterprise: true, portal: true },
      availableOnFreeTrial: false,
    },
    nav: {
      label: 'Audit Logs',
      href: '/dashboard/settings/audit-logs',
      icon: 'ScrollText',
      section: 'settings',
      requireFlag: true,
    },
  },

  billing: {
    name: 'Billing & Payments',
    description: 'Manage subscriptions, invoices, and payment methods',
    permissions: ['create', 'read', 'update', 'delete'],
    nav: {
      label: 'Billing',
      href: '/dashboard/settings/billing',
      icon: 'CreditCard',
      section: 'settings',
    },
  },

  organizationSettings: {
    name: 'Organization Settings',
    description: 'Update organization name, logo, and other org-wide settings',
    permissions: ['read', 'update'],
    audit: { entity: 'organization' },
    nav: {
      label: 'Workspace',
      href: '/dashboard/settings/organization',
      icon: 'Settings',
      section: 'settings',
    },
  },

} as const satisfies Record<string, ResourceDefinition>

export type ResourceKey = keyof typeof RESOURCES

export type LimitResourceKey = {
  [K in ResourceKey]: (typeof RESOURCES)[K] extends { limit: ResourceLimit } ? K : never
}[ResourceKey]

export type FlagResourceKey = {
  [K in ResourceKey]: (typeof RESOURCES)[K] extends { flag: ResourceFlag } ? K : never
}[ResourceKey]

export type PermissionedResourceKey = {
  [K in ResourceKey]: (typeof RESOURCES)[K] extends { permissions: readonly string[] }
    ? K
    : never
}[ResourceKey]

export type PermissionAction<R extends PermissionedResourceKey> =
  (typeof RESOURCES)[R] extends { permissions: infer A }
    ? A extends readonly (infer T)[]
      ? T
      : never
    : never

/**
 * SOURCE OF TRUTH KEYWORDS: Permission
 *
 * WHAT:  Template-literal union of every legal `resource:action` string plus
 *        the Better Auth owner wildcard `*:*`.
 * WHY:   Compile-time guarantee that permission strings exist in RESOURCES;
 *        prevents typos at every callsite of permission() and requirePermission.
 * WHERE: Re-exported from src/lib/permissions/index.ts.
 */
export type Permission =
  | {
      [R in PermissionedResourceKey]: `${R & string}:${PermissionAction<R> & string}`
    }[PermissionedResourceKey]
  | '*:*'

/**
 * SOURCE OF TRUTH KEYWORDS: isResourceKey
 *
 * WHAT:  Type guard narrowing an arbitrary string to ResourceKey.
 * WHY:   hasOwnProperty so prototype-chain keys ('toString' etc.) do NOT pass.
 * WHERE: Used by getResourceFromPath and the RESOURCE_ENTRIES builder below.
 */
export function isResourceKey(value: string): value is ResourceKey {
  return Object.prototype.hasOwnProperty.call(RESOURCES, value)
}

/* Single widening point for iterating RESOURCES as [key, def] tuples — the
 * `as const satisfies` literal types refuse to see optional fields on the
 * union when iterated directly, so we widen here once. */
export const RESOURCE_ENTRIES: ReadonlyArray<readonly [ResourceKey, ResourceDefinition]> =
  (() => {
    const out: Array<readonly [ResourceKey, ResourceDefinition]> = []
    for (const key of Object.keys(RESOURCES)) {
      if (isResourceKey(key)) {
        out.push([key, RESOURCES[key]])
      }
    }
    return out
  })()

/**
 * SOURCE OF TRUTH KEYWORDS: getOrganizationStatement
 *
 * WHAT:  Builds the resource→actions statement record consumed by Better Auth.
 * WHY:   Filters RESOURCES down to entries with permissions so non-permissioned
 *        resources (limits/flags only) do not pollute the access-control schema.
 * WHERE: Used by src/lib/better-auth/access-control.ts to build organizationStatement.
 */
export function getOrganizationStatement(): Record<string, readonly string[]> {
  const statement: Record<string, readonly string[]> = {}
  for (const [key, def] of RESOURCE_ENTRIES) {
    if (def.permissions && def.permissions.length > 0) {
      statement[key] = def.permissions
    }
  }
  return statement
}

/**
 * SOURCE OF TRUTH KEYWORDS: SidebarNavItem, SidebarNavSection, getSidebarNav
 *
 * WHAT:  Sidebar item shape (one per RESOURCES entry that declares `nav`) and
 *        the per-section grouping the sidebar renders.
 * WHY:   The sidebar is derived from the SAME registry that drives permissions
 *        and gates — adding `nav` to a resource is the ONLY step needed to make
 *        it appear in the sidebar, with its permission/flag gating already
 *        wired. No second nav source-of-truth file.
 * WHERE: Produced by getSidebarNav(); consumed by
 *        src/components/global/sidebar/app-sidebar.tsx.
 */
export interface SidebarNavItem {
  key: ResourceKey
  label: string
  href: Route
  icon: string
  /** Full `resource:action` the member must hold; owners always pass. */
  requirePermission: Permission
  /** When true, the item is hidden unless the resource's plan flag is on. */
  requireFlag: boolean
}

export interface SidebarNavSection {
  section: string
  items: SidebarNavItem[]
}

/* Render order for the known sections; unknown sections append after. */
const NAV_SECTION_ORDER: readonly string[] = ['main', 'settings']

/**
 * SOURCE OF TRUTH KEYWORDS: getSidebarNav
 *
 * WHAT:  Builds the grouped sidebar nav from every RESOURCES entry with `nav`.
 * WHY:   Single registry pass — the item's permission defaults to
 *        `<resource>:read` unless the nav entry overrides the action, and
 *        `requireFlag` carries through so the sidebar can hide plan-locked
 *        items. Keeps the sidebar in lockstep with the registry.
 * WHERE: Called by app-sidebar.tsx (client) to render sections.
 */
export function getSidebarNav(): SidebarNavSection[] {
  const bySection = new Map<string, SidebarNavItem[]>()

  for (const [key, def] of RESOURCE_ENTRIES) {
    if (!def.nav) continue
    const action = def.nav.requirePermission ?? 'read'
    /* `${key}:${action}` is a Permission by construction, but RESOURCE_ENTRIES
     * is typed against the widened ResourceDefinition so TS sees `string`. This
     * is the same documented boundary the permission-constants builder uses. */
    const requirePermission = `${key}:${action}` as Permission
    const section = def.nav.section ?? 'main'
    const item: SidebarNavItem = {
      key,
      label: def.nav.label,
      href: def.nav.href,
      icon: def.nav.icon,
      requirePermission,
      requireFlag: def.nav.requireFlag ?? false,
    }
    const existing = bySection.get(section)
    if (existing) existing.push(item)
    else bySection.set(section, [item])
  }

  const orderedKeys = [
    ...NAV_SECTION_ORDER.filter((s) => bySection.has(s)),
    ...[...bySection.keys()].filter((s) => !NAV_SECTION_ORDER.includes(s)),
  ]
  return orderedKeys.map((section) => ({
    section,
    items: bySection.get(section) ?? [],
  }))
}

/**
 * SOURCE OF TRUTH KEYWORDS: getResourceFromPath
 *
 * WHAT:  Extracts the resource key from a tRPC procedure path like
 *        `projects.create` -> `projects`.
 * WHY:   Convention-driven auto-wiring (audit entity, limit checks, counter
 *        bumps) keys off the first path segment matching a RESOURCES entry.
 * WHERE: Used by protectedProcedure (src/trpc/procedures/protected.ts).
 */
export function getResourceFromPath(path: string): ResourceKey | null {
  if (!path) return null
  const first = path.split('.')[0]
  if (first === undefined) return null
  return isResourceKey(first) ? first : null
}

function isLimitEntry(
  entry: readonly [ResourceKey, ResourceDefinition]
): entry is readonly [LimitResourceKey, ResourceDefinition & { limit: ResourceLimit }] {
  return entry[1].limit !== undefined
}

function isFlagEntry(
  entry: readonly [ResourceKey, ResourceDefinition]
): entry is readonly [FlagResourceKey, ResourceDefinition & { flag: ResourceFlag }] {
  return entry[1].flag !== undefined
}

/**
 * SOURCE OF TRUTH KEYWORDS: getMutationFeatureMap, AUTO_DERIVED_FROM_RESOURCES
 *
 * WHAT:  Builds the client-side `procedure.path -> { resource, operation }` map
 *        used to optimistically bump usage counters on success.
 * WHY:   Rigid by design — if a procedure should bump a counter but doesn't
 *        fit `<resource>.create` / `<resource>.delete`, rename the procedure
 *        rather than special-casing here. The server-side counter bump is
 *        AUTO_DERIVED_FROM_RESOURCES in protectedProcedure off the same path
 *        shape, so client and server stay in lockstep without a second
 *        registry.
 * WHERE: Consumed by src/trpc/react-provider.tsx for optimistic UI.
 */
export function getMutationFeatureMap(): Record<
  string,
  { resource: LimitResourceKey; operation: 'increment' | 'decrement' }
> {
  const map: Record<
    string,
    { resource: LimitResourceKey; operation: 'increment' | 'decrement' }
  > = {}
  for (const entry of RESOURCE_ENTRIES) {
    if (!isLimitEntry(entry)) continue
    const [key] = entry
    map[`${key}.create`] = { resource: key, operation: 'increment' }
    map[`${key}.delete`] = { resource: key, operation: 'decrement' }
  }
  return map
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * SOURCE OF TRUTH KEYWORDS: interpolateAuditDescribe
 *
 * WHAT:  Interpolates `{input.field}` / `{output.field}` placeholders in audit
 *        description templates against the procedure's input and output.
 * WHY:   Missing keys render as the literal placeholder so audit rows stay
 *        inspectable instead of crashing.
 * WHERE: Called by protectedProcedure's auto-audit path
 *        (src/trpc/procedures/protected.ts).
 */
export function interpolateAuditDescribe(
  template: string,
  params: { input: unknown; output: unknown }
): string {
  return template.replace(/\{(input|output)\.([a-zA-Z0-9_]+)\}/g, (_, source, field) => {
    const obj = source === 'input' ? params.input : params.output
    if (!isJsonObject(obj) || !(field in obj)) {
      return `{${source}.${field}}`
    }
    const value = obj[field]
    if (value === null || value === undefined) return `{${source}.${field}}`
    return String(value)
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: getResourceLimitForPlan
 *
 * WHAT:  Resolves a numeric cap for a (resource, plan) pair, mapping
 *        'unlimited' to Infinity.
 * WHY:   Centralises the 'unlimited' sentinel so comparisons are simple
 *        `current >= cap` everywhere downstream.
 * WHERE: Used by src/lib/feature-gate.ts and the usage-counter logic.
 */
export function getResourceLimitForPlan(
  resource: LimitResourceKey,
  plan: PlanKey
): number {
  const value = RESOURCES[resource].limit.perPlan[plan]
  return value === 'unlimited' ? Infinity : value
}

/**
 * SOURCE OF TRUTH KEYWORDS: getResourceFlagForPlan
 *
 * WHAT:  Returns the boolean availability of a flag resource for a given plan.
 * WHY:   Single read-point for feature-flag gating so requireFlag and the UI
 *        agree on availability.
 * WHERE: Used by src/lib/feature-gate.ts and nav rendering.
 */
export function getResourceFlagForPlan(
  resource: FlagResourceKey,
  plan: PlanKey
): boolean {
  return RESOURCES[resource].flag.perPlan[plan]
}

/**
 * SOURCE OF TRUTH KEYWORDS: getAuditEntityLabel, AUDIT_ENTITY_LABEL,
 *   AuditEntityName
 *
 * WHAT:  The human name for an entity recorded on an audit row.
 * WHY:   AUDIT_ENTITY_LABEL. Audit rows store the raw entity key the procedure
 *        path produced — `organizationRoles`, not "Roles" — and rendering that
 *        verbatim gives a timeline written in code identifiers. When the entity
 *        IS a registry resource its `name` is already the reviewed, env-aware
 *        label the pricing cards and gates use, so reading it here means the
 *        audit log renames itself when a resource is renamed.
 *        The fallback is deliberate rather than a throw: audit rows outlive the
 *        registry. `organization`, `subscription` and `session` are written by
 *        the auth and billing layers and are not resources at all, and a row
 *        recorded before a resource was removed must still render. Splitting
 *        camelCase and capitalising turns any such key into something readable
 *        instead of blanking the row.
 * WHERE: The audit-log timeline under
 *        src/app/(dashboard)/dashboard/settings/audit-logs/_components.
 */
export function getAuditEntityLabel(entity: string): string {
  if (isResourceKey(entity)) return RESOURCES[entity].name
  const spaced = entity.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * SOURCE OF TRUTH KEYWORDS: getPlanFeatureList, formatLimitValue, PLAN_FEATURE_COPY
 *
 * WHAT:  The human-readable "what you get" list for a plan, derived entirely
 *        from this registry — numeric caps first, then the boolean features the
 *        plan unlocks.
 * WHY:   PLAN_FEATURE_COPY — the pricing UI must not carry a SECOND list of what
 *        a plan includes. Anything typed into a billing provider's dashboard is a
 *        hand-maintained copy of numbers that already live here and rots the
 *        moment a cap changes — and most providers model booleans only, so the
 *        numeric caps cannot be expressed there at all. Generating the copy from
 *        `perPlan` means changing a limit updates the pricing page in the same
 *        commit, under every provider.
 *        Takes a PlanKey rather than a string, so callers iterate PLAN_KEYS /
 *        PLAN_ORDER from src/lib/config/plans.ts and never re-list plans.
 * WHERE: Rendered by the plan cards in the billing UI; available to any future
 *        pricing surface.
 */
export function getPlanFeatureList(plan: PlanKey): string[] {
  const lines: string[] = []

  for (const [, def] of RESOURCE_ENTRIES) {
    if (!def.limit) continue
    const value = def.limit.perPlan[plan]
    /* A zero cap means the plan does not include the resource at all — listing
     * "0 seats" as a selling point would read worse than saying nothing. */
    if (value === 0) continue
    lines.push(formatLimitValue(value, def.name, def.limit))
  }

  for (const [, def] of RESOURCE_ENTRIES) {
    if (!def.flag) continue
    if (def.flag.perPlan[plan]) lines.push(def.name)
  }

  return lines
}

const BYTE_UNITS: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB']

/**
 * SOURCE OF TRUTH KEYWORDS: formatBytes, BYTE_UNITS, PLAN_FEATURE_COPY
 *
 * WHAT:  A byte count as the shortest readable size — "512 KB", "1.4 GB".
 * WHY:   One implementation for two audiences that must agree. The pricing copy
 *        renders a plan's storage cap through formatLimitAmount below, and the
 *        media library renders each file's own size and the usage meter's
 *        "1.4 GB of 5 GB" — if those round differently, a customer at their cap
 *        reads two numbers that contradict each other on the same screen.
 *        Binary units (1024), because that is what the bucket reports and what
 *        the caps in RESOURCES.storage are written in.
 * WHERE: formatLimitAmount; the media table and upload UI; <UsageMeter>.
 */
export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'

  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  /* Trim a trailing .0 so 5 GB doesn't render as "5.0 GB". */
  const rounded = Number.isInteger(size) ? String(size) : size.toFixed(1)
  return `${rounded} ${BYTE_UNITS[unitIndex]}`
}

/**
 * SOURCE OF TRUTH KEYWORDS: formatLimitValue
 *
 * WHAT:  Renders one limit as a sentence fragment — "10 seats", "25 GB Storage",
 *        "Unlimited API calls".
 * WHY:   Reads the `unit` declared on the registry entry, so a NEW limit
 *        resource formats correctly without touching this function. `bytes` is
 *        special-cased because a raw byte count is unreadable in pricing copy.
 * WHERE: Called by getPlanFeatureList.
 */
export function formatLimitValue(
  value: number | 'unlimited',
  name: string,
  limit: ResourceLimit
): string {
  return `${formatLimitAmount(value, limit)} ${formatLimitNoun(value, name, limit)}`
}

/**
 * SOURCE OF TRUTH KEYWORDS: formatLimitNoun, PLAN_FEATURE_COPY, PricingCard
 *
 * WHAT:  The NOUN half of a limit — "seats", "seat", "Storage", "API calls".
 * WHY:   Split out for the same reason formatLimitAmount is: a pricing card
 *        renders the amount in bold and the noun in normal weight, so it needs
 *        the two halves separately, and getting them from anywhere but this
 *        function is how "1 Team Members" gets shipped. `bytes` is a
 *        MEASUREMENT, not a noun — "Unlimited bytes" is nonsense — so
 *        byte-denominated limits read against the resource name instead.
 * WHERE: formatLimitValue above, and the `noun` on every PlanFeatureRow.
 */
export function formatLimitNoun(
  value: number | 'unlimited',
  name: string,
  limit: ResourceLimit
): string {
  const isBytes = limit.unit === 'bytes'

  /* Unlimited reads as a sentence ("Unlimited storage"), so the noun is
   * lower-case even for a byte limit, where a capped value reads as a
   * measurement of a named thing ("5 GB Storage"). */
  if (value === 'unlimited') return isBytes ? name.toLowerCase() : (limit.unit ?? name.toLowerCase())
  if (isBytes) return name

  /* Registry units are written plural because that is the common case; drop the
   * s for a cap of one so a Free plan reads "1 seat", not "1 seats". */
  const noun = limit.unit ?? name.toLowerCase()
  return value === 1 && noun.endsWith('s') ? noun.slice(0, -1) : noun
}

/**
 * SOURCE OF TRUTH KEYWORDS: formatLimitAmount, PLAN_FEATURE_COPY
 *
 * WHAT:  The NUMBER half of a limit on its own — "25 GB", "50,000",
 *        "Unlimited" — with no resource noun attached.
 * WHY:   A comparison table already names the resource in its row label, so
 *        repeating it in every cell ("25 GB Storage" under a Storage row) reads
 *        as a stutter. Splitting the amount out of formatLimitValue keeps the
 *        byte maths in ONE place — both callers format 5 GB identically, and a
 *        new unit is taught to the app once.
 * WHERE: Cells in <FeatureComparisonTable /> and the value prefix on the
 *        pricing cards; formatLimitValue builds its sentence from it.
 */
export function formatLimitAmount(
  value: number | 'unlimited',
  limit: ResourceLimit
): string {
  if (value === 'unlimited') return 'Unlimited'

  /* Shared with the media library and the usage meter — see formatBytes. */
  if (limit.unit === 'bytes') return formatBytes(value)

  return value.toLocaleString('en-US')
}

/* `satisfies` is load-bearing: if a new limit/flag resource gets added and
 * the tuple isn't updated, TS fails to compile. */
export const LIMIT_RESOURCE_KEYS = RESOURCE_ENTRIES
  .filter(isLimitEntry)
  .map(([k]) => k) satisfies readonly LimitResourceKey[]

export const FLAG_RESOURCE_KEYS = RESOURCE_ENTRIES
  .filter(isFlagEntry)
  .map(([k]) => k) satisfies readonly FlagResourceKey[]

/**
 * SOURCE OF TRUTH KEYWORDS: PlanFeatureRow, getPlanFeatureRows,
 *   PLAN_FEATURE_COPY, PricingCard, FeatureComparisonTable
 *
 * WHAT:  One resource's value FOR ONE PLAN, already formatted for display —
 *        the cell a pricing card or comparison table renders.
 * WHY:   The pricing UI needs three things per row that a plain string cannot
 *        carry: the amount on its own (so a table cell doesn't repeat the row
 *        label), whether the plan includes it at all (so a card can dim the
 *        line instead of hiding it), and which kind it is (a flag renders a
 *        check, a limit renders a number). getPlanFeatureList stays as the
 *        one-line sentence form; this is the structured form of the SAME
 *        registry read, so neither can describe a plan the other contradicts.
 * WHERE: Produced by getPlanFeatureRows; rendered by <PricingCard /> and
 *        <FeatureComparisonTable /> in src/components/global/upgrade-modal.
 */
export interface PlanFeatureRow {
  resource: ResourceKey
  name: string
  category: string
  kind: 'limit' | 'flag'
  /** "25 GB", "50,000", "Unlimited" — empty string for a flag. */
  amount: string
  /** The noun the amount counts — "seats", "Storage" — empty for a flag. */
  noun: string
  /** Sentence form — "10 seats", "Custom Domain". */
  label: string
  /** False when the plan caps the resource at 0 or leaves the flag off. */
  isIncluded: boolean
  isUnlimited: boolean
}

/* The group a resource falls into when its registry entry doesn't name one.
 * Two defaults, not one, because a quota and a capability answer different
 * questions for a buyer and a single undifferentiated list buries both. */
const DEFAULT_LIMIT_CATEGORY = 'Usage & limits'
const DEFAULT_FLAG_CATEGORY = 'Features'

/**
 * SOURCE OF TRUTH KEYWORDS: getPlanFeatureRows, PLAN_FEATURE_COPY
 *
 * WHAT:  Every limit and flag in the registry, resolved against one plan.
 * WHY:   PLAN_FEATURE_COPY — the pricing surface must not carry a second list
 *        of what a plan includes. Rows for resources the plan does NOT include
 *        are returned too (isIncluded false) rather than filtered out, because
 *        a comparison table has to show the gap: dropping the row would make
 *        two plans look identical where they differ. Callers that want only the
 *        wins (a pricing card) filter; callers that want the matrix don't.
 * WHERE: <PricingCard /> and <FeatureComparisonTable />.
 */
export function getPlanFeatureRows(plan: PlanKey): PlanFeatureRow[] {
  const rows: PlanFeatureRow[] = []

  for (const [key, def] of RESOURCE_ENTRIES) {
    if (!def.limit) continue
    const value = def.limit.perPlan[plan]
    rows.push({
      resource: key,
      name: def.name,
      category: def.category ?? DEFAULT_LIMIT_CATEGORY,
      kind: 'limit',
      amount: formatLimitAmount(value, def.limit),
      noun: formatLimitNoun(value, def.name, def.limit),
      label: formatLimitValue(value, def.name, def.limit),
      /* A cap of 0 is not "a small allowance" — the plan doesn't include it. */
      isIncluded: value !== 0,
      isUnlimited: value === 'unlimited',
    })
  }

  for (const [key, def] of RESOURCE_ENTRIES) {
    if (!def.flag) continue
    rows.push({
      resource: key,
      name: def.name,
      category: def.category ?? DEFAULT_FLAG_CATEGORY,
      kind: 'flag',
      amount: '',
      noun: '',
      label: def.name,
      isIncluded: def.flag.perPlan[plan],
      isUnlimited: false,
    })
  }

  return rows
}

/**
 * SOURCE OF TRUTH KEYWORDS: getFeatureCategories, FeatureComparisonTable
 *
 * WHAT:  The comparison table's row groups, in the order they render.
 * WHY:   Derived from the same registry pass as the rows, so a resource added
 *        tomorrow appears in the table with no edit here — under its own
 *        `category` if it declares one, otherwise under the default group for
 *        its kind. Order follows first appearance in RESOURCES so the grouping
 *        never reshuffles on an unrelated edit.
 * WHERE: <FeatureComparisonTable />.
 */
export function getFeatureCategories(): Array<{ name: string; resources: ResourceKey[] }> {
  const groups = new Map<string, ResourceKey[]>()

  /* Limits first, then flags — the same order getPlanFeatureRows returns, so
   * the table reads top-to-bottom in one consistent sequence. */
  for (const row of getPlanFeatureRows(PLAN_KEYS[0])) {
    const existing = groups.get(row.category)
    if (existing) existing.push(row.resource)
    else groups.set(row.category, [row.resource])
  }

  return [...groups.entries()].map(([name, resources]) => ({ name, resources }))
}

/**
 * SOURCE OF TRUTH KEYWORDS: getUpgradeMessage, upgradeMessage, nextPlan,
 *   UpgradeModal, UPGRADE_COPY_FROM_REGISTRY
 *
 * WHAT:  The resource-specific sentence shown to a user who just hit a gate —
 *        "Upgrade to Pro to invite more teammates".
 * WHY:   UPGRADE_COPY_FROM_REGISTRY. The message already exists on the registry
 *        entry (`limit.upgradeMessage`); until now nothing rendered it, so
 *        every gate produced the same generic "you hit a limit" line and the
 *        registry copy was dead weight. Reading it HERE means the wording for a
 *        resource is written once, next to the caps it talks about.
 *        `{nextPlan}` resolves against the plan the organization is on right
 *        now, so the sentence names a plan that is actually a step up — and
 *        falls back to a generic upgrade line at the top of the ladder, where
 *        naming a next plan would be a lie. A flag with no custom copy borrows
 *        BRANDING's template rather than hardcoding a second sentence here.
 * WHERE: Attached to every gate by getFeatureGates (src/lib/feature-gate.ts)
 *        and to the structured gate errors thrown by protectedProcedure; both
 *        surface in <UpgradeModal />.
 */
export function getUpgradeMessage(resource: ResourceKey, currentPlan: PlanKey): string {
  /* Widened through ResourceDefinition for the same reason RESOURCE_ENTRIES is:
   * the `as const satisfies` literal refuses to show optional fields on the
   * union. */
  const def: ResourceDefinition = RESOURCES[resource]
  const template =
    def.limit?.upgradeMessage ??
    def.flag?.upgradeMessage ??
    BRANDING.upgradeModal.flagMessageTemplate

  const nextPlan = getNextPlan(currentPlan)
  /* No rung above this one — a sentence naming a next plan would be false, so
   * the generic line takes over instead. */
  if (!nextPlan) return BRANDING.upgradeModal.topOfLadderBody

  return template
    .replace('{nextPlan}', PLANS[nextPlan].name)
    .replace('{resourceName}', def.name)
}
