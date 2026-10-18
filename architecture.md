# Short-form video studio — architecture

Revised for the actual codebase. Supersedes the Oct 5 revision, which described a Turborepo/Drizzle
monorepo that was never built.

> **Build order lives in `docs/phases/`.** Start at `docs/phases/00-README.md`.
> **Product intent lives in `features/`** — what each format should do. Its stack claims are dead.

This document explains how a video is made **on top of the Architectural Guardrail boilerplate**:
Next.js 16 App Router, Prisma, tRPC v11, Better Auth behind an adapter, Stripe, Upstash, Resend.

---

## The two ideas you are building on

The boilerplate already has a spine, and it is not optional.

**One: `src/lib/resources.ts` is the registry.** Every permission, plan limit, plan flag, sidebar
item, audit template and rate-limit override is declared there, once. One entry buys you a
permission constant, an owner grant, a sidebar link, a route-authorization check, a limit gate, a
usage counter, a flag gate, an optimistic client bump and audit copy.

**Two: `protectedProcedure` is the only way into tenant data.** It resolves `<resource>.<verb>` from
the procedure path and wires auth, membership, role, permission, rate limit, plan gates, pagination,
the transaction, the usage counter and the audit row around your handler. You write the Prisma call.

**The video system is a third idea layered on top: one timeline document, many writers, one
renderer.** Think sheet music. Generators compose it, the editor revises it, the renderer plays it.

Everything below is how those three fit together.

---

## The one big idea, concretely

Four project kinds — `reddit-story`, `voiceover`, `quiz`, `motion` — differ **only** in how they
fill the same JSON document. Without that contract, four formats need four pipelines and four
renderers. With it, a new format is one generator module plus one component family.

A fifth flow, `ai-footage`, is not a project kind: it produces a clip in the media library that any
kind can place.

---

## Layers

```
UI                  React + tRPC hooks + <FeatureGate> + <ContentLayout>
tRPC routers        src/trpc/routers/*.ts          business logic, thin
Procedure builder   src/trpc/procedures/protected.ts   auth, gates, tx, audit  [DO NOT EDIT]
Domain modules      src/lib/timeline|captions|credits|generators|scene/   pure logic, no I/O
Services            src/services/*.service.ts      pure Prisma, 'server-only'
Adapters            src/lib/adapters/*             every outside system, behind an interface
Jobs                src/inngest/*                  durable multi-step work
Prisma              prisma/schema.prisma -> @/generated/prisma
```

Two hard rules about this stack:

1. **Nothing slow runs in a tRPC handler.** Mutations execute inside a 10-second Prisma transaction
   alongside the audit write. A procedure validates, enqueues an Inngest event, and returns.
2. **No vendor SDK is imported outside its adapter folder.** eslint already enforces this for
   `better-auth`; the same `no-restricted-imports` pattern extends to each new provider.

---

## Tenancy: orgs are personal workspaces

`protectedProcedure` requires `organizationId` on every input and checks membership before your
handler runs. Fighting that means editing the infrastructure layer, which is the one thing the docs
say never to do.

So: **every signup auto-creates exactly one organization, and the UI never says the word.** The user
sees "your videos". The database sees a tenant. Projects, assets, renders, credits and usage all key
off `organizationId`, matching the schema header's instruction to add domain models with
`organizationId` as the tenancy key.

The payoff is that agency and team plans later cost approximately nothing: the roster, invitations,
roles and seat limits are already built and already tested.

---

## Life of one video

A video is never built inside a request. The request records intent and hands off.

1. **User submits a Reddit link.** Client calls `trpc.projects.create.mutate({ organizationId, ... })`.
2. **The procedure builder runs its pipeline** — membership, permission, the `projects` plan limit,
   the usage bump, the audit row — then the handler writes the `Project` row and sends
   `project/requested` to Inngest. The mutation returns in milliseconds.
3. **`project.generate` runs durably.** Steps: moderate → script → validate voices → TTS (fan-out
   per line) → align → kind-specific build → captions → save timeline → estimate. Each step
   memoizes, so a retry resumes rather than restarts.
4. **Progress streams to the UI.** Each step writes a `PipelineStage` row; the client subscribes over
   SSE — the transport is already configured and currently unused.
