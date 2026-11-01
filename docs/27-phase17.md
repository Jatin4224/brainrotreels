<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 17 — the platform surface (17a)

The phase opens the product three ways: prompt-to-video footage, a public REST
API, and an MCP server so agents can use it. **This document covers 17a, the
shared operation seam** — the commit the other two surfaces sit on and the one
where a mistake is invisible.

Nothing customer-facing changed. There is no new route, no key, no tool, no
footage. What changed is where the business logic of seven verbs lives, and the
answer is now "one place, called by whoever asks".

**The one decision to read if you read nothing else:** an operation does the
work and **reports what happened**; the surface decides what that costs. The
temptation is to move the metering inside too, so that "everything is in one
place". That would be wrong on at least one surface and silently — the section
on the render counter explains why.

## Why this is 17a and not a refactor nobody asked for

The phase file's step 10 says to share the handlers "genuinely", and its
done-when is unusually direct:

> A rule changed in an operation function changes behaviour on web, REST and
> MCP at once.

It then names the failure mode: *"If the REST route reimplements a rule, the
surfaces have already drifted."*

That is worth taking seriously because of how it fails. A REST route that
re-derives one rule — which resolutions a plan allows, when a render is reused,
what a script costs — compiles, passes its own tests, and returns plausible
answers. Nothing is red. The drift only shows up as a support ticket from a
customer whose API client was charged for a render the dashboard gave away free.

So the logic moved first, before any surface existed to drift from.

## Where the code lives

| Path | Contains | Touches the database? |
| --- | --- | --- |
| `src/lib/types/api.ts` | `OperationContext` — what every operation is handed | **no** |
| `src/lib/errors/index.ts` | `OPERATION_FAILURES`, `OperationError`, `isOperationError` | **no** |
| `src/lib/api/operations/` | the seven verbs, as plain async functions | **no** — services only |
| `src/trpc/operation-context.ts` | `runOperation` — the web app's adapter into the seam | no |
| `src/trpc/operation-error.ts` | the one table turning a failure into a tRPC code | **no** |
| `src/services/projects.service.ts` | `createProject`, `recordScriptSource` — writes that used to be inline in routers | **yes** |
| `src/services/voices.service.ts` | `findSpeaker` — a read that used to be inline | **yes** |

**No migration, no registry entry, no new permission.** 17a adds no stored
data and gates nothing: `apiKeys`, `apiAccess` and `aiFootage` arrive with the
commits that need them. `apiCalls` already sits in the registry as a declared
quota with no producer, and the phase file is explicit that 17b is its producer
— do not add a second one.

## The seven verbs, and why only seven

`create_project`, `generate_script`, `assign_voices`, `start_render`,
`get_render`, `fetch_output`, and the catalogue reads. That list is the phase
file's REST routes and its MCP tools, and they match exactly, which is a useful
sign that the boundary was chosen rather than accumulated.

It is a small fraction of what the product does. The web app has over a hundred
procedures; a public API exposing all of them would be a promise to keep every
one of them stable forever, for the sake of verbs no agent has asked for. These
seven are the ones that get from nothing to a finished MP4.

## An operation never throws a `TRPCError`

The piece most likely to be got wrong later, so it is enforced rather than
documented.

Operations throw `OperationError`, which carries one of **six situations**:
`not_found`, `invalid`, `precondition`, `refused`, `unprocessable`, `conflict`.
These are not status codes — they are descriptions of what went wrong. Each
transport owns exactly one table turning them into its own vocabulary, and
`src/trpc/operation-error.ts` is that table for the web app.

If operations threw tRPC errors, every other surface would be reading tRPC's
status vocabulary and translating it. The REST layer would be re-deciding what
`PRECONDITION_FAILED` means as an HTTP status, and the MCP layer would be
guessing again.

### The table is total, on purpose

It is a `Record` over the whole union, not a `switch` with a default. A seventh
situation is therefore a **compile error in every surface's table**. A default
branch would instead map it to a 500 on whichever surface nobody remembered to
update — which is precisely the silent drift this phase is about.

The pairings are a product decision and each has a consequence for the caller:

- `invalid` → `BAD_REQUEST`: change what you sent.
- `unprocessable` → `UNPROCESSABLE_CONTENT`: the input was fine, retrying is
  pointless. A timeline this build cannot open is this, not `invalid`.
