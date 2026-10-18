# Changelog

All notable changes to the Architectural Guardrail Starter Kit are recorded here.
Versions follow [Semantic Versioning](https://semver.org/).

---

## v2.0.0 — 2026-08-19

Two foundations changed. **Auth, organizations and billing now sit behind a contract**,
so your provider is a decision you can revisit instead of a rewrite you can't afford.
And **the upgrade path became a real product surface** — a full pricing experience that
opens itself whenever a customer hits a wall.

Ships on Better Auth + Prisma + Stripe, fully self-hosted.

### Billing & upgrades

- **Fullscreen upgrade modal**, mounted once for the whole app — plan cards, feature
  comparison, payment, success. Opens from anywhere, so a feature you add tomorrow gets
  it for free.
- **Opens itself when the server says no.** A request refused for plan reasons shows the
  upgrade screen, not a red error toast.
- **Names what the customer hit** — "Upgrade to Pro to invite more teammates" — written
  once on the resource, with the next plan filled in automatically. That feature is
  highlighted in the comparison table.
- **Prices from Stripe, features from your registry.** No amount is typed into the
  codebase. No plan can advertise what the gates would refuse.
- **Sidebar nudge** above the profile: a card for free plans and trials, one muted line
  for paying customers (next tier, or the yearly discount with real money saved).
  Disappears entirely on the top plan billed yearly.
- **Over-plan banner.** If an organization exceeds its plan — however it got there,
  including a change made in Stripe — every page says so and lists what must come down.
- **Downgrades are refused until the tenant fits**, in the UI and on the server. Losing a
  feature is disclosed, not blocked.
- **Honest trials.** A used trial is never advertised again. A trial converts to the plan
  being trialled, not a tier above it.

### Teams, roles & invitations

- **Roles and permissions are app-owned**, not the provider's — so per-tenant custom roles
  survive a provider change.
- **Invitation links work.** Invitees land on the invite, sign in, and return to the right
  place instead of a blank sign-in.
- **Copy a pending invite's link** from the roster menu.

### Auth & onboarding

- **One surface for every auth screen** — sign in, sign up, forgot/reset password, invite
  accept — with a shared error banner.
- **Signed-out visitors are never redirected away** from pages built for them.
- **Onboarding creates the org through the adapter**, so no duplicate or half-made
  workspaces.
- Auth screens return you to where you were headed.

### Audit logs

- **Working toolbar**: search plus action and entity filters, with Clear.
- **Filter options come from your own data**, so a dropdown never offers a filter that
  returns nothing.

### Look & feel

- Shared page container and header — every page centred and capped the same way.
- Fixed-height sidebar placeholders; no jump as data loads.
- A `success` colour token for positive states, so nothing reaches for a raw green.
- Plan cards cap at a readable width and the grid centres itself — two plans and four
  plans both look deliberate.

### License — new terms ship with this release

**This codebase is now under a new license.** Earlier copies went out under the MIT
license. That license does not apply here. This release, and every version after it, is
governed by the **Architectural Guardrail Community License** — see `LICENSE` in the repo
root. Read it before you build on this version.

What it means in practice:

- **Build anything.** Unlimited products, SaaS you charge for, client and agency work. No
  attribution required, no equity, no cut.
- **Don't hand the code on.** No selling, sublicensing, publishing, redistributing, or
  repackaging the Software or a substantial part of it.
- **Access is tied to your membership or purchase**, is non-transferable, and stays
  private — real access controls, NDAs for anyone you let in.
- **No warranty, no liability.** Provided as-is. That covers defects in code we wrote, in
  updates we publish, and in third-party dependencies. You decide what to install and what
  to ship.

### Under the hood

- **Provider adapter layer** — identity, tenancy and entitlement behind one typed contract
  (`src/lib/adapters/types.ts`). Adding a provider is four additions the compiler enforces.
- **Providers never run side by side.** The unselected provider isn't imported, its SDK
  never initialises, and an eslint rule blocks importing a provider SDK outside its folder.
  The active provider's UI is aliased in at build time; the other ships zero bytes.
- **Server-rendered provider surfaces**, removing the sidebar and settings hydration flash.
- **Upgrade state is prefetched**, so the upgrade screen paints its final content in one
  frame instead of correcting itself.
- Plan prices cached process-wide for five minutes.
- New docs: `docs/09-providers-and-adapters.md`, plus updates across the existing set.

### Upgrading

1. `npm install` — three new dependencies (`framer-motion`, `canvas-confetti`,
   `@types/canvas-confetti`).
2. New keys in `.env.example`:
   - `NEXT_PUBLIC_AUTH_PROVIDER` — defaults to `better-auth` when unset.
   - `NEXT_PUBLIC_*_DESCRIPTION` — the line under each plan name on the pricing cards.
     Optional; defaults ship.
3. **No database migration.** The Prisma schema is unchanged.
4. Nothing to do for existing accounts — the provider variable selects a provider, it does
   not migrate users between them.

---

## AI migration notes

For an agent diffing the previous codebase against this one. Everything is grep-able via
the `SOURCE OF TRUTH KEYWORDS` line at the top of each file and block.

**Read first, in order:** `src/lib/adapters/types.ts` → `src/lib/resources.ts` →
`src/trpc/procedures/protected.ts` → `docs/09-providers-and-adapters.md`.

**Moved or renamed:**

| Was | Now |
| --- | --- |
| `lib/better-auth/permissions.ts`, `permission-helpers.ts` | `lib/permissions/index.ts` (app vocabulary) + `lib/better-auth/access-control.ts` (provider translation) |
| `components/global/auth/auth-form.tsx`, forgot/reset forms | `components/global/providers/better-auth/*` |
| `components/global/sidebar/team-switcher.tsx` | `components/global/providers/better-auth/org-switcher.tsx` |
| `components/global/sidebar/nav-user.tsx` | `components/global/providers/better-auth/user-menu.tsx` |
| `components/upgrade-modal.tsx` | `components/global/upgrade-modal/` |
| `components/global/billing/change-plan-dialog.tsx` | deleted — the upgrade modal handles both directions |

**Deleted, no direct replacement:** the change-plan dialog and the old upgrade modal.
Anything that opened either now calls `useUpgradeModal().open()`.

**New source-of-truth modules:**

- `lib/adapters/*` — contract (`types.ts`), selector (`provider.ts`, `PROVIDER_ISOLATION`),
  Better Auth translator.
- `lib/permissions/index.ts` — every `resource:action` constant, list ⇄ statement-map.
- `lib/types/audit.ts` — audit toolbar contract.
- `components/global/upgrade-modal/*` — `useUpgradeModal`, `useUpgradeNudge`, `PricingCard`,
  `FeatureComparisonTable`, `getYearlySavings`.
- `components/global/page-container/*` — the page width scale.

**New registry helpers** (`lib/resources.ts`, all derived — don't duplicate):
`getPlanFeatureRows`, `getFeatureCategories`, `getUpgradeMessage`, `formatLimitAmount`,
`formatLimitNoun`, `getPlanFeatureList`, `getAuditEntityLabel`. Plus optional `category` on
a resource and optional `upgradeMessage` on a flag.

**New tRPC procedures:** `billing.getAvailablePlans`, `billing.getTrialEligibility` (both
`authProcedure`, not org-scoped), `usage.getDowngradeBlockers`,
`usage.getDowngradeBlockerMap`, `usage.getPlanOverages`.

**Changed contracts — check every call site:**

- `FeatureGateData` gained `upgradeMessage`.
- `checkBooleanFeature` returns `{ enabled, plan, upgradeMessage }`, not a boolean.
- `checkFeatureGate`'s result gained `plan` and `upgradeMessage`.
- `USAGE_LIMIT_REACHED` / `FEATURE_NOT_AVAILABLE` errors gained `upgradeMessage` and a typed
  `currentPlan`; `resource` is a `ResourceKey`, not a `string`.
- `src/proxy.ts` splits into `appProxy` (app logic) and exported `proxy` — a provider
  needing middleware wraps the latter.

**Now fails the build:**

- Importing a provider SDK outside `lib/better-auth/**`, `lib/adapters/better-auth/**`, or
  `components/global/providers/better-auth/**`.
- Adding a plan or limit/flag resource without every `perPlan` entry.
- A mutation whose path isn't `<resource>.<verb>` and declares no explicit options.

**Conventions:** limits and flags are declared once in `lib/resources.ts` and enforced by
`protectedProcedure` — never re-check them in a router. Prices live in Stripe; caps, flags
and copy live in the registry; visual and textual identity lives in `BRANDING`. If you're
typing a plan name, price, or limit into a component, the value already exists above you.
