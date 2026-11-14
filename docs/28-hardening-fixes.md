<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Hardening fixes — 2026-11-14

Not a phase. This is a log of six correctness and security fixes applied across
the existing phases, written so the next person can tell what moved and why
without reading four commits.

Each entry says what was broken, what it cost, and what to grep for.

**Commits:** `4791d46`, `30578e0`, `28832c3`, `10addc7` on
`fix/render-metadata-sanitised-doc`.

**Verified at the time of writing:** `tsc --noEmit` clean, `eslint` clean,
1571 tests in 88 files passing, `next build` passing with 46 routes.

---

## 1. A render could be billed and come out one second long

**Grep:** `SANITISE_BEFORE_BOTH_PARSES`, `compositionMetadataFor`

The timeline document was parsed in **two** places that had to agree and did
not.

`TimelineRenderer` is deliberately forgiving: a document written by a newer
release can carry a `render` kind this build has never heard of, so it calls
`dropUnknownRenderKinds` first and parses the result
(`FORWARD_COMPATIBLE_DOCUMENT`). That is the whole point of the sanitiser — one
unrecognised overlay must not turn a paid video black.

`metadataFromProps` — the `calculateMetadata` hook that decides the composition's
frame count — parsed the **raw** document instead. `timelineDocSchema` is
`.strict()` with a closed render-kind enum, so one unknown item failed that parse,
and the hook fell back to its 30-frame default while the component drew the full
document.

The result: the render **succeeded**, was **billed**, and was **one second long**.
Nothing logged a problem. The only symptom was the file.

### What changed

The derivation moved out of `src/remotion/root.tsx` into a new pure module:

- `src/lib/render/metadata.ts` — `compositionMetadataFor(doc: unknown)`, which
  sanitises, parses, then plans, in that order
- `src/remotion/root.tsx` — now only a three-line adapter to the shape Remotion's
  `calculateMetadata` prop expects

It moved for a reason worth keeping in mind: `root.tsx` imports Remotion
components, so it cannot be unit-tested without a browser. **That is why this bug
was never caught.** The logic now sits beside `planComposition` and
`dropUnknownRenderKinds`, the two functions it must stay in lockstep with, and
has tests.

Also in this commit: the hardcoded `1080x1920 @ 30` fallback now reads from the
existing `CANVAS_BY_ASPECT["9:16"]` source of truth, and the sanitiser's `WHERE:`
comments were corrected — they named `TimelineRenderer` as the only caller, which
is plausibly how the two sides drifted apart in the first place.

### How it is held

`src/lib/render/metadata.test.ts`, 5 cases. The regression case was verified by
reintroducing the old behaviour and watching it fail — `228 frames -> 30`. One
case asserts the poisoned document genuinely fails a *raw* strict parse, so the
suite cannot silently stop guarding anything if the schema is ever loosened.
Others pin the fallback for `undefined`, `null`, a string and `{}`, because a
throw there is a Lambda render that spent its budget and produced nothing.

---

## 2. Privilege escalation: three ways to grant power you did not have

**Grep:** `A_GRANT_CANNOT_EXCEED_THE_GRANTER`, `PermissionGrantAuthority`,
`EVERY_BRANCH_IS_A_GRANT`, `YOU_CANNOT_EDIT_THE_ROLE_YOU_HOLD`

The RBAC system enforced `OWNER_IS_NEVER_ASSIGNABLE` — no request may assign the
owner role — but it had **no rule about ordinary permissions**. Nothing stopped a
caller assembling owner-equivalent power out of permissions they did not hold.

This mattered because the admin preset is wide: `ADMIN_PRESET_EXCLUDED` withholds
only `billing`, so an admin ships with `organizationRoles:update`,
`member:update` and `invitation:create`. None of the three paths below names an
owner, so none of them was refused.

| Path | How it worked |
|---|---|
| `organizationRoles.update` | Edit the role row **you yourself hold**, write `billing:*` into it, and the context resolver grants it on your next request. |
| `member.update` / `invitation.create` | Encode a permission set you do not hold and assign it — to a member, or to your own second email address. |
| **Plain role name** | Name an **existing** role that already holds more than you (`finance`, say) and assign it. No permission is encoded anywhere in the request. |

That third one was not in the audit that prompted this work. It was the quietest
of the three: the plain-name branch previously returned before touching the
database, so there was nothing to inspect.

### What changed

One invariant, stated once — **a grant can never exceed the granter**:

- `src/lib/permissions/index.ts` — `permissionsBeyondAuthority(requested, granter)`,
  pure, returns the over-reached permissions so a refusal can name them
- `src/lib/types/team.ts` — `PermissionGrantAuthority`, the caller's effective
  permissions plus the `hasFullAccess` flag
- `src/services/role.service.ts` — `processRole` now takes that authority as a
  **required** fourth argument and checks all three decode branches; the plain-name
  branch gained the lookup the others do not need
