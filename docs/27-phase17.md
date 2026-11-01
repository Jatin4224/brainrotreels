<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 17 — the platform surface

The phase opens the product three ways: prompt-to-video footage, a public REST
API, and an MCP server so agents can use it. **All four commits are built** —
17a the shared operation seam, 17b the REST API, 17c the MCP server, 17d AI
footage.

17d was built against an **open owner decision**: which video model to ship,
and whether its terms permit commercial use. That decision is still open, and
the section on it below says exactly what was deferred because of it and what
has to be checked before the feature is enabled on a paying plan.

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

## What 17c inherited

It turned out to be exactly what the seam promised: no new gate, no new key
model, no new failure vocabulary, and no business logic of its own. The 17c
section below is mostly about the protocol, because that was the only part
left to decide.

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

---

# 17b — the public REST API

Seven endpoints, a credential, and the pipeline around them. Every endpoint
calls a 17a operation and adds nothing of its own, which is what makes the
phase's central promise checkable rather than merely intended.

## Where 17b's code lives

| Path | Contains | Touches the database? |
| --- | --- | --- |
| `prisma/schema.prisma` + migration | the `ApiKey` model | — |
| `src/lib/api/keys.ts` | the key FORMAT: mint, hash, prefix, shape test | **no** |
| `src/services/api-keys.service.ts` | the rows: create, list, revoke, verify, touch | **yes** |
| `src/trpc/routers/api-keys.ts` | `apiKeys.create` / `.list` / `.revoke` | via the service |
| `src/app/api/v1/_lib/envelope.ts` | the two response shapes, the failure→HTTP table | **no** |
| `src/app/api/v1/_lib/authenticate.ts` | Bearer → `OperationContext`, and the gates before it | via the service |
| `src/app/api/v1/_lib/idempotency.ts` | claim, replay, release | Redis only |
| `src/app/api/v1/_lib/handler.ts` | the one pipeline every route goes through | via services |
| `src/app/api/v1/**/route.ts` | nine route files, each naming a schema and an operation | no |
| `src/lib/api/openapi.ts` | the OpenAPI 3.1 document, generated from the Zod schemas | **no** |
| `src/lib/redis.ts` | the one Upstash client, moved up for a second consumer | — |
| `.../settings/developers/` | minting, listing, revoking, and the one-time reveal | via tRPC |

## A key is organization authority, and that is the decision to read first

A key is scoped to an **organization**, not a user, and carries no scopes. It
may do anything the seven public verbs do. Three consequences, stated here
rather than discovered later:

- **There is no permission check on an API request**, because there is no
  member whose role could be read. `userId` is null in the context, so audit
  rows attribute to the workspace rather than to whoever minted the key
  months ago — which is the honest answer, not a gap.
- **Minting is therefore the privileged act.** `apiKeys.create` is
  permissioned, rate limited at five an hour, and the UI is blunt about what
  a key can do.
- **Narrowing a key later is additive** — read-only keys, per-project keys —
  to this file and the model, not a redesign. It is deliberately absent: a
  scope system nobody has asked for would be guesswork about which
  combinations matter.

### Why not the Better Auth apiKey plugin

The phase file recommends against it and the reasons hold: the plugin list in
`auth.ts` has a documented mandatory order and adding a plugin is a real
regression risk for a feature that needs none of Better Auth's session
machinery; keys here are scoped to an organization, which is not the plugin's
model; and per-tenant concerns stay app-owned so a provider switch cannot take
them hostage — the same argument that keeps roles in `OrganizationRole`.

## SHA-256, and why a slow hash would be wrong here

The decision most likely to be "corrected" by somebody applying password
advice to something that is not a password.

A password hash is deliberately slow because a password has perhaps 30 bits of
entropy and the attack is an offline dictionary run — the only defence is to
make each guess expensive. **An API key here is 32 bytes from a CSPRNG**: 256
bits, no dictionary, no structure to guess. Making verification expensive
defends against nothing and costs something real, because it runs on every
request to the public API and would put our hashing cost into a customer's
p99.

