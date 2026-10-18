<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Providers and adapters

One environment variable decides who handles authentication, organizations, and
billing:

```bash
NEXT_PUBLIC_AUTH_PROVIDER="better-auth"   # default — and the only one that ships
```

Better Auth is the provider in this template: fully open source, self-hosted,
Stripe for billing. You own the data, the UI, and the billing account.

The point of this chapter is the **seam**. Nothing in the app talks to a provider
directly, so a hosted provider (Clerk, WorkOS, Auth0, Kinde, …) is a plug-in
rather than a rewrite. Adding one changes no router, no procedure, no page, and
no registry entry.

## Why this works

The app touches a provider through exactly **three interfaces**, defined in
`src/lib/adapters/types.ts`:

| Interface | Question it answers | Method |
| --------- | ------------------- | ------ |
| `IdentityAdapter` | Who is calling? | `getSession()` |
| `TenancyAdapter` | What orgs are they in, and what may they do? | `getMemberships()`, `resolvePermissions()`, the roster + invitation + organization writes |
| `EntitlementAdapter` | What plan is this org on? | `getTier()` |

Implement those three and the whole app works. That is the entire contract.

## The one rule: never compare a role string

Better Auth calls the full-access role `owner`. A hosted provider will call it
`admin`, `org:admin`, or something else again.

The adapter normalizes all of them into a single boolean:

```ts
member.hasFullAccess    // ✅ branch on this
member.role === 'owner' // ❌ hard-wires you to one provider
```

Server-side, read `ctx.memberHasFullAccess`. The `role` string survives for two
things only: display, and looking the role up in the app-owned permission table.

## What the app keeps under every provider

These live in this codebase's own tables and no provider can host them:

- **Per-tenant roles and permissions** (`OrganizationRole`). Hosted providers cap
  custom roles per *application instance*, shared across every tenant — a
  per-tenant role builder is impossible there. So every adapter resolves
  permissions through the same app-owned function,
  `src/lib/adapters/shared/resolve-permissions.ts`.
- **Usage counters** (`UsageMetrics`). Billing providers offer no numeric quotas
  beyond seats, so `storage`, `apiCalls`, and every counted resource are enforced
  here regardless of provider.
- **The audit log** (`ActivityLog`).
- **The feature registry** (`src/lib/resources.ts`) — the single source of truth
  for what a plan grants.

The split is: **the provider sells the plan and stores the people; the registry
decides what any of it means.**

## Provider isolation

Two providers must never run at once. Five layers enforce that, and they are all
in place today even though one provider ships — they are what makes the second
one safe to add.

1. **One reader.** `src/lib/adapters/provider.ts` is the only module that reads
   the env var. Everything else asks it, so server and browser cannot disagree.
2. **Server: dynamic imports.** `getAuthAdapter()` reaches the chosen bundle
   through `await import()` inside a branch, so an unselected provider's module
   is never evaluated: its SDK never initialises and never opens a connection.
3. **Client: a build-time alias.** `@providers-active` and
   `@providers-active-actions` are resolved in `next.config.ts` to exactly one
   provider's module.

   This one was learned the hard way. A runtime `if` — even inside a *server*
   component — does **not** keep another provider out of the browser bundle,
   because Next's module graph is static: every statically imported
   `'use client'` module gets a chunk whether or not the branch ever renders it.
   Measured, both providers shipped, including ~46KB of a client SDK the build
   had not selected. The alias means the other provider's modules never enter
   the graph at all.

   If you add a provider-specific UI module, register it in the `active.*`
   modules rather than importing it behind a branch — a branch will silently
   ship both. Verify with a production build: grep the client chunks for the
   inactive provider's SDK and expect **0 files**.
4. **Lint.** `no-restricted-imports` blocks importing `better-auth` outside
   `src/lib/better-auth/**`, `src/lib/adapters/better-auth/**` and
   `src/components/global/providers/better-auth/**`. Add a group per provider SDK
   you introduce, so a later edit cannot quietly reintroduce the coupling.
5. **Runtime assert.** Each provider bundle calls `assertProviderActive()` at
   module scope, and an inactive provider's API routes return 404 — see the
   `IS_ACTIVE` guard in `src/app/api/auth/[...all]/route.ts`.

## Capabilities: declare, don't assume

Providers are not feature-equivalent. Each adapter declares the differences the
app actually branches on — and **only** those:

```ts
capabilities: {
  ownershipTransfer: true,       // a single transferable owner exists
  providerInvitations: false,    // THIS APP sends and accepts invites
  appManagedOrganizations: true, // THIS APP writes the tenant record
}
```

Those are Better Auth's values. A hosted provider typically inverts all three:
many equal admins and no single owner, its own invitation emails, and its own
tenant records. Declaring the difference is what stops the app shipping a dead
button — an ownership-transfer card that cannot work, or an accept-invitation
route with nothing to accept.

