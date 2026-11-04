# Codebase review + plan to your first video

**Date:** 2026-11-04
**Branch:** `phase/16-motion-studio`
**Method:** full-codebase review across five parallel review passes (generation pipeline, render/Remotion/media, auth/tenancy/credits/security, frontend/routes, setup readiness), with every blocker re-verified by hand at the cited line.

Items marked **✓** were re-verified directly against the source. The rest come from the review passes and are worth confirming before you act on them.

---

## Baseline health

Genuinely good:

- `tsc --noEmit` — clean
- `eslint` — clean
- **1511 tests passing in 82 files**, zero failures, zero skips
- All 30 Prisma models have matching migrations — **no schema drift**
- All 15 Inngest workflows registered in `INNGEST_FUNCTIONS` and served
- Every `trpc.*` path the UI calls exists in a mounted router (110 call sites, full diff — no dead calls)
- Every internal `href` / `router.push` target has a `page.tsx` — no dead links
- `import 'server-only'` present in all 28 `src/services/*.service.ts` files
- No secret read in any `"use client"` file; every `NEXT_PUBLIC_*` var is legitimately public
- No IDOR found — every unscoped `where: { id }` in services is deliberate, documented, and reached only from workflows that re-check ownership
- Stripe webhook: signature verified first, `StripeEvent` PK dedupe before the switch
- Theme tokens respected — no `text-white`, no forced `dark`, no `bg-[#…]`

**The important caveat:** the test suite is entirely **pure units**. Nothing touches Prisma; no provider is called. A green suite says nothing about the runtime paths below. The honest state is that **no video has ever been generated end-to-end.**

---

## A. Blockers for your first video

| # | Issue | Where |
|---|---|---|
| A1 | **Neon DB unreachable** — `P1001` on `prisma migrate status`. Nothing DB-backed has ever run. ✓ | `DATABASE_URL` |
| A2 | **`ELEVENLABS_API_KEY`, all `R2_*`, all `REMOTION_*` absent from `.env`** — missing entirely, not blank. `.env` has only 45 vars. ✓ | `.env` |
| A3 | **No way to get credits into a workspace.** `grant()` has **zero callers** — no signup grant, no monthly plan allowance, no portal/admin grant. `hold()` has no portal or plan bypass, and `script` + `tts` cost a base of 1 credit each, so a 0-balance workspace dies at the *first* pipeline stage. The only coded path in is `credits.purchase` → a real Stripe payment intent. ✓ | `src/services/credits.service.ts:455` |
| A4 | **Voice catalogue is empty and `voices.sync` has no UI.** Portal-org-only; no `.tsx` caller anywhere, no portal screen, no REST route. Must be hit as a raw HTTP call. ✓ | `src/trpc/routers/voices.ts:227` |
| A5 | **Motion format is a dead end.** Offered in the create form's `<Select>`, but `SCRIPT_WRITERS` has only `voiceover`, `reddit-story`, `quiz` — no `motion` → the paid run fails. Also no UI writes `settings.motion.styleId`. ✓ | `src/lib/script/writers.ts` |
| A6 | **Export card can crash.** `renders.estimate.useQuery` sits *after* an early `return` — a conditional hook. When `plan` goes `null → value` React throws "Rendered more hooks than during the previous render", blanking your only download path. ✓ | `src/components/global/render-panel/render-panel.tsx:209-217` |
| A7 | **Generate's "one click" fails on a fresh project.** The `script` stage needs `settings.script`, written only by the Script screen. The button isn't disabled and the screen says nothing. | `src/inngest/functions/project-generate.ts:551` |

---

## B. Security — fix before any real user has an account

### B1 — BLOCKER: privilege escalation to org owner ✓

`encodedRoleSchema` is `z.string().min(1)` — a fully opaque string. `processRole` returns `"owner"` verbatim. `hasFullAccess` is literally `row.role === "owner"`, which short-circuits **every** permission gate in `protectedProcedure`.

Two independent paths:

1. `member.update` checks `OWNER_ROLES.includes(member.role)` — the **target's current** role — and never inspects `input.role`. Any member holding `member:update` can promote anyone to owner.
2. `invitation.create` with `role: "owner"` stores it on the `Invitation` row; `invitation.accept` copies it verbatim into `Member.role`. The **admin preset grants `invitation:create`** (`ADMIN_PRESET_EXCLUDED` only withholds `billing`), so an admin escalates to full billing access via a second account.