- `src/trpc/routers/organization-roles.ts` — the same check on `create` and
  `update`, plus a refusal to edit the role row the caller holds
- `src/lib/adapters/types.ts`, `src/lib/adapters/better-auth/membership.ts` —
  `granter` threaded through `inviteMember` and `updateMemberRole`
- `src/trpc/routers/member.ts`, `invitation.ts` — supply it from `ctx`
- `src/trpc/role-error.ts` — maps the new `PermissionEscalationError` to
  `FORBIDDEN`

### Three decisions a reader should not have to re-derive

**`granter` is required, not optional.** An optional parameter defaulting to
"unrestricted" makes the insecure call the easy one to write. A new caller now
cannot compile without stating whose authority the grant is made under.

**The self-edit check runs *before* the authority comparison.** Against your own
role row that comparison can never refuse anything useful — the permissions you
are adding are measured against the row that is about to define them, so every
self-grant looks legitimate one request later. `member.update` already locked a
caller out of their own membership row; this is the same rule for the role that
row points at.

**`hasFullAccess` is consulted before the permission list.** The procedure
factory resolves a full-access member's permissions to an **empty array** as a
deliberate optimisation — the gate never reads it. Treating that as "holds
nothing" would lock owners out of role management entirely. There is a test
pinning this, because it is the obvious wrong fix.

### How it is held

7 new cases in `src/services/role.service.test.ts`, one per branch plus the
owner-sentinel case and the precedence of `UnknownPermissionError` over
escalation. **The `organizationRoles` self-edit guard has no test** — this repo
has no router tests at all, and standing up that harness is its own task. It is
verified by reading only.

---

## 3. The captions router's rate limits never fired

**Grep:** `captionStyles`, `getResourceFromPath`

The router was mounted as `captions` while its registry key is `captionStyles`.
`getResourceFromPath` is a plain lookup of the first path segment, so it resolved
to `null` and the procedure factory **silently skipped its entire per-resource
section**.

What was lost: `align: { count: 10, window: "5 m" }`. `captions.align` is a
full-narration STT round trip with a provider call per line. A client looping it
with `force: true` — which defeats both the cached short-circuit and the enqueue
idempotency key — ran up a real provider bill with only the global 100/10s
limiter in the way. The audit `describe` templates were dead for the same reason.

### What changed

`src/trpc/routers/_app.ts` now mounts `captionStyles: captionsRouter`, and the
five call sites in `caption-studio.tsx` were updated. Every other gated router
was already mounted under its registry key — `backgroundLibrary: backgroundsRouter`
is the nearest example — so this is now consistent rather than novel.

**If you add a gated router: the mount name must equal the registry key.** It is
not cosmetic; it is what wires limits, audit and usage.

---

## 4. Cancelled subscriptions kept their entitlements

**Grep:** `ENTITLED_SUBSCRIPTION_STATUSES`, `ENTITLED_STATUSES_ARE_AN_ALLOWLIST`

`getBetterAuthTier` read `subscription.status` for `trialing` and nothing else.
Every other status — `canceled`, `unpaid`, `incomplete`, `incomplete_expired` —
returned the **paid tier** for as long as `periodEnd` was in the future.
Entitlements were revoked only when `customer.subscription.deleted` eventually
arrived.

### What changed

`src/lib/types/billing.ts` declares `ENTITLED_SUBSCRIPTION_STATUSES`, checked in
`src/lib/adapters/better-auth/index.ts`.

It is an **allowlist**, so a status this code has never seen withholds a paid plan
rather than granting one. The Prisma column is a bare `String` with no enum block,
so that list is the only guard.

`past_due` **is** entitled, deliberately: the provider retries a failed charge for
days, and cutting off a customer whose card is about to succeed is the worse
error. `canceled` is excluded because nothing is still being attempted.

That is a business decision, which is why it is declared as data in `lib/types`
rather than as control flow in an adapter — change the array, not the resolver.
Any future provider's `getTier` should map its own statuses onto these.

---

## 5. The feature-gate decider was importable from the browser

**Grep:** `TYPES_LIVE_IN_LIB_TYPES`, `DowngradeBlocker`

`src/lib/feature-gate.ts` reads Prisma and decides every plan gate, and it had no
`import "server-only"` — the rule in CLAUDE.md §3 exists precisely so this cannot
be reached from a client bundle.

It could not be sealed, because the billing screen's client components import
`DowngradeBlocker` and `DowngradeBlockerMap` **from it**. The whole gate decider
stayed browser-importable to supply two types.

### What changed

The two types moved to `src/lib/types/billing.ts`, where CLAUDE.md §4 says types
belong, and are re-exported from the old path so no caller changed. `feature-gate.ts`
now has `import "server-only"`.