- `precondition` → `PRECONDITION_FAILED`: do something else first. *"Generate a
  timeline before rendering"* is an instruction, not a bad request.
- `refused` → `FORBIDDEN`, whether the reason is policy or money, because the
  distinction a client acts on lives in the payload rather than the status.

A test asserts all six pairings, because a swap of `invalid` and
`unprocessable` type-checks perfectly and changes what a client does about it.

### The structured payload is reused, not reinvented

`OperationError.detail` is the existing `StructuredErrorCause`. So a workspace
that cannot afford a render still gets `required` and `available` on the error
and still sees the top-up prompt, through whichever transport asked. Inventing
a second payload shape would have meant two things to keep in step and a
client-side switch per surface.

One trap, written down because 17b will meet it: tRPC **wraps** a cause that is
not an `Error` in an `UnknownCauseError` and copies the fields onto it. Every
field survives and the client reads fields, so this has worked since Phase 00 —
but a REST handler should read `OperationError.detail` *before* translation,
where it is still the plain object.

## The context is explicit, because two of three callers have no session

`OperationContext` is `{ organizationId, plan, userId, db, requestId }` and
every field is passed in. Nothing is read from `headers()`, a session, or a
module singleton — an MCP tool call and a key-authenticated REST request have
no cookie and no session, so an operation that reached for ambient state would
work on exactly one surface.

Three details worth keeping:

**`plan` is for pricing, never for access.** Operations decide which
resolutions are available and what a render costs. Whether this workspace may
render *at all* was decided before the context existed — by the procedure
factory on the web, by the key middleware on REST. An operation that also
checked would run the gate twice on one surface and make it look optional on
the other.

**`userId` is nullable, and that is load-bearing.** A key-authenticated call has
an organization and no human. That has to survive into the audit row; a
fabricated id would attribute a script to whoever created the key months
earlier. Nothing may branch on it being present.

**`db` is a `DbClient`, so a caller can pass its transaction.** Inside a tRPC
mutation `ctx.db` *is* the transaction, and passing it through is what keeps an
operation's writes rolling back with its caller — and keeps the factory's usage
bump committing atomically with the work. An operation that imported `prisma`
itself would quietly escape that.

### The plan lookup is free

The obvious objection: `runOperation` resolves the tier, so is that an extra
round trip per call? No. `getOrganizationTier` is wrapped in React's `cache()`,
and the procedure factory has already run its gates by then, so it is a cache
hit. It also *removes* the lookup each handler used to make for itself.

## `runOperation`, because a forgotten `catch` is invisible

Each procedure needs the same context build and the same `toTRPCError` around
the call. Seven copies of that is seven chances to omit the catch — and a
procedure that omitted it would compile, pass review, and work perfectly until
an operation refused something. Then the customer would get a 500 and a stack
trace instead of "not enough credits", with no failing test, because the happy
path is identical.

So the two halves are welded together and there is no supported way to do one
without the other. The same argument that puts the gates in the procedure
factory rather than trusting each handler to call them.

## The render counter, and why metering stayed in the router

The most interesting thing in this commit, and the reason "move everything into
the operation" is the wrong instinct.

A render of a document already rendered at this resolution returns the existing
row and must not spend a slot from the monthly `renders` quota —
`REUSE_COSTS_NOTHING`. On the web that is not simply *"don't increment"*: the
procedure factory **auto-increments** on any successful `<resource>.create` and
cannot see that the handler reused a row. So the router posts a compensating
`-1`, which nets to zero inside the same transaction.

That compensation is **knowledge about the web surface's pipeline**, not about
rendering. The operation has no way to know whether a `+1` is coming. The REST
surface will meter explicitly and no `+1` will be coming — so the same `-1`
there would hand out free renders.

Hence the split: **the operation reports `reused`, and each surface meters.**
An operation that tried to meter would be wrong on at least one surface, and
wrong in the direction nobody notices, because an uncharged render looks exactly
like a working one.

## The catalogues share a rule, not a shape

`voices.list` and `captions.styles` now *are* their operations — the web app's
shape and the API's are the same, so there is one implementation.

Backgrounds are different, and this is the one place a surface keeps its own
projection. The picker needs signed thumbnails, a breadth cursor and the
project's current selection: several more queries and tens of kilobytes of URLs
that an agent choosing an id has no use for. Forcing one shape would either make
the picker worse or make every agent download a gallery.