A single unsalted SHA-256 also buys the property that makes verification
cheap: the digest is **unique in the table**, so checking a key is one indexed
read. A salted KDF cannot be looked up — it forces a scan over candidate rows
and a comparison each, so the number of keys a tenant holds would start
affecting their API latency.

A test asserts the key length against the documented constant, so shortening
it for prettier keys breaks a test rather than silently invalidating this
reasoning.

## The gates are called, never reimplemented

The phase file's warning is that *"if the REST route reimplements a rule, the
surfaces have already drifted"*. So every entitlement decision on this surface
is a call into `src/lib/feature-gate.ts` — the same functions
`protectedProcedure` calls, reading the same registry entries. There is no
plan comparison, no limit arithmetic and no upgrade copy written anywhere
under `src/app/api/v1/`.

In order, per request:

1. **`apiAccess`** — a registry flag. Refused with the registry's own upgrade
   sentence.
2. **The key's daily quota** — in Redis, keyed by the KEY.
3. **`apiCalls`** — the plan's monthly allowance, shared with every surface.
4. **The verb's own resource** — `projects`, `renders` — also shared.

### Shared quotas are the intended behaviour

The done-when says it outright: *"burning the API quota does not block the
same workspace's UI jobs beyond the shared cap — and the shared cap is the
intended behaviour, not a bug"*. A render started through the API counts
against the same monthly `renders` limit the dashboard counts against, because
it is the same video on the same plan.

What is **not** shared is the per-key daily quota, and the distinction is the
point: `apiCalls` is an entitlement, `dailyQuota` is a **blast radius**. A
leaked or looping key burns its own allowance; the workspace's other keys, and
its dashboard, keep working.

### The gate always, the counter sometimes

A reused render must not spend a slot, but the gate must still run — a
workspace at its limit should be refused before any work. So `runApiRoute`
splits them: `resource` decides what is gated, `countOnSuccess` decides what
is counted, and the renders route passes `(result) => !result.reused`.

This is where 17a's **operation reports, surface meters** split pays off. The
web app compensates for the factory's automatic `+1` with a `-1`; this surface
simply does not count. Neither piece of knowledge leaked into the operation,
and the same reuse rule holds on both.

## One pipeline, and a route that is four lines

Everything a route could get subtly wrong happens once, in `runApiRoute`:
authenticate, gate, read the body, validate, deduplicate, run, envelope,
meter, translate the failure. What is left in a route file is the three things
only that endpoint knows — its schema, its metered resource, and the operation
to call.

That is the same argument that puts the gates in the tRPC procedure factory
rather than trusting each handler, and it is testable: a route that forgot the
quota check would be a route that did not call the pipeline at all.

### Ordering decisions inside the pipeline

- **Gates before parsing.** A workspace over its quota is told so for the
  price of one gate read, rather than after we have done the work.
- **Idempotency claimed after validation.** A malformed request must not burn
  a key the client will reuse once it has fixed the payload.
- **Counters after success.** A refused request must not consume the
  allowance it was refused by, or a workspace at its limit could not discover
  that it is at its limit.
- **A replay counts nothing**, because it did nothing. Charging twice for a
  deduplicated retry would make the idempotency key a liability.

## Idempotency has three states, not two

A stored entry holds a **fingerprint** — a hash of method, path and body —
beside the response, and that is what makes the feature safe rather than
merely present:

- Same key, same request → **replay** the stored response, with
  `Idempotent-Replay: true`.
- Same key, **different** request → **409**. That is a client bug (a key
  generated once per process instead of once per request) and silently
  returning the first call's answer to the second call's question is the worst
  possible response to it.
- Key claimed and still running → **409**. The claim is a `SET NX`, so exactly
  one of two concurrent requests wins and the loser is told rather than
  allowed to duplicate the work.

**A failure releases the claim.** If the handler fails, the claim is deleted
so the client's retry — the thing the header exists for — can proceed. Leaving
it would turn one failed request into 24 hours of conflicts. Only successful
responses are stored.

The fingerprint covers method, path and body and **not headers**, because a
retry legitimately changes `User-Agent`, tracing headers and `Content-Length`,
and a fingerprint that included them would never match its own retry.

## The path is not decorative