An earlier version also declared which hosted UI each provider ships
(`hostedAuthUI`, `hostedOrgSwitcher`, …). Nothing ever read them: the
`@providers-active` alias already resolves to the provider's UI, so there is
nothing to ask. Flags nobody reads are config that rots — add one back when it
has a consumer, not before.

The UI hides what cannot work (`useProviderCapabilities()`). Hiding a control is
never a security boundary — every real check still runs in `protectedProcedure`.

## The UI layer

Screens import **wrappers** from the SERVER barrel, never a provider's component:

```tsx
import { OrgSwitcher, UserMenu, AuthScreen, MemberManagement } from '@/components/global/providers/server'
```

`server.tsx` has no `'use client'`, so the surfaces render on the server with no
lazy chunk — the shell paints on first byte, which is how the rest of this
template already behaves.

Client components (`AppSidebar`, `TeamClient`, the portal sidebar) receive the
surfaces as **props or children** from a server parent, e.g.
`<AppSidebar orgSwitcher={<OrgSwitcher />} userMenu={<UserMenu />} />`. A client
component that imported the wrappers directly would pull every provider back
into the browser bundle.

Surfaces take **no props**: each resolves its own organization, so a server
parent can render one without threading tenant state through the tree.

When you add a hosted provider, use **its own components** for credential and
billing flows — sign-in, MFA, sessions, checkout. Reimplementing those against a
provider's API is strictly worse than using the ones it maintains. Theme them
with the app's CSS custom properties so they follow the app theme.

### The Teams page

There is **one** Teams UI, and every provider uses it unchanged.

Two wrong turns were taken before landing here, both worth recording, because
both are the tempting move when a hosted provider offers a ready-made screen:
embedding the provider's own organization-profile component dropped a foreign
settings modal into the page, and rebuilding the screen against the provider's
hooks produced a lookalike that drifted from the real design.

The fix belongs one layer down: `member.list`, `member.update` and
`member.delete` resolve through `TenancyAdapter.listMembers` /
`updateMemberRole` / `removeMember`. Each provider normalises its roster to
`AdapterMemberRow`, so the router returns an identical payload and the app's
components — member list, sheets, role builder, permission switches — work as-is.

Under a provider with a fixed role set, map through the app's vocabulary: the
app's full-access role becomes the provider's built-in admin role, everything
else becomes its member role, and what a member may actually DO still comes from
`OrganizationRole`. Never create custom roles in the provider — the per-instance
cap makes that a dead end.

Inviting works the same way: `invitation.create` / `.cancel` / `.resend` are
adapter-backed, so the app's own **Invite member** button on the Teams page
issues the invite under every provider. Do not hide it for a provider that has
its own invite modal — that buries inviting inside a switcher popover, three
clicks from the page that is actually about people.

**Rule:** if a screen looks different per provider, the branch is probably in the
wrong place. Push it into the adapter and keep one UI.

### Organization settings

`/dashboard/settings/organization` is the app's own screen under **every**
provider, built from `SettingsSection` like the billing page — Profile (name,
logo) and a Danger Zone (leave / delete). There is no provider seam: every write
goes through `TenancyAdapter.updateOrganization` / `deleteOrganization` /
`leaveOrganization`.

Owners see **Delete**, non-owners see **Leave**, never both — an owner leaving
would orphan the tenant, and ownership transfer does not exist under every
provider.

For provider-only organization features — verified domains, enterprise SSO —
there is an **Advanced** section at the bottom of the page,
`OrganizationAdvanced` from the server barrel. That is the single,
clearly-labelled place where the app hands over to a provider, rather than a
second entry point competing with the app's own screen. Better Auth renders null
there, so the page mounts it with no capability check.

Members are NOT shown there — the Teams page owns people. Bundling both is what
made Teams look like a foreign screen the first time round.

## Provider components bypass tRPC by construction

Worth understanding before you add a hosted provider. `protectedProcedure`
protects DATA, and that covers every page whose content arrives through tRPC — an
unauthorized visitor gets an empty shell and nothing sensitive.

It does **not** cover a page that renders a provider-hosted component. Those
fetch their own data from the provider in the browser using a publishable key.
They never touch tRPC, so the procedure factory is not in the path. Pasting
`/dashboard/settings/billing` therefore showed the plans to a member without
`billing:read`. Nothing bypassed the gate — the content never went through it.

The fix is at the route level, in `src/app/(dashboard)/layout.tsx`, driven by the
SAME registry declaration the sidebar uses to hide the link
(`nav.requirePermission` / `nav.requireFlag`). One check, one place: adding a page
with a `nav` entry gates it automatically, with no per-page function to remember.
A per-page guard helper was written and thrown away — it would have meant a new
call site for every feature, which is precisely what the registry exists to
avoid.

## Feature gates: keep entitlements in the registry

Hosted billing products invite you to define **Features** on a Plan and gate on
them (`has({ feature })` and friends). This app deliberately does **not** read
them, whichever provider is selected. That is a decision, not an oversight, and
it is worth understanding before you configure anything in a provider dashboard.