**Fix:** reject any role in `OWNER_ROLES` from untrusted input unless `ctx.memberHasFullAccess`. Ownership transfer should be its own `requireRole: ["owner"]` procedure.

Files: `src/services/role.service.ts:77`, `src/trpc/routers/member.ts:85-113`, `src/trpc/routers/invitation.ts:100-137`, `src/lib/types/team.ts:63`

### B2 — HIGH: arbitrary permission injection ✓

`updateMemberSchema` validates `permissions` against the registry-derived `VALID_PERMISSION_SET` — **and `member.update` never reads `input.permissions`.** It forwards `input.role`, and `processRole` accepts permissions smuggled in that string (`"<name>|||<JSON perms>"` or a bare `"[…]"`). `safeParsePermissions` only filters `typeof === "string"` with **no check against `VALID_PERMISSION_SET`**. The Zod validation on this surface is cosmetic.

**Fix:** validate the decoded array against `VALID_PERMISSION_SET`, and either use `input.permissions` or remove it from the schema so the contract matches reality.

### B3 — HIGH: plan seat-cap bypass ✓

`cancelInvitation` returns `void` via `deleteMany` — it cannot fail. The router then calls `decrementUsage(…, "member", 1)` unconditionally. Call `invitation.cancel` N times with a junk id → the counter reaches 0 → `checkFeatureGate` passes → unlimited seats on free. Contrast `member.delete`, which validates the row exists first.

**Fix:** return `result.count > 0` and only decrement on a real delete; throw `NOT_FOUND` otherwise.

### B4 — HIGH: credit ledger has no unique constraints

`REPLAY_SAFE_TOP_UP` and `DOUBLE_COMMIT_REFUSED` are claimed in comments but implemented as `findFirst` → insert across **separate transactions**, with nothing in the schema to enforce them.

- **Double grant:** `credits.purchase` writes inside the procedure's transaction; the Stripe `payment_intent.succeeded` webhook calls `purchaseCredits(prisma, …)` on its own connection. Neither sees the other's uncommitted row — the pack is granted **twice for one payment**. The `StripeEvent` PK does not help; these are two code paths, not two deliveries.
- **Double settle:** nothing stops one hold receiving both a `commit` and a `release`, refunding a render the customer received.

**Fix:** add `@@unique([refId, kind])` and `@@unique([holdId, kind])` to `CreditLedger`, then catch P2002. The reads become a fast path; the database becomes the guarantee.

### B5 — MEDIUM: the `captions` router's rate limits never fire ✓

The registry key is `captionStyles` (`src/lib/resources.ts:649`); the router mounts as `captions` (`_app.ts:74`). `getResourceFromPath` does a plain `isResourceKey(path.split(".")[0])` → `null` → the entire per-resource rate-limit section is skipped. Every other gated router is deliberately mounted under its registry key.

What is lost: `align: { count: 10, window: "5 m" }`. `captions.align` is a full-narration STT round trip (a provider call per line). A client looping it with `force: true` — which defeats both the `plan.cached` short-circuit and the enqueue idempotency key — runs up a real provider bill with only the global 100/10s limiter in the way. The audit `describe` templates also never resolve.

**Fix:** rename the mount to `captionStyles`.

### B6 — MEDIUM: cancelled subscriptions keep entitlements

No subscription-status allowlist. `past_due`, `unpaid`, `incomplete`, `incomplete_expired` and `canceled` all return the **paid tier** with full limits so long as `current_period_end` is in the future. Entitlements are revoked only by `customer.subscription.deleted`. Grace on `past_due` is defensible; `canceled` is not.

**Fix:** `if (!["active","trialing","past_due"].includes(subscription.status)) return freeTier;`

### B7 — LOW / for decision

Seat gate and seat counter are not atomic in `invitation.create` (TOCTOU, bounded by the global limiter). A real fix belongs in the procedure factory, not one router.

Rate limiting fails **open** on a Redis outage — a deliberate, well-argued decision, not a bug. The one place to weigh it as a product call: `authenticateApiKey`'s `PER_KEY_DAILY_QUOTA` is the *only* throttle on `/api/v1` and `/api/mcp`, so with Redis down a leaked key has no cap. No IP-level limiter guards those surfaces the way one guards `/api/trpc`.