`POST /projects/:id/voices` is the one route where the URL carries something
the body does not, and making that real required a change to a schema the web
app shares: `assignVoiceSchema` gained a required `projectId`.

It is not redundant. It is an **assertion the caller makes**, which the
operation checks before writing. Without it the path segment would be
decorative — a client could name any project, we would ignore it, and a stale
speaker id would quietly assign a voice in a different video. A URL that does
not mean what it says is worse than a shorter one.

The check landed in the operation rather than the route, so the web app gained
it too. The mismatch is a `not_found` rather than its own code: telling a
caller "that speaker exists, but in another project" is a small oracle about
rows they did not name.

## The OpenAPI document is generated, and says what it does not know

Zod 4 emits JSON Schema natively and OpenAPI 3.1 aligned its schema object
with JSON Schema 2020-12, so the conversion is one function call per schema —
no converter dependency and no second description of a type.

`io: "input"` matters: a schema with defaults has a different shape going in
than coming out, and describing the output shape would tell a client a field
is required when it is not.

**The honest limitation**, stated in the file and here: request bodies are
exact, **response payloads are described rather than typed**. The operations
return Prisma rows and composed views that have no Zod schema to derive from,
and a hand-written response schema is precisely what this file refuses to do
for requests. So a client gets exact request validation, an accurate list of
endpoints, statuses and error codes — and `data` as an open object. Closing
that gap means response schemas in `lib/types`, which is larger than this
phase.

A test asserts the document covers **every route file on disk**, by reading the
directory rather than comparing against a list. A route added without a path
in the document is an endpoint no generated client can reach, and nothing else
would notice.

## Two small things that were load-bearing

**The registry could not name a page that did not exist.** Next's typed routes
rejected `nav.href: "/dashboard/settings/developers"` until the page was
created. That is a good property worth knowing about: the nav cannot point at
a 404.

**The Redis client moved to `src/lib/redis.ts`.** It was private to
`rate-limit.ts`, which was right while rate limiting was the only consumer.
Idempotency needs plain `get`/`set`, and a second client would mean two
connection pools and two answers to "is Redis configured".

## What 17b does NOT do

- **No project listing, no asset upload, no editing.** Seven verbs, which are
  the phase file's list. A public API exposing all hundred-odd procedures is a
  promise to keep every one of them stable forever.
- **No webhooks**, no team keys, no published SDK — all explicitly out of the
  phase.
- **No scopes on a key.** See above.

## What has never run

Unchanged in kind from every phase since 02, and specific here:

- `tsc` clean, lint clean, **1413 tests passing** (40 new).
- **No HTTP request has ever reached these routes.** The key format, the
  failure→HTTP table, the envelope shapes, the idempotency fingerprint and the
  OpenAPI document's coverage are genuinely verified — they are pure and they
  are tested. The pipeline around them is not: authentication, the gate order,
  the counters and the replay path need a database and a Redis, and this
  machine has had neither since Phase 05.
- **`next build` fails in this environment** for a pre-existing reason
  unrelated to the phase: `next/font` cannot fetch Geist from Google Fonts
  without network access. The two errors are both in `src/app/layout.tsx`;
  nothing under `api/v1` is implicated.
- **Without Redis there is no deduplication.** Idempotency degrades to
  "every request runs", which is the same fail-open choice rate limiting
  makes but for a weaker reason — here it means a retry can double-charge. It
  is the one piece of this phase that genuinely requires Redis in production
  rather than merely benefiting from it.

---

# 17c — the MCP server

One endpoint, eight tools, and the same key. `/api/mcp` speaks JSON-RPC and
calls the same operation functions the REST API calls, so an agent and a
customer's script get identical behaviour from identical rules.

## Where 17c's code lives

| Path | Contains | Touches the database? |
| --- | --- | --- |
| `src/lib/api/mcp.ts` | JSON-RPC and MCP envelopes, version negotiation | **no** |
| `src/lib/api/mcp-tools.ts` | the tool table, bound to operations | via operations |
| `src/app/api/mcp/route.ts` | the transport: parse, authenticate, dispatch | no |
| `src/lib/api/authenticate.ts` | **moved up** from the REST folder, now shared | via the service |
| `src/lib/api/gates.ts` | **extracted**, so both surfaces gate identically | via the gate |