5. **Preview.** Remotion Player renders the same document in the browser from `proxy_480` variants.
6. **Edit, optionally.** The editor posts operations, not documents, with the revision it loaded.
7. **Render.** Credits are held, `project.render` starts Remotion Lambda, the workflow waits on a
   webhook rather than polling.
8. **Finalize.** The webhook stores the MP4 and poster as assets, commits the credit hold, emails.
9. **Download** through a short-lived signed URL.

If any step fails terminally, `onFailure` releases the hold. Nobody pays for a video that was not
made.

---

## The timeline document

One JSON document is the contract between generators, the editor, the player and the renderer. It
lives in `Timeline.doc` (jsonb) and is defined, validated and migrated by `src/lib/timeline/`.

```jsonc
{
  "version": 4,
  "kind": "reddit-story",
  "canvas": { "width": 1080, "height": 1920, "fps": 30 },
  "style":  { "paletteId": "noir", "captionStyleId": "bold-pop", "safeZone": "tiktok" },
  "words":  [{ "i": 0, "w": "AITA", "s": 0.0, "e": 0.32, "speaker": "A" }],
  "tracks": [
    { "id": "bg",        "type": "video",   "items": [{ "id": "i1", "assetId": "...", "start": 0, "duration": 58.4, "fit": "cover", "loop": true, "muted": true }] },
    { "id": "scenes",    "type": "scene",   "items": [{ "id": "s1", "start": 0, "duration": 6.2, "render": "motion", "scene": { "layout": "stack-center", "elements": [] } }] },
    { "id": "narration", "type": "audio",   "items": [{ "id": "a1", "assetId": "...", "start": 0, "duration": 4.1, "speaker": "A", "gain": 1.0 }] },
    { "id": "music",     "type": "audio",   "items": [{ "id": "m1", "assetId": "...", "start": 0, "duration": 58.4, "gain": 0.12, "duck": true, "loop": true }] },
    { "id": "captions",  "type": "caption", "styleId": "bold-pop", "items": [{ "id": "c1", "startWord": 0, "endWord": 3, "position": { "y": 0.72 } }] },
    { "id": "overlays",  "type": "overlay", "items": [{ "id": "o1", "assetId": "...", "start": 0, "duration": 4.1, "box": { "x": 0.08, "y": 0.1, "w": 0.3 }, "z": 10 }] }
  ],
  "speakers": { "A": { "voiceId": "lib_ava", "avatarId": "av_ava" } },
  "assets":   { "bg_loop_07": { "assetId": "...", "kind": "video", "license": "owned" } }
}
```

### Invariants

| Rule | Why |
| --- | --- |
| Generated timing uses **word anchors**, resolved to seconds when the doc is built | Captions and animations land on the spoken word |
| The editor writes **absolute times** and sets `Project.manualEdited` | Manual work is never silently regenerated away |
| Items carry `assetId`, **never a URL** | URLs are signed per request; assets stay reusable |
| Caption items reference **word ranges**, never text copies | Restyling cannot break sync |
| `render` on a scene item selects a **component family** | Every format plugs into one renderer |
| The document is **versioned and migrated on read** | Old projects keep rendering after engine changes |

**What a word anchor is.** A generator does not say "caption at 2.4s". It says "words 0 through 3".
Seconds come from `words[]`, so re-recording a line moves its captions automatically.

`src/lib/timeline/` is pure — no Node built-ins, no Prisma — because the same `apply(doc, op)` runs
in the browser editor and on the server. Two implementations would drift within a month.

---

## Where video code goes

The old plan's packages map onto folders:

| Concern | Location | Shape |
| --- | --- | --- |
| Document schema, validation, migration, ops | `src/lib/timeline/` | Pure, isomorphic |
| Caption grouping and styles | `src/lib/captions/` | Pure; styles are data |
| Scene language, layout engine | `src/lib/scene/` | Pure |
| One module per project kind | `src/lib/generators/` | `build(ctx): TimelineDoc` |
| Credit maths | `src/lib/credits/` | Pure; estimation only |
| Remotion compositions | `src/remotion/` | React, bundled separately |
| Every outside system | `src/lib/adapters/<kind>/` | Interface + impl |
| Durable workflows | `src/inngest/functions/` | Steps call services and adapters |
| Prisma reads and writes | `src/services/*.service.ts` | `import 'server-only'` |
| Endpoints | `src/trpc/routers/` | Validate, decide, enqueue |

---

## Provider adapters