---

## C. Pipeline and render bugs

### C1 — BLOCKER: `script-generate` sets the project to `ready` mid-pipeline ✓

`project-generate` writes `generating` once in `seed-stages`, then `step.invoke`s the script child — which writes `status: "ready"` inside its save transaction. From that commit until `finalize`, across TTS, align, storyboard, design, visuals, QA and timeline (the longest and most expensive part of the run), the project reads `ready`.

Verified consequences:

- `projects.generate` only short-circuits on `status === "generating"` → **a second click launches a second concurrent pipeline** on the same project. The two then race on `replaceNarrationLines` (which `deleteMany`s first) and on the same hold refs.
- `projects.cancel` returns `{cancelled: false}` for any status but `generating` → **Cancel is a no-op for most of the run**, and the child holds are never released.
- The projects list shows a finished video that has no timeline document yet.

**Fix:** drop the status write from the child (let `finalize` own it), or scope it `where: { …, status: { not: "generating" } }`.

File: `src/inngest/functions/script-generate.ts:488-497`

### C2 — HIGH: one zero-duration line kills the whole paid run ✓

The QA stage counts `{ durationSec: null } OR { durationSec: { lte: 0 } }` and completes with "N recorded lines had no measurable audio and were left out." **They are not left out.** `generatorContextFor` filters only `durationSec === null`, so a zero-duration line reaches `layNarration` as an `AudioItem` with `duration: 0`, and the validator rejects it with `BAD_DURATION`. `build-timeline` then fails with the opaque "The video could not be assembled from these pieces" and throws `NonRetriableError` — the run dies *after* the narration was paid for.

**Fix (one word):** `line.durationSec === null || line.durationSec <= 0` at `src/services/pipeline.service.ts:699`, matching the QA query.

### C3 — HIGH: 1-second paid renders ✓

`metadataFromProps` parses the **raw** doc (`src/remotion/root.tsx:81`), while the component runs `dropUnknownRenderKinds` first and parses the sanitised result (`src/remotion/timeline-renderer.tsx:102,110`). `timelineDocSchema` is `.strict()` with a closed render-kind enum, so **one unrecognised render kind** makes the metadata hook fall back to 30 frames @ 30fps while the component draws the real document. The render *succeeds*, is billed, and is one second long. This defeats the entire purpose of the sanitiser (`FORWARD_COMPATIBLE_DOCUMENT`).

**Fix:** `timelineDocSchema.safeParse(dropUnknownRenderKinds(props.doc).doc)`.

### C4 — HIGH: unmetered TTS ✓

`src/inngest/functions/line-resynth.ts` imports no credit functions at all, though `src/trpc/routers/timeline.ts:297` states "the credits are held and settled by the workflow". `project-tts` holds and commits per line; the editor's per-line path does not. Unlimited ElevenLabs synthesis at zero credit cost.

**Fix:** wrap the record step with `hold`/`commit` on a `tts:<lineId>` ref, as `project-tts` does.

### C5 — HIGH: AI images generated for free

`visuals-hold` catches `InsufficientCreditsError`, logs "the images are abandoned and the blocks fall back", and returns `{held: 0}` — but nothing abandons them. The loop still invokes `visual-ingest` for every planned block, and `visual-ingest` performs no credit check of its own. `visuals-settle` finds no open hold and commits nothing, while `incrementUsage("aiImages", …)` still fires.

**Fix:** return `{held, funded}` and skip the ingest loop when `funded === false`.

File: `src/inngest/functions/project-generate.ts:1339-1434`

### C6 — HIGH: re-recording a line leaves every later caption offset

`alignmentAudioHash` hashes only `position:textHash`, and `textHash` covers text + voice — not the audio. The editor's plain "re-record" recomputes the same hash, re-synthesises (TTS is non-deterministic, so duration differs), then enqueues `align/requested` **without `force`**. The plan reports `cached: true` and returns before touching anything. Every caption, quiz card and motion anchor from that line on is shifted. If the new audio is *shorter*, the last word exceeds the track length and `build-timeline` fails outright — note `motion.ts` clamps for exactly this reason while `buildCaptionTrack` does not.