## The seam held, which is the headline

17c added **no business logic**. Every rule it needs already existed: the
operations from 17a, the gate order from 17b, the key check from 17b. A tool
is a name, a description, a schema, a metered resource, a summary sentence
and a one-line call to an operation.

That is the test 17a was written to pass. If a tool had needed to re-check a
plan or re-derive a price, the seam would have failed at its own purpose —
and the failure would have been invisible, because the tool would still work.

### Two things moved up to make it true

Writing 17c surfaced that two pieces of 17b were in the wrong place:

- **`authenticateApiKey`** lived under `src/app/api/v1/_lib/` and returned a
  `Response`. MCP needs the identical sequence — shape check, digest lookup,
  revocation filter, `apiAccess` flag, per-key daily quota — so it moved to
  `src/lib/api/` and now returns a **refusal as data**: a code, a message, a
  status and headers. Each surface renders it.
- **The gate order** was inline in `runApiRoute`. It is now
  `checkApiEntitlements` and `countApiUsage` in `src/lib/api/gates.ts`,
  because the thing most easily got wrong is not which gates but their order
  and which runs before the work.

Neither was a rewrite; both were a function moving one directory up and
returning data instead of HTTP. But leaving them where they were would have
meant a second copy of the gate sequence in the MCP dispatcher — the exact
drift the phase warns about, and silent: an MCP server that forgot the
`apiAccess` check would work perfectly for a paying workspace and quietly
serve a free one.

## No SDK, and the conditions under which that is wrong

`@modelcontextprotocol/sdk` is not a dependency of this project and was not
added. That deserves an argument rather than a shrug.

**What this server is:** eight tools, no resources, no prompts, no sampling,
no roots, no server-initiated messages, no sessions. Every call is one POST
in and one JSON object out. The protocol surface that leaves is three methods
— `initialize`, `tools/list`, `tools/call` — plus a notification to ignore
and a ping to answer. That is one file of envelope construction, and it is
testable without a transport.

**What the SDK is mostly for** is the part this server does not use: session
management, the SSE stream for server-initiated messages, and the client
side. Taking it would put a dependency with a moving API into a route handler
that runs on every agent call, to save about a hundred lines, and would make
the wire format something read from a changelog rather than from a file.

**When this becomes the wrong call**, stated so the next person can reverse
it without re-deriving the argument: the moment this server needs
**resources**, **prompts**, **sampling** or a **server-initiated stream**,
the SDK is the right answer and `src/lib/api/mcp.ts` becomes a liability. It
is sized for exactly what step 14 asks for and nothing beyond it.

## A tool failure is not a protocol failure

The distinction that matters most to an agent, and the one most easily got
wrong.

A tool that could not do its job — no such project, not enough credits, a
plan that does not include the API — returns a **successful JSON-RPC
response** carrying `isError: true` and the message. A JSON-RPC **error** is
for the protocol being broken: an unknown method, a malformed envelope, a
tool name that does not exist.

Getting this backwards is worse than it looks. Reporting "not enough
credits" as a JSON-RPC error hides it inside the client's transport layer,
where the model never sees it — the model is told only that the tool call
failed, with nothing to act on. The whole point of returning it as a result
is that the model **reads the sentence and adapts**, which is why the
operations' own customer-facing messages travel through unchanged.

The one exception is an unknown tool name, which is a client working from a
`tools/list` it never read. That is the protocol being used wrongly, so it is
a `methodNotFound`.

## The description is the interface

This is where MCP differs most from REST, and it changed how the tools were
written. A REST client is read by a programmer with the documentation open; a
**tool description is read by a model** deciding whether to call it, with
nothing else to go on.

So each description says what the tool does, **what it costs**, and **what
happens next**. A model that does not know a render is asynchronous will poll
nothing; one that does not know a script costs credits cannot warn anybody.

### Work outliving the connection is in the descriptions

Step 16 asks for this and the descriptions are the only place it can live.
The expensive verbs queue durable work in Inngest: a disconnect, a timeout or
a client restart cancels nothing. An agent that retries `start_render` after
losing its connection has started a **second paid render**.