**How gating actually works here.** `RESOURCES` declares the limit or flag per
plan. `getOrganizationTier()` asks the `EntitlementAdapter` which plan the
organization is on. `protectedProcedure` then enforces it with no per-procedure
opt-in: a limit check on `<resource>.create`, a flag check on every verb of a
flag resource. `<FeatureGate>` reads the same computation for UX.

So the provider supplies **which plan**. The registry decides **what that plan
grants**.

**Why not provider Features:**

| | Registry | Provider Features |
| --- | --- | --- |
| Numeric quotas (`storage`, `apiCalls`) | Yes | **No — booleans only** |
| Survives a provider swap | Yes | No |
| In version control, type-checked, reviewable | Yes | No — dashboard state |
| Change entitlements without a deploy | No | Yes |

The numeric-quota row is decisive: most of this template's gates are counted, not
boolean, so provider Features could only ever cover a fraction of them. Reading
both would give two answers to "what does this plan grant" — the exact
dual-source-of-truth this architecture exists to prevent.

The genuine advantage on the other side is dashboard-editable entitlements with
no deploy. If that matters more to you than portability and type safety, invert
the ownership deliberately — don't split it.

**If you do wire a provider's plans up,** the plan identifier is a contract: the
provider's plan `slug` (or equivalent) must equal a `PlanKey` from
`src/lib/config/plans.ts`, because the adapter reads it and looks the limits up
in `RESOURCES`. Log a development warning when a plan declares Features with no
matching flag resource — a silent mismatch is otherwise very hard to find.

## Downgrades are guarded by the app, not the provider

`DOWNGRADE_REQUIRES_CLEANUP`: a tenant using more than a cheaper plan allows
cannot be allowed to land on it. Once the downgrade lands, nothing is deleted,
new creates are refused by `protectedProcedure`, and there is no lever to
recover. Deferring the change to the period end only relocates the problem.

Enforcement is **server-side**, in `billing.upgradeOrganization`
(`ensureDowngradeIsSafe`), before any billing write. `<ChangePlanDialog />` reads
the same blockers through `usage.getDowngradeBlockerMap` so a blocked plan is
marked on its own card and the reason is listed before the user spends a click.
Over-cap usage blocks; losing a flag feature is disclosed but does **not** block,
because deleting things cannot fix it and treating it as a blocker would trap a
customer on a plan they want to leave.

Two lessons carry over to any provider you add:

- **If the provider owns the checkout UI, you cannot intercept it reliably.**
  A DOM-level click guard on a provider's pricing table has to decide
  synchronously — `preventDefault()` after an `await` is a no-op — and it breaks
  whenever the provider's markup changes. Prefer the app's own plan-change
  surface, where the check is a plain `await`.
- **Enforce on the outcome as well as the cause.** A plan can change from a
  provider dashboard, a webhook replay, or a support action. `getPlanOverages`
  and `<PlanOverageBanner />` detect the *state* rather than the route into it,
  so the tenant is always told what to reduce.

## Adding a provider

1. Add its id to `AUTH_PROVIDER_IDS` in `src/lib/adapters/types.ts`.
2. Create `src/lib/adapters/<provider>/index.ts` exporting an `AuthAdapter`, and
   add the `case` in `loadAdapter()` in `src/lib/adapters/index.ts`.
3. Create `src/components/global/providers/active.<provider>.tsx` exporting the
   same surface shape as `active.better-auth.tsx`, plus
   `src/components/global/providers/<provider>/actions.ts`.
4. Branch both aliases on the env var in `next.config.ts`.
5. Add its entry to `CLIENT_CAPABILITIES` in
   `src/lib/adapters/capabilities.client.ts`.
6. Add its SDK to the `no-restricted-imports` groups in `eslint.config.mjs`, and
   its own folders to the override that lifts the restriction.
7. Add its required env vars to `REQUIRED_ENV` in
   `src/lib/config/required-env.ts` with a `when: () => AUTH_PROVIDER === '<id>'`
   predicate, and any optional integrations to `OPTIONAL_ENV` with
   `whenProvider`.

TypeScript will not compile until steps 1–5 are done — which is the point.

**If the provider owns the tenant record** (`appManagedOrganizations: false`),
mirror its users and organizations into the local `User` / `Organization` /
`Member` tables. That is not a second source of truth: `UsageMetrics`,
`ActivityLog` and `OrganizationRole` all carry foreign keys to `Organization`, so
without a mirror row the first usage bump fails. Creates and updates can mirror
on read; **deletes require a webhook**, because a read can never observe
something that stopped existing.

**If the provider requires middleware,** wrap `appProxy` in `src/proxy.ts`
through a dynamic `import()` inside a branch on `AUTH_PROVIDER` — never a static
import. The proxy ships to the edge runtime on every request, so a statically
imported SDK is paid for whether or not it is selected.

## Switching is not a migration

Changing the env var does **not** move accounts between providers. Users who
signed up under one provider do not exist in the other. Switch on a fresh
database, or migrate accounts deliberately.