**Fix:** include `audioAssetId`/`durationSec` in the hash, and/or send `force: true` from `line-resynth`.

### C7 — HIGH: a stale webhook can kill a live render

`step.waitForEvent("await-render")` correlates on **your** `Render.id` only; the webhook relay never forwards the provider's render id, and `start-render`'s return value is discarded. So attempt 1 and attempt 2 of the same row emit indistinguishable events. Attempt 1's late webhook matches attempt 2's open wait — if it reports an error, attempt 2 is marked `failed` and refunded while its render is still running and will complete. The row says failed for a video that rendered, the output is orphaned in the Remotion bucket, and the retry budget is already spent.

**Fix:** relay `providerRenderId` and match on both ids.

### C8 — MEDIUM: render-path robustness

- A `render/finished` arriving **before** `waitForEvent` is registered matches no waiter → the run sits until the 45-minute timeout, then recovers correctly but 45 minutes late.
- An **empty timeline** (delete every item in the editor) throws a raw `ZodError` *outside* any step, burning both retries and reporting "Rendering this video did not finish." Nothing rejects it earlier — neither the schema (no `.min(1)`) nor `validate()`.
- `renderMediaOnLambda` **auto-discovers** its bucket while `getRenderProgress` is told the configured `REMOTION_BUCKET_NAME`. If those ever differ, the timeout-recovery path — the one that decides whether to discard a finished, paid render — queries the wrong bucket. Pass `forceBucketName`.
- The finished MP4 is buffered **whole into memory** (`arrayBuffer()`), and download → R2 upload → poster extraction → transaction all sit in one `step.run` bounded by `maxDuration = 300`. Fine for short-form today; on timeout the whole copy re-runs and after two retries a good paid render is marked failed. Stream it.
- A timed-out render is **never cancelled at the provider** — the Lambda fan-out keeps running and billing AWS. `RenderAdapter` has no `cancel` method.

### C9 — MEDIUM: free users preview clean and download watermarked ✓

Both the preview and the editor mount `TimelineRenderer` with `inputProps={{ doc, assets }}` — no `watermark`, which defaults to `false`. `projects.preview` never returns the `watermarkFree` entitlement, though it is already resolved server-side in `createRenderOperation`. The preview header claims it "mounts the SAME composition the renderer uses".

### C10 — MEDIUM: three surfaces can spin forever

- **Generate** polls `projects.getStages` every 2s **unconditionally and indefinitely** — on a fresh project (where `stages.every(...)` on an empty array closes the stream immediately) and on any finished project. Every other polled surface in the app uses the predicate form. Fix: `refetchInterval: streaming || !run.active ? false : PIPELINE_POLL_MS`.
- **Script** poll starves itself: the effect depends on the whole query object, so the 2s interval is torn down and recreated on every re-render, and the sibling `scripts.list` poll fires at exactly the same 2000ms. The card can stay on "Writing your script…" permanently. Fix: depend on `[project.data?.status, project.refetch]`.
- **Captions** hangs on "Timing…" forever when `project-align` throws `NonRetriableError` before writing any alignment row — `isAligning` returns true whenever `alignment === null`, with no error shown.

### C11 — MEDIUM: the whole Prisma client ships to the browser

`src/lib/config/prisma.ts` constructs the singleton at module scope with **no `import "server-only"`**, and `src/lib/config/index.ts` re-exports it. 17 client components import that barrel for route/branding constants. Confirmed in the committed build: `.next/static/chunks/0w048see97k2_.js` (291 KB) contains `prismaVersion`, `PrismaClientKnownRequestError` and `globalThis.__prisma ?? new i.PrismaClient;`.

It does not crash — the browser build's constructor is a Proxy that only throws on property access — but it is 291 KB of dead weight on first paint for every page, and a CLAUDE.md rule-3 gap.

**Fix:** add `import "server-only"` to `prisma.ts` / `stripe.ts` / `resend.ts` and point client components at the leaf modules (`@/lib/config/routes`, `branding`, `plans`).

### C12 — Smaller items