A test asserts that `generate_script` and `start_render` both say *"do not
retry"* and both say `COSTS CREDITS`. That assertion earns its place because
nothing else would catch a tool added without the caveat — the types are
fine, the tool works, and the only symptom is a customer billed twice.

### `instructions` carries the order

The `initialize` result includes `instructions`, which is read once by the
model. It states the **sequence** — project, script, voices, render, poll,
download — because that is the one thing eight independent tool descriptions
cannot convey. A model holding eight descriptions still has to work out that
a render needs a script and a script needs a project.

## Structured JSON plus a sentence

Step 15, and MCP's own result shape fits it exactly: `content` is what a
person watching the agent reads, `structuredContent` is what the model
parses. Sending only one makes either the transcript unreadable or the data
unusable.

The summary is a **function of the result**, not a constant, because the
sentence worth reading is about what happened: *"Render queued, costing 12
credits"* and *"This video had already been rendered, so nothing was
charged"* are the same tool and genuinely different outcomes.

## Eight tools, not seven

The phase file names seven. `list_voices` is the eighth, and it is here
because **`assign_voices` is unusable without it** — a model has no other way
to learn a voice id, and telling it to read a REST catalogue it cannot call
would be a dead end. The REST surface has three catalogues; the MCP surface
exposes the two an agent needs to finish a video.

## What MCP does not have, and will not pretend to

**No idempotency key.** MCP has no header for one and nowhere for a model to
put it, so this surface does **not** have the REST API's replay guarantee.
What protects a customer from a duplicated render is the description telling
the model not to retry, plus the reuse rule, which makes a second identical
render free. A second *script* is not free, which is why that description
carries the same caveat. This is a real gap and it is stated rather than
papered over.

**No event stream.** A GET on an MCP endpoint means "open a stream for
server-initiated messages", and this server never initiates any. It answers
405 with a sentence, so a client learns that in one request rather than
holding a connection open for messages that will never come. A client that
*requires* the stream will not work here; the fix would be a GET handler, not
a redesign.

**No sessions.** A DELETE ends a session and there is none to end. Also
answered with a sentence rather than Next's bodiless 405.

## The transport details that bite

Writing the protocol by hand means these are ours to get right, so they are
tested rather than assumed:

- **A notification wants no answer.** `notifications/initialized` carries no
  id and gets a 202 with an empty body. Answering it is a violation some
  clients treat as a hard error. An explicit `id: null` counts as a
  notification too, because some clients send it that way.
- **Version negotiation echoes what we support.** Three revisions are
  accepted, newest first, because agent clients upgrade on their own
  schedule and the tool surface is identical across them. An unknown version
  gets our newest and the client decides.
- **Auth failures use HTTP status codes** as well as a JSON-RPC body. An MCP
  client's transport looks for bearer failures at the HTTP level, which is
  where its own authorization flow lives; anything reading the body still
  gets a well-formed JSON-RPC error rather than a bare page.
- **Batches are refused.** The 2025-06-18 revision removed them, so accepting
  an array would mean implementing semantics the current specification does
  not have.

## One TypeScript problem worth recording

The tool table is heterogeneous — every entry has different input and output
types — so a plain array of them is a union that, after a lookup by name, no
longer knows element N's schema produces exactly what element N's operation
accepts. The pairing is real and the type system cannot carry it through the
lookup.

The fix is `defineTool`, a generic factory where each tool's two types are
closed over **once**: parse, run, count and summarise all happen inside, where
the relationship is still visible, and what comes out is a uniform
`BoundTool` whose `invoke` takes `Record<string, unknown>`. No `any`, no
assertion, and no way to hand one tool's input to another's operation.

The first attempt used `as const` with `satisfies` per entry and a cast at the
call site. It type-checked in places and lied — which is the usual outcome of
casting around a lost relationship rather than restoring it.

## Step 17: the developers screen

The MCP endpoint and a **copy-paste config block**, because an endpoint is
useless without the JSON that goes into a client's config file and nobody
types one from a description. The key in it is a placeholder: the real one is
shown once, above, and pasting a live credential into a block that also gets
screenshotted is how keys leak.