Note the re-export is `import type { … }` **plus** `export type { … }`, not
`export … from`: the latter creates no local binding, and the helpers in that file
annotate with these types.

The build passing is the proof nothing pulls the module into a client bundle at
runtime.

---

## 6. Client owners could not delete their own organization

**Grep:** `OWNER_ROLE_NAMES`

`organizationSettings.delete` declared `requireRole: ["owner"]` as a literal.
`OWNER_ROLE_NAMES` is `["owner", "client-owner"]` — a portal-created client owner
**is** an owner — so exactly those tenants were locked out of retiring their own
workspace. It was also the provider-coupled role-string comparison the docs tell
handlers not to write.

### What changed

`src/trpc/routers/organization-settings.ts` passes `OWNER_ROLE_NAMES`.

This needed two type widenings, both `string[]` -> `readonly string[]`, on values
that are only ever read and serialised:

- `requireRole` in `src/trpc/procedures/protected.ts`
- `required` on the `INSUFFICIENT_PERMISSIONS` payload in `src/lib/errors/index.ts`

Worth noting the mutable type is *why* the role names were inlined in the first
place. Widening it removes the incentive to repeat the mistake.

---

## 7. A bare project URL 404'd

**Grep:** `SCRIPT_IS_THE_FIRST_STEP`, `ProjectIndexPage`

`/dashboard/projects/<id>` had no page. The table's title cell, the create sheet
and `PROJECT_FLOW_STEPS` all agree a project opens at `/script`, but the bare id
was the one address that did not resolve.

`src/app/(dashboard)/dashboard/projects/[id]/page.tsx` redirects to `/script`,
mirroring `/dashboard/settings`, which redirects to its default tab.

Deliberately **not** a hub screen: three entry points already send people to the
same place and `ProjectSteps` is rendered on every step, so a hub would be a
fourth competing answer showing nothing the first step does not. It also does not
verify the project exists — the step page already renders the real
not-found/forbidden state.

---

## Deliberately not done

### `src/inngest/functions/hello.ts`

Flagged by an audit as a demo job violating CLAUDE.md §8 (no probe or tester
files in production). **Left in place**, because its own header argues the
opposite and is more convincing:

> WIRING_PROOF. Before any real pipeline exists there has to be one function that
> answers "does an event sent from the app actually reach a running workflow" —
> otherwise the first failure in Phase 09 is ambiguous between a broken pipeline
> and a broken connection. Keep it.

**No Inngest workflow in this app has ever executed.** That reasoning is at its
strongest right now, not its weakest.

If it is removed later, it is four files, not one: the function, its registration
in `src/inngest/functions/index.ts`, `'hello/requested'` in `JOB_EVENT_NAMES`
(`src/lib/adapters/jobs/types.ts`), and an assertion in
`src/lib/adapters/select-provider.test.ts`.

---

## One thing to know before using an old audit as a to-do list

This work started from a full-codebase review dated **2026-11-04**
(`Codebase review + plan to your first video.md` in the repo root).

Of the 14 blockers from that document that were re-checked against current code,
**12 were already fixed** — C1, C2, C4, C5, C6, C7, C11, A3, A4, A6, B4, and the
entire project-navigation complaint, which `ProjectSteps` had already solved.

Its remaining notes — C8 render robustness, C10's three infinite-polling
surfaces, and roughly ten smaller C12 items — were **not** re-verified and should
be checked against the code before anyone plans around them.

The durable tracker is `docs/phases/PROGRESS.md`, written against the real build
plan in `docs/phases/00-README.md`. The `features/*.md` files are banner-marked
superseded and describe a Turborepo/Drizzle monorepo that was never built.

## Still open after this work

The honest state is unchanged by these fixes: **the code is built through Phase 17
and almost none of it has ever executed.** No video has been generated end to end.
The test suite is entirely pure units — nothing touches Prisma, no provider is
ever called — so a green suite says nothing about the runtime paths.

Highest-value remaining engineering work, in order:

1. The public API (`/api/v1`, `/api/mcp`) writes **no audit rows** while the
   identical tRPC verbs always do, and API keys have **no scopes** — a leaked key
   is unconstrained and untraceable
2. Rate limiting **fails open** on a Redis error, including the per-key daily
   quota, which is the only throttle on `/api/v1`
3. The invite-member and manage-role forms use raw `useState` with no Zod or
   React Hook Form — the two privilege-granting write paths have the weakest
   validation in the app. The same pass should filter the permission toggles to
   what the caller actually holds, which fix 2 above now enforces server-side
4. `invitation.get` is public and returns an invitee's email and role to anyone
   holding an invitation id
5. Seat gates are check-then-act, so concurrent invites can exceed the plan cap

Zero test coverage remains on `src/trpc/procedures/protected.ts` — the documented
security heart — and on all 27 routers, ~27 of 30 services, and all 16 route
handlers.