- **`failAndRelease` writes project status by id with no `organizationId`** ✓ — the only project write in the pipeline that breaks `RECHECK_OWNERSHIP_IN_THE_WORKFLOW`. `src/inngest/functions/script-generate.ts:589`
- **The model's script title is never applied** ✓ — `...(draft.title.length > 0 ? {} : {})`, both branches empty. Dead code; the comment describes behaviour that does not happen. `script-generate.ts:492`
- **Four enqueue sites use content-shaped idempotency keys**, so a deliberate re-run is silently swallowed for 24h. Worst is `captions.align`, where `force` is in the payload but **not** in the key — breaking the exact recovery path the UI advertises ("Re-align from the captions screen to try again"). Also `voices.ts:339` (fixed key per project), `operations/scripts.ts:156` (same source + settings never yields a second draft), and `timeline.ts:344` (keyed on `length + slice(0,40)`, so two same-length edits past char 40 collapse).
- **Pipeline stage order diverges from `PIPELINE_STAGES`** — storyboard/design run before visuals. Latent today because no kind runs both; the first format that does will complete progress rows out of order, which `STAGE_ORDER_IS_THE_TUPLE` exists to prevent.
- **No navigation between pipeline steps.** There is no `projects/[id]/page.tsx`, the table title cell is plain text, the row is inert, and the four pipeline screens contain zero `Link`/`router.push`. Script → Voices → Captions → Generate means a round trip through the sidebar and the row `⋯` menu each time. The create sheet doesn't navigate to the new project either.
- **`sourceRef` collected on create is never read by any UI** — the user types their topic/URL, then is asked for it again on the Script screen with an empty box.
- **An unreadable project renders a working-looking screen.** Script and Generate gate only on `isPending` with `retry: false` and never inspect `project.error`, so a deleted/forbidden id looks like a normal empty project. `ProjectPreview` gets this right — copy that pattern.
- **The `avatars` router has no UI entry point at all** — `list`/`assign`/`sync` are mounted and unreachable.
- **Dashboard home ships scaffold copy** telling your *customer* to "declare them in src/lib/resources.ts", and has no "create your first video" CTA.
- **`/` is a blank client-side redirector** — no landing page. An anonymous visitor sees a white screen, then sign-in.
- **Two client components import a type from a `server-only` service** (`payment-method-option.tsx`, `payment-method-row.tsx`). `import type` is erased so it works today; the type belongs in `lib/types`.
- **`.env.example` is stale** relative to `required-env.ts` — missing the Reddit, video, Sentry, PostHog and cost-alert vars, and documenting no AWS credentials at all.

---

## D. The plan — steps to your first video

Use **`voiceover`** as the format. It is the only cheap complete path: no Reddit credentials, no avatars, and it renders over a palette backdrop, so the deliberately empty background catalogue does not block it. ✓

### Step 0 — Fix four things first (~30 min, saves money and confusion)

1. **C2** — one-word fix, or your run dies *after* you have paid for narration.
2. **A6** — move the `useQuery` above the early return, or your download button can vanish.
3. **C1** — drop the `status: "ready"` write from the script child, or Cancel will not work and a double-click launches two concurrent pipelines.
4. **A5** — remove `motion` from the create form's options so you cannot pick a dead end.

### Step 1 — Database

The Neon endpoint is gone (not merely suspended). Create a new Neon project, update `DATABASE_URL`, then:

```
npx prisma generate
npx prisma migrate deploy
```

Use `migrate deploy`, **not `db push`** — there are 15 committed migrations and a linear history; `db push` would desync `_prisma_migrations`.

### Step 2 — Credentials

Add to `.env`:

- `ELEVENLABS_API_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`

Add an R2 lifecycle rule deleting `tmp/` after 24h. Install **ffmpeg + ffprobe** on PATH — required for every upload, and it runs in the process serving `/api/inngest`, so that must be a long-lived container (local `next dev` is fine).

### Step 3 — Run it

Two long-running processes:

```
npx inngest-cli@latest dev     # without this, /api/inngest 500s on "no signing key found"
npm run dev
```

If `npm install` is needed, use `--legacy-peer-deps`.

### Step 4 — Account

Sign up as your `PORTAL_INITIAL_OWNER_EMAIL`. A personal workspace auto-creates, so onboarding is skipped. **Verify your email** — it is a hard generation gate on free (`VERIFICATION_IS_A_GENERATION_GATE`; only the `free` plan requires it ✓). With `RESEND_API_KEY` unset, Better Auth logs the verification URL to the server console, and `dev.getPendingEmail` surfaces it ✓ — no Resend account needed.