The boilerplate already proves the pattern for auth: three interfaces in
`src/lib/adapters/types.ts`, one env var selecting an implementation, dynamic `import()` server-side
so an unselected provider never initialises, a build-time alias client-side, and a runtime
`assertProviderActive()` backstop. eslint forbids importing the SDK outside its folder.

Video providers follow it exactly:

| Adapter | Interface | Ships with | Fallback when it fails |
| --- | --- | --- | --- |
| `llm` | `generate(prompt, schema)` | Claude | Retry once with the validation error, then fail the step |
| `tts` | `synthesize({ text, voiceId })` | ElevenLabs | Backup model, then fail with a retry action |
| `stt` | `align({ audioUrl, scriptText })` | ElevenLabs Scribe | Even-split timings, flagged `degraded` |
| `storage` | `putObject`, `signedGetUrl`, `signedPutUrl` | Cloudflare R2 | None — hard dependency |
| `render` | `start(doc, opts)`, `getProgress(id)` | Remotion Lambda | Retry with a fresh render id |
| `jobs` | `send(event)`, workflow registration | Inngest | None — hard dependency |
| `video` | `generate(prompt)`, `poll(jobId)` | fal.ai / Replicate | Stock clip, then styled background |
| `stock` | `search(query)` | Pexels / Pixabay | Styled background |
| `moderation` | `classify(text)` | Claude | **Fail closed** — refuse the work |

Everything except storage, jobs and moderation degrades rather than breaks. Moderation fails closed
on purpose: an unreviewed prompt must never reach a paid provider.

---

## Entitlements, usage and credits

Three mechanisms, deliberately distinct.

**Plan flags and limits — the registry.** Declare `limit` or `flag` on a `RESOURCES` entry and
`protectedProcedure` enforces it on every matching path with nothing to opt into. Use this for
countable product objects and on/off features: how many projects, whether motion is available,
export resolution, watermark, API access.

**Usage counters — `UsageMetrics`.** Auto-bumped on `<resource>.create` and `<resource>.delete`.
Good for "10 projects on Starter". Note `lastResetAt` exists but nothing currently resets it; the
monthly roll is a Phase 00 cron.

**Credits — `CreditLedger`, new.** Append-only, `kind ∈ purchase | grant | hold | commit | release`.
Used wherever the real cost is variable and only known afterwards: TTS seconds, alignment, render
minutes, generated footage.

```
estimate(doc) -> breakdown      shown on the button before anything is spent
hold(orgId, amount, refId)      before the paid step
commit(holdId, actualCost)      in finalize
release(holdId)                 in onFailure and on cancel
```

A counter cannot express a hold or a refund, which is why credits are not folded into
`UsageMetrics`. The client contract already exists: `ERROR_CODES.INSUFFICIENT_CREDITS` and its
`StructuredErrorCause` variant are declared in `src/lib/errors/index.ts` and currently unreferenced.

Prices live in Stripe. Caps, flags and all upgrade copy live in the registry. Never type a second
list of what a plan includes.

---

## Jobs

| Workflow | Trigger | Steps |
| --- | --- | --- |
| `project.generate` | `project/requested` | moderate → script → validate voices → TTS fan-out → align → build → captions → save → estimate |
| `project.render` | `render/requested` | validate → resolve assets → start Lambda → wait for webhook → finalize |
| `asset.ingest` | `asset/uploaded` | scan → transcode vertical → proxy + thumb + waveform → moderate → ready |
| `footage.generate` | `footage/requested` | moderate prompt → call model → poll → store asset → notify |
| `line.resynth` | `line/changed` | TTS one line → re-align → patch the document |
| `credits.reconcile` | nightly cron | compare cached balance to ledger sum |
| `usage.reset` | monthly cron | roll `UsageMetrics.lastResetAt` windows |
| `cleanup.tmp` | daily cron | delete stale temp assets and failed renders |

Controls: per-user concurrency (2 generations, 1 render), `cancelOn` a cancel event, `onFailure`
releasing holds, idempotency keys on every enqueue, exponential backoff on provider calls.

**Long work never runs inside a step.** A step that waits ten minutes times out. Start the render in
one step; receive the webhook in another.

**Re-check ownership inside jobs.** A job runs outside `protectedProcedure`, so none of its gates
apply. Services take `organizationId` explicitly for exactly this reason.

---

## Rendering