So `listBackgroundCatalogOperation` is a leaner projection, and what it shares
with the picker is the thing that matters: the availability decision, through
the same `backgroundAvailableOnPlan` and `isWithinBreadth` that the picker and
the write refusal already use. A rule change lands in one place; only the field
list differs.

### `LOCKED_NOT_HIDDEN` survives onto the API

A catalogue never hides what a workspace cannot have. It returns the row with
`locked: true` and the registry's own upgrade sentence, so the web app shows a
padlock and an agent can tell a person what upgrading would buy. Filtering
would make the product look smaller than it is, on every surface at once.

Availability is `withinPlan AND flag`, and both halves are needed: the plan
comparison answers "is this row above my tier", and the boolean flag is what a
**free trial** turns off wholesale regardless of tier. They are computed in one
expression so they cannot drift — the specific bug otherwise is a trial user
shown a premium voice unlocked, selecting it, and being refused on assignment.

## Three writes moved into the service layer

Extracting the operations surfaced three places where a router held a Prisma
handle and used it: `projects.create` called `ctx.db.project.create`,
`scripts.generate` called `ctx.db.project.update`, and `voices.assign` called
`ctx.db.speaker.findFirst`.

That was legal while the router was the only caller. It is not legal for an
operation — `src/lib/api/operations/` is not the service layer (CLAUDE.md rule
3) — so each became a service function: `createProject`, `recordScriptSource`,
`findSpeaker`.

`recordScriptSource` is the one with a rule in it. It reads, merges and writes
`Project.settings` rather than assigning, because that column holds every
feature's configuration — captions, generate, motion — and replacing the object
would silently drop a customer's caption choice the first time they generated a
script. It also returns whether a row matched, so a project deleted *while we
were fetching its source* is a clean refusal instead of a job queued for a
project that no longer exists.

## Behaviour that deliberately did not change

Every ordering decision in the extracted handlers was preserved, and each one is
load-bearing:

- **Reuse is checked before credits.** A render that costs nothing must not be
  refused for lack of credits — the customer already paid for that file.
- **Credits are checked before the row.** A refusal must leave no trace; a
  queued `Render` that was never affordable shows in the panel as a render
  about to start that never will.
- **Credits are checked before the fetch**, in the script path, so a workspace
  with no credits is not made to wait for a download it cannot use.
- **The watermark is resolved at request time**, not in the workflow, because it
  is part of the cache key: resolving it later would let a workspace that
  upgraded mid-queue receive the watermarked render it had paid to replace.
- **`scriptCostFor` is one function**, now exported from the operation that
  prices the verb, so the button's number, the refusal's number and the
  workflow's hold are provably the same.

## What 17b and 17c inherit

The seam is ready; both remaining commits are additive.

**17b must supply, and must not re-derive:** a Bearer key translated into an
`OperationContext`, and the same `checkFeatureGate` / limit / credit calls the
procedure factory applies — called, not reimplemented. Plus its own total
failure→HTTP table, `Idempotency-Key`, cursor pagination, 429 with a reset
hint, quotas shared per organization in Redis, and the OpenAPI document
generated from the Zod schemas.

**17c is thin if 17a was done properly:** seven tools over the same seven
functions, structured JSON plus a one-line human summary, and tool descriptions
that say a client disconnect never cancels server-side work — because the work
lives in Inngest and an agent must not retry a render it already started.

## What has never run

The same honest answer as every phase since 02, and it applies to this commit
in a specific way: **the extraction is only exercised through the web app's own
procedures**, which are themselves blocked on the credentials gap.

- `tsc` clean, lint clean, **1373 tests passing** (11 new, all on the failure
  vocabulary and its translation).
- The error table, the `OperationError` payload round trip, and the
  rethrow-what-is-not-ours rule are **genuinely verified**.
- The operations themselves are verified only to the extent their own pure
  rules already were — pricing, timeline validation, availability — because
  nothing here can run against a database. No test calls
  `createRenderOperation`; there is no DB fixture in this repo and inventing one
  for a seam whose job is delegation would test the stub.
- **Nothing has gone through a second surface**, because no second surface
  exists yet. The promise that one rule change lands everywhere is, today, a
  property of the code's shape rather than an observed fact. 17b is the first
  time it can be demonstrated.