### Step 5 — Get credits in (blocker A3)

No UI path exists without Stripe. Fastest dev route:

```
npx prisma studio
```

→ `CreditLedger` → new row: your `organizationId`, `kind: "grant"`, `delta: 500`. The schema comment confirms positive delta for grants ✓.

Alternatively configure Stripe test mode plus `STRIPE_CREDIT_PACK_*_PRICE` and buy a pack via `credits.purchase`.

**Do not ship without wiring `grant()`** to signup or a monthly plan allowance — see A3.

### Step 6 — Seed the voice catalogue (blocker A4)

No UI exists. With your portal-owner session cookie, POST to `/api/trpc/voices.sync` with `{ organizationId: <portal org id> }`. Run with `dryRun: true` first. Requires `ELEVENLABS_API_KEY`.

### Step 7 — Make the video

1. Create project → **format: voiceover** → give it a topic
2. **Script** screen *first* (per A7, Generate alone fails) → write / edit blocks
3. **Voices** → assign a voice per speaker → "Record narration"
4. **Captions** → "Time the captions" → pick a style
5. **Generate** → background + visual pickers → watch stage progress
6. "Open the preview"

Expect to click back through the sidebar and the row `⋯` menu between every step — there is no step-to-step navigation yet (C12).

This yields a **previewable video in the browser**. The pipeline writes `render` as `skipped` by design; export is the separate `renders.create`.

### Step 8 — Export the MP4

Only now is AWS needed:

```
npx remotion lambda functions deploy
npx remotion lambda sites create src/remotion/index.ts --site-name=<name>
```

Then fill `REMOTION_AWS_REGION`, `REMOTION_FUNCTION_NAME`, `REMOTION_BUCKET_NAME`, `REMOTION_SITE_NAME`, `REMOTION_SITE_VERSION`, and `REMOTION_WEBHOOK_SECRET` (a render **cannot finish** without it — the webhook refuses unverifiable calls).

Two gotchas:

- **Set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` yourself.** Nothing in the repo reads them; they appear in neither `.env.example` nor the setup checklist. `@remotion/lambda-client` picks them up from the environment, so a missing pair fails with an AWS auth error the checklist will not explain. ✓
- **Point `NEXT_PUBLIC_APP_URL` at a tunnel** (ngrok/cloudflared). Lambda calls back to that URL and cannot reach localhost — renders otherwise start and then time out.

Then: Export panel → resolution → Render video → Download.

---

## E. Decisions, not bugs

- **All credit rates are placeholders** and have never been priced against actual provider cost. `CREDIT_RATES` carries its own `THE_RATE_MUST_EXCEED_THE_COST` warning, and `aiFootage` at 8 credits/sec is explicitly anchored to nothing because the model has not been chosen. Setting real prices is one edit to one object. **Do not charge anyone yet.**
- **Three licensing questions gate features regardless of code:** gameplay-footage licensing (backgrounds), the video model's commercial-use terms (AI footage), and music/SFX licences permitting end-user publication and monetisation. The background and avatar manifests are empty **on purpose**, and their Zod schemas reject placeholder licence strings ("owned", "CC0", "fair use") at module scope — so they cannot be filled with stand-in data.
- **Remotion licensing:** free for individuals and small teams; a paid company licence applies beyond that.
- **Two Phase-10 launch blockers remain open:** visual moderation of uploads is not implemented, and the legal copy needs a lawyer.

---

## F. Suggested order of work

1. **Step 0** above — four small fixes, then run the first video through.
2. **Section B1–B3** — the escalation path is roughly a two-line input fix and must land before anyone else has an account.
3. **B4** — ledger unique constraints, before real money moves.
4. **C4, C5, C6** — the three unmetered / mis-cached paths that cost you provider money.
5. **C7, C8** — render correctness, before anyone pays for an export.
6. **C10, C12** — the polling leaks and the missing step navigation, which are the first things a real user will notice.
7. **A3, A4** — wire `grant()` and give the catalogue syncs an operator surface, so onboarding does not need Prisma Studio and a cURL call.