Two small things that were load-bearing:

- **The origin comes from the server.** The snippets contain a URL, and it
  has to be the deployment the customer is looking at — a config copied from
  a preview and silently pointing at production is a mistake nobody spots in
  a code block. The page reads the request headers and passes it down, rather
  than an effect reading `window.location` (which the
  `react-hooks/set-state-in-effect` rule catches) or a render-time read
  (which would differ between server and client markup).
- **The tool count is read from the table**, not written in the copy, so
  adding a tool cannot leave the screen claiming the wrong number.

## What has never run

- `tsc` clean, lint clean, **1438 tests passing** (25 new).
- **No agent has ever connected.** The envelopes, the notification handling,
  version negotiation, the tool catalogue's shape and the descriptions'
  promises are genuinely verified — they are pure and they are tested. The
  handshake against a real client, the gate pipeline and every tool's actual
  work need a database and a Redis, and this machine has had neither since
  Phase 05.
- **The protocol is unverified against a real client**, which is the specific
  risk of writing it by hand. The envelopes match the specification as read,
  and no Claude or Cursor client has confirmed that. First connection is the
  test.
- `next build` still fails here for the pre-existing font-fetch reason in
  `src/app/layout.tsx`; nothing under `api/` is implicated.

---

# 17d — AI footage

A prompt becomes a video clip in the workspace's library. It is the most
expensive operation in the product, the most legally exposed, and the only
one that runs for minutes — so most of the decisions below are about money,
refusals and waiting.

## Built against an open decision, and what that cost

The phase file is blunt: *"confirm the chosen model's terms permit commercial
use before building on it — ask the owner, do not assume"*. That has not been
settled. It was built anyway, on instruction, and the honest accounting is:

- **The seam absorbs the choice.** Everything except one folder is
  provider-agnostic: the contract, the workflow, the moderation, the
  metering, the screen, the registry. Switching providers is
  `src/lib/adapters/video/<provider>/` plus an env var.
- **Replicate is implemented first**, and the reason is the one axis the
  phase file does specify: step 4 requires storing `modelVersion` for the
  audit trail, and Replicate's API is built around **immutable version
  hashes**, so what gets recorded is exact rather than a label that may have
  moved. That is a reason to build it first, not a finding that it is the
  right answer.
- **The model is not pinned in code.** `VIDEO_MODEL` is an env var with a
  placeholder default, so changing it is a deploy rather than a release —
  which is what you want for a choice that may be made on legal advice.
- **The price is a placeholder with a stated property.** Grep
  `THE_RATE_MUST_EXCEED_THE_COST`: 8 credits a second is anchored to the
  shape of generative-video pricing, not to a contract. **Check the chosen
  model's real per-second price against it before enabling this on a paying
  plan.** A rate below cost is a feature that loses money on every use and
  looks like success in every metric.

## Where 17d's code lives

| Path | Contains | Touches the database? |
| --- | --- | --- |
| `src/lib/adapters/video/types.ts` | the contract: `start`, `poll`, the failure reasons | **no** |
| `src/lib/adapters/video/replicate/` | the one implementation, over plain `fetch` | **no** |
| `src/lib/types/footage.ts` | the closed duration set, the request schemas, the view | **no** |
| `src/services/footage.service.ts` | moderation, the cache, the row, the library read | **yes** |
| `src/inngest/functions/footage-generate.ts` | hold, start, poll across steps, store, hand over | via services |
| `src/trpc/routers/footage.ts` | `aiFootage.estimate` / `.list` / `.generate` | via services |
| `src/lib/credits/estimate.ts` | the `aiFootage` kind and its per-second rate | **no** |
| `.../dashboard/footage/` | the prompt box, the cost on the button, the grid | via tRPC |

**No migration.** `Asset` already had every column this needed —
`kind: ai_footage`, `promptText`, `modelVersion`, `promptHash`, `durationSec`
— because Phase 02 added the provenance columns and Phase 14 added the
prompt ones. The kind's own comment in the schema already named Phase 17.

## Start and poll, not generate