One Remotion composition, `TimelineRenderer`, walks the tracks and maps each item's `render` field
to a component family: `MotionScene`, `QuizCard`, `RedditCard`, `MediaClip`, `AvatarOverlay`,
`TextOverlay`, `Captions`. An unknown `render` value logs a warning and draws nothing — a bad item
must never crash a paid render.

Preview and final output run the same React components over the same document. Only the media
differs: `proxy_480` in the browser, full quality on Lambda. That is why they match.

Output is MP4 (H.264/AAC) 1080×1920 at 30fps plus a poster; WebM is optional for motion exports.
Backgrounds are cropped and looped at transcode time, not render time. The watermark is applied by
entitlement, never by a generator.

Renders are deduplicated by `docHash`, unique per `(projectId, docHash)`. Re-rendering an unchanged
timeline returns the existing output instantly and charges nothing.

---

## Surfaces

**The web app** calls tRPC directly and shares the `AppRouter` type. No DTOs.

**The public REST API** (`/api/v1`, Phase 17) is a thin translation over the same domain functions,
authenticated by hashed API keys with a visible prefix. Conventions: `{ data, requestId }` or
`{ error: { code, message }, requestId }`, `Idempotency-Key` on POSTs, cursor pagination, 429 with a
reset hint.

**The MCP server** (`/api/mcp`, Phase 17) exposes the same operations as tools returning structured
JSON plus a one-line summary.

Quotas and concurrency are shared **per organization across all three surfaces**, so a user's API
key cannot starve their own UI jobs.

---

## Cross-cutting

**Security.** Provider keys server-side only. Script text, Reddit content and uploaded documents are
untrusted data, never instructions — wrap them in delimiters and say so in the system prompt.
Validate URLs against a scheme allowlist and block private address ranges. Scan uploads for codec
and payload safety. Verify every webhook signature. Filter every query by `organizationId`, and
re-check inside jobs. Signed expiring URLs for all private assets.

**Moderation.** Text before any paid step, footage prompts before the model call, uploads after
ingest. Store `moderationStatus` on assets and projects. Fail closed.

**Observability.** `requestId` flows from the call through the event, the steps and the render. The
procedure builder already emits structured JSON logs with `durationMs`.

**Accessibility.** Keyboard navigation and ARIA labels on the voice, background and caption grids
and the timeline controls; status announcements during generation; caption styles contrast-checked.

**Performance.** Proxies in the editor, CDN-cached library assets, TTS cached by `textHash`,
alignments by `audioHash`, renders by `docHash`.

---

## Legal — settle before the matching phase

Each of these can block launch and none is a code problem.

| Area | Position |
| --- | --- |
| Gameplay backgrounds | Footage recorded under a game's content policy, commissioned loops, or licensed abstract loops. Track a licence per asset. **"It's everywhere on TikTok" is not a licence.** |
| Character voices | Licensed library and designed originals only. No clones of real people or third-party characters, ever. |
| Avatars | Original illustrated characters. No third-party likenesses. |
| Reddit content | Official API with an OAuth app, cache within terms, honour removals. |
| Music and SFX | The licence must explicitly permit end-user publication and monetisation. |
| AI footage | Moderate prompts for trademarks and real people; record `modelVersion` per asset. |
| User uploads | Terms place responsibility on the user; respond to takedowns; keep an audit trail. |

---

## Weak points

1. **Regeneration versus manual edits.** Once a user edits a timeline, regeneration must branch to a
   new version — never overwrite. Decide in Phase 01; retrofitting is painful.
2. **One renderer, many component families** keeps things unified but grows the Lambda bundle. Watch
   cold starts; split compositions per kind if render times drift.
3. **Alignment is a single point of failure** for captions and motion timing. Keep the adapter
   interface ready for a second provider and cache by audio hash.
4. **Editor and generator drift** if timeline operations get implemented twice. One module, shared.
5. **Background licensing** is the largest non-technical risk in the product.
6. **Generative footage costs** an order of magnitude more than the rest of the pipeline. Meter it
   separately; consider pay-per-use rather than plan credits.
7. **Motion quality depends on the primitive library, not the model.** Budget real design time.
8. **Quota fairness across web, REST and MCP** — share per organization, not per surface.
9. **The 10-second transaction** around every mutation. If a handler ever feels slow, it belongs in
   a job. This is the easiest rule to break by accident.