The one place this seam differs in shape from its sibling `ImageAdapter`. An
image model answers in seconds and `generate()` can wait; a video model takes
minutes. The phase file says it outright — *"poll in separate steps with
sleeps between; polling inside one step times out"* — and the two-method
contract is what makes that possible.

It is the same split `RenderAdapter` makes (`start` + `getProgress`), which
is worth noticing: the two slowest operations in the product both outlive a
request, and both are modelled as *hand it over, then ask*.

### The job id lives in a step result, not a column

Inngest memoises a completed step, so a replay of `start-generation` returns
the id it already got instead of starting — and paying for — a second clip. A
column would work too, and would be a migration for something the queue
already guarantees.

### The wait is bounded

Forty polls, fifteen seconds apart: ten minutes. A deliberate ceiling rather
than a guess at the slowest case — a generation still running after ten
minutes is almost certainly stuck, and the customer is better served by a
released hold and a clear failure than a tile that spins for an hour.

Fifteen seconds rather than three because the clip will not arrive sooner for
being asked more often, and some provider plans bill per request.

## Refused is not failed

Video providers run their own safety classifier and decline prompts ours
allowed — a likeness, a trademark, something they read differently. That is a
distinct failure reason in the contract, and the distinction exists for the
**customer**: a refusal means reword, a failure means try again.

It also decides retries. A refusal is raised as `NonRetriableError`, because
the provider will decline it again and **every attempt may be billed**.
Collapsing it into "failed" produces three identical refusals and a support
ticket.

Replicate gives no machine-readable refusal code, so this reads the error
**text**. That is fragile and is written down as such — the cost of a miss is
bounded (one pointless retry in one direction, a customer told to reword in
the other) and the boundaries are pinned by a test, because a heuristic
nobody pinned down drifts.

## Moderation is in the router, before anything exists

Step 3 requires the check before the model call and requires it to **fail
closed**. It happens in the request rather than the workflow, and that is
deliberate: a customer whose prompt is refused is told **immediately** and
can reword, instead of watching a tile fail a minute later with nothing to
act on.

The implementation is deliberately the same shape as Phase 14's
`moderateImagePrompt` — context `prompt`, subject type `prompt`, the hash as
the subject id — because this is the same decision about a more expensive
call, and two implementations of one safety rule is how one of them ends up
weaker. `moderateText` never throws and fails closed, so a classifier outage
blocks the generation rather than letting an unclassified prompt through.

The workflow does not repeat the check: the router is its only producer, and
a second classifier call would be paying twice for an answer already
recorded.

### The examples teach the rule

Step 6 asks for examples, and the four on the screen are every one a **scene**
with no person, no brand and no likeness. A customer who starts from one does
not meet the content refusal — which is a better way to explain the rule than
the refusal message.

## Five checks, in this order, before anything is written

`aiFootage.generate` is a sequence and each step is before the next for a
reason:

1. **A provider is configured** — otherwise refuse before anything is
   recorded.
2. **The plan's allowance** — the registry's own limit and upgrade sentence.
3. **Moderation** — before the cache, so a refused prompt is refused even if
   an identical one slipped through earlier.
4. **The cache** — an identical prompt at the same length returns the
   existing clip, synchronously, with no job and no charge.
5. **The balance** — on the estimate, before the row, because a refusal must
   leave no trace. A `processing` asset that was never affordable sits in the
   library as a clip that is about to arrive and never will.

The **hold** is placed by the workflow, not here — the same reasoning
`renders.create` records: a credit movement inside a request that may time
out strands money with no run in existence to release it.

### The gate is called, not inherited

The procedure factory applies a limit gate automatically, but only on the
`create` verb — and `create` would **also** auto-increment the counter at
request time. That would charge a customer one of their twenty monthly clips
for a generation the provider may refuse.

So the verb is `generate`, and the gate is called explicitly through the same
`checkFeatureGate` the factory uses, reading the same registry entry. The
allowance is spent in the workflow when a clip actually **exists**. Same
discipline as 17b's REST surface: call the rule, never restate it.

## The money is returned on every failure path

A customer who got no clip must not be charged. The hold is released on a
provider failure, on a timeout, on an asset deleted mid-generation, and in
`onFailure` for a run that exhausted its retries — which is the one that
matters, because without it the asset sits on `processing` forever and the
hold sits against the balance until the Phase 05 reconciler notices.

`releaseClipHold` looks the hold up by **reference** rather than taking an
id, because `onFailure` has the event payload and not the step results. Its
own failures are logged and swallowed: it runs where there is no error path
left.

### The ledger reference is not a project ref

`clip:<assetId>`, and deliberately **not** in `PROJECT_HOLD_REFS`. A clip
belongs to the workspace's library rather than to a project, so cancelling a
project's generation must not release a clip the customer is still waiting
for.

## Fetch once, then hand over

The workflow downloads the provider's file, uploads it under our key, and
then sends `asset/uploaded` so the **one** ingest pipeline that owns probing,
variants and the readiness transition does that work. The vertical variant
and the proxy the first done-when asks for come from there.

Copied from the library ingest, which solved the same problem for a third
party's bytes. Two producers, one pipeline.

### A new event name, one word from an existing one

`clip/requested`, not `footage/requested` — which is taken, and means
something else: that event asks the pipeline to resolve **one block's**
visual from the stock-then-image-then-background chain. Reusing the name
would have put two unrelated payload shapes behind one trigger.

A test asserts both names, beside each other, precisely because they are one
word apart.

## Step 7, read rather than skipped

> Fall back to a stock clip or the styled background when generation fails,
> so a failure degrades the video rather than the job.

This requirement is **already met, by Phase 14**, and does not arise again
here. The reason is worth stating rather than quietly leaving a box unticked:

Phase 14's `resolveBlockChoice` picks a block's visual from a chain — stock
clip, then generated image, then the styled background — and that chain is
what degrades when a generation fails. **The pipeline never generates
video.** 17d's clips are a library a customer builds and inserts from
deliberately, so a failed generation has no video to degrade: there is a
failed tile with its reason and the credits back.

Wiring AI video into the per-block chain would be a different feature — one
that spends the most expensive call in the product automatically, without
anybody asking — and the phase file does not ask for it.

## A failed clip is still shown

The row is created **before** the model is called, carrying the prompt, so
the grid shows the request the instant it is made and shows it failing if it
fails. Creating it only on success would mean a minute of blank screen and
then either a clip or nothing, with no way to tell a slow generation from a
lost one.

A failed tile carries the provider's reason and says the credits came back. A
customer who spent money and got nothing needs both facts without asking.

The grid polls every five seconds **only while something is processing**, and
stops when nothing is. Polling a quiet screen forever is a request every few
seconds per open tab, for a library that changes a few times a month.

## A limit, not a flag

`aiFootage` gates with a **zero allowance** on free and starter rather than a
feature flag, and the screen is reachable on every plan (`requireFlag:
false`). A flag hides a feature; a limit lets somebody see what it is and be
told what it would cost. Hiding it means the only people who discover it are
the ones already paying for it.

It is a quota **and** a price — twenty clips a month on pro, plus credits per
clip from the ledger. The same `A_QUOTA_AND_A_PRICE` pairing Phase 14's
images use: the plan says how many a customer is entitled to, the balance
says how many they can pay for, and a generation needs both.

## What has never run

- `tsc` clean, lint clean, **1460 tests passing** (22 new).
- **No clip has ever been generated.** Nothing here has touched a video
  model: there is no `VIDEO_API_KEY` on this machine, and there is no chosen
  model to put behind one. What is genuinely verified is everything pure —
  the pricing and its relationship to a render, the closed duration set, the
  refusal heuristic's boundaries, the output-shape reader, the failure
  classification that decides retries, and the prompt hash the cache depends
  on.
- **The four done-when items all need a live run.** A clip in the library with
  its variants, a blocked prompt, a released hold, and a job surviving a
  closed browser are each code-complete and each unobserved. Three of them
  additionally need the database and R2 that Phases 02 and 05 are blocked on.
- **The price is unverified against a real contract**, which is the specific
  consequence of building before the decision. Grep
  `THE_RATE_MUST_EXCEED_THE_COST`.
- `next build` still fails here for the pre-existing font-fetch reason in
  `src/app/layout.tsx`; nothing under `api/` or `dashboard/footage` is
  implicated.

