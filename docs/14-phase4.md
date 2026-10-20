<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 04 — cloud rendering

`docs/13-phase3.md` describes the composition that turns a document into frames. This page
describes running it somewhere else: on Remotion Lambda, awaited by webhook, with the output stored
as an ordinary asset and an unchanged project costing nothing to re-export.

Read this before Phase 05 (credits hold and commit around these steps) and Phase 15 (editing a
document invalidates its renders). Read **The cache key is not the document hash** first — it is
the one decision here that is silently wrong in the obvious implementation, and it has a bill
attached.

## The one-sentence version

`renders.create` validates, prices and records a request then returns; a durable workflow
pre-flights the assets, starts one Lambda render and **suspends**; the provider's signed webhook
relays completion onto the queue; and `finalize` copies the MP4 into R2 as a `render_output` asset.

## Where the code lives

| Path | Contains | Reaches the provider? |
| --- | --- | --- |
| `src/lib/render/cache-key.ts` | the reuse key | **no** — pure |
| `src/lib/adapters/render/` | the `RenderAdapter` contract + selector | no |
| `src/lib/adapters/render/lambda/` | Remotion Lambda, config, webhook crypto | **yes, only here** |
| `src/services/renders.service.ts` | every `render` row read and write | no |
| `src/trpc/routers/renders.ts` | gates, pricing, reuse, retry policy | no |
| `src/inngest/functions/project-render.ts` | the five steps | via the adapter |
| `src/app/api/webhooks/remotion/route.ts` | verify and relay, nothing else | — |

eslint confines `@remotion/lambda*` to the `lambda/` folder, exactly as it confines the S3 SDK to
`storage/r2/` and `node:child_process` to `media/ffmpeg/`. The SDK drags the AWS SDK and the whole
Remotion bundler with it, so it must never be evaluated in a process that is not rendering.

`remotion` and `@remotion/player` are deliberately **not** fenced — they are the composition and
the preview player, which are app code.

## Rule 1 — the cache key is not the document hash

`@@unique([projectId, docHash])` is what the brief calls the thing that makes reuse "correct rather
than best-effort". That is only true if the key says everything about the **file**. `hashDoc()`
says everything about the **document**, which is a different claim.

So `Render.docHash` stores `renderCacheKey()`, not `hashDoc()`:

```
v1-a1b2c3d4e5f60718-1080p-wm0
│  │                │     └── watermark
│  │                └──────── resolution
│  └───────────────────────── hashDoc(doc)
└──────────────────────────── RENDER_KEY_VERSION
```

Storing a bare document hash breaks in both directions, and both are reachable on day one:

| Bug | What the customer sees |
| --- | --- |
| 720p render satisfies a 1080p request | asked for HD, paid nothing, got the file they had |
| free workspace's watermarked file returned after upgrading | the first thing a new subscriber exports is still watermarked |

The second is the worse one, because it looks like the upgrade did nothing.

It is **readable rather than re-hashed** — an operator can tell what a row was for without running
code, and re-hashing buys nothing: this is a cache key behind a unique index, not a value anyone
must be prevented from reversing. The document half is already a hash, so length stays bounded.

**`RENDER_KEY_VERSION` is the escape hatch for the case the scheme cannot express:** a change to
`src/remotion/` that changes the picture without changing any document — a font swap, a moved
overlay, a fixed ducking curve. Every existing render would otherwise be reused and no customer
would ever see the fix. Bumping it invalidates the whole cache deliberately.

`cache-key.test.ts` has a `satisfies Record<keyof RenderCacheInputs, true>` guard, so adding a
field to the inputs fails to compile until somebody decides — in a diff — whether it belongs in the
key.

## Rule 2 — wait, don't poll

`step.waitForEvent` suspends the run entirely: no process, no timer, no cost, until the webhook
relays `render/finished` or 45 minutes elapse.

A polling loop is not merely wasteful here, it is broken. `maxDuration` on
`src/app/api/inngest/route.ts` bounds **one step** at five minutes, so a step that waited out a
forty-minute render would time out, retry from the top, and **start a second paid render of the
same video**.

The same reasoning splits the work: starting the render returns in a second and is one step; the
wait lasts as long as the render and is another. Grep `START_AND_AWAIT_ARE_DIFFERENT_STEPS`.

```
validate → resolve-assets → hold-credits¹ → start-render → ⏸ waitForEvent → finalize
                                                              ↑
                                         POST /api/webhooks/remotion relays it
```

¹ added by Phase 05 — see `docs/15-phase5.md`.

## Rule 3 — pre-flight before paying

Every asset is resolved to a six-hour signed URL **and HEAD-checked against the bucket** before a
single Lambda is invoked.

Both halves matter and the second is the one that catches the real case: **signing is local HMAC
and succeeds for an object that is not there.** A row pointing at a deleted object yields a
perfectly valid URL that 404s inside the renderer, forty minutes and one invoice later.

`signDocumentAssets` returning `url: null` is right for a **preview** — a hole beats a blank screen
(`MISSING_ASSET_IS_NOT_AN_ERROR`) — and wrong for a render somebody is being charged for. The
pre-flight promotes that null into a refusal. Grep `PREFLIGHT_BEFORE_PAYING`.

The TTL is six hours rather than the default fifteen minutes because a queued render may fetch its
media hours after the URLs were signed, and the renderer runs where this process cannot re-sign for
it.

## Rule 4 — the watermark is an entitlement, resolved exactly once

**The brief says `finalize` sets the watermark from `checkBooleanFeature`. It cannot**, and this is
the phase's most consequential correction:

- It is a **composition prop**, so it decides pixels. By `finalize` the frames already exist.
- It is **inside the cache key**. If the workflow re-resolved it and the plan had changed in
  between, the file produced would not match the key it is stored under — and the next request
  would be served a render whose watermark state its key denies.

So it is resolved once, in `renders.create`, written to the row, and read **from the row** by the
workflow. The entitlement is still the only source, which is what the brief's rule was protecting:
a generator never decides it. Grep `WATERMARK_RESOLVED_ONCE`.

The component itself sits **outside the walked plan**, mounted last. An overlay item in the
document would be covered by `hashDoc`, visible in Phase 15's editor, deletable by the customer,
and chosen by whatever generated the document. Grep `WATERMARK_IS_NOT_A_TRACK_ITEM`.

> **A real render found the bug here.** The first version used near-white text with a soft shadow,
> copying `TextOverlay`. Against footage with a white vertical band it vanished completely. That is
> not cosmetic for a watermark: a mark that disappears over pale footage is a free export for
> anyone whose video has a bright bottom third — most screen recordings, every white-background
> explainer. It now sits on a translucent dark pill, inset 6% from the bottom so cropping it out
> costs a visible slice of the video. Grep `WATERMARK_NEEDS_ITS_OWN_BACKGROUND`.

## Rule 5 — the webhook verifies and relays, and does nothing else

**The brief has the webhook store the MP4 and the poster as assets. It should not**, for three
reasons that point the same way:

1. The copy is tens of megabytes down from the provider and back up to R2, plus an ffmpeg
   invocation for the poster — precisely the work `FFMPEG_RUNS_IN_A_CONTAINER` says must not happen
   in a serverless function.
2. Remotion retries a webhook that does not return 2xx, so a slow copy produces a **second
   delivery while the first is still running**.
3. If the copy failed there the event would never be sent, so the workflow would wait out its full
   45 minutes and record `timedOut` — reporting a storage failure as a render timeout, which sends
   whoever investigates to the wrong system entirely.

So the copy happens in `finalize`: a resumable step, with retries, in the container that already
has ffmpeg. The brief's intent — the output ends up as a `render_output` asset — is unchanged. Grep
`FINALIZE_DOES_THE_COPY`.

### The signature is over re-stringified JSON

This is the **one place this route differs from the Stripe webhook it is otherwise modelled on**,
and the difference is invisible until every render stalls:

| | Signs | So the handler must |
| --- | --- | --- |
| Stripe | the **raw body** | read `request.text()`, never parse first |
| Remotion | `JSON.stringify(body)` | **parse first**, verify the parsed value |

Passing raw bytes to Remotion's verifier fails for every genuine call. "Follow the Stripe webhook"
would lead straight to a handler that rejects everything. Grep
`SIGNATURE_IS_OVER_RESTRINGIFIED_JSON`; `webhook.test.ts` asserts it with an HMAC built the way the
provider builds it, so the test fails if someone "fixes" the route back to raw bytes.

### Three more webhook decisions

- **The payload schema is NOT `.strict()`** — inverting the rule everywhere else in this codebase,
  because somebody else writes that object. The provider adds fields in minor versions and a strict
  schema would reject a whole payload for a field nobody reads, stalling every render in flight on
  the next upgrade.
- **Our row is found via `customData.renderId`**, not `providerRenderId`. There is a window between
  the provider accepting a render and our transaction committing its id, and a fast render can call
  back inside it. Matching on data we chose ourselves has no such window.
- **A correctly-signed call we cannot act on gets a 200.** A deleted render will not exist on the
  provider's retry schedule either. A call we could not *verify* gets a 400; a failed **enqueue**
  gets a 500, because that is the one case where a retry genuinely helps.

## Rule 6 — terminal is final

`completed`, `failed` and `timedOut` are end states, and every write that sets or follows one
filters on the status it expects (`updateMany`, never `update`). Two live bugs depend on it, both
ordinary consequences of at-least-once delivery and a parallel renderer:

- A **late webhook** for a render already marked `timedOut` would resurrect it — so a customer sees
  a render succeed after being told it failed, while `attempts` has already been spent re-rendering
  the same thing.
- A **progress write after completion** would move a finished render backwards and strand the UI on
  a spinner over a video that exists.

Grep `TERMINAL_IS_FINAL`.

### A dropped webhook is not a failed render

From inside the wait, a render that died and one that finished while our webhook was briefly
unreachable look identical — and they call for opposite actions. Writing `timedOut` without asking
throws away a video that exists and has been paid for, then invites the customer to spend their one
retry re-rendering it.

So the timeout branch makes **one** call to `getProgress` — the only sanctioned one, at the end of
the window, never a loop. If the provider says it completed, the output is stored exactly as the
webhook path would have stored it. Grep `A_DROPPED_WEBHOOK_IS_NOT_A_FAILED_RENDER` and
`PROGRESS_IS_FOR_THE_TIMEOUT_PATH`.

## Reuse, and why it costs nothing

`renders.create` checks for a completed render under the same key **before** creating a row. Two
filters are load-bearing: `status: 'completed'` excludes rows with no file behind them, and a
failed row must not become the project's permanent answer — a momentary outage would otherwise
refuse that document forever.

**The counter has to be cancelled by hand.** The procedure factory auto-increments on any
successful `<resource>.create` and cannot see that the handler reused a row, so without a
correction a free re-download would spend a monthly render. The handler calls
`incrementUsage(..., -1)` and the factory's `+1` lands on top inside the same transaction, netting
zero.

It is deliberately **not** `decrementUsage`, which floors at zero: a render made in January is
still reusable in February, when the periodic counter has been reset to 0, and flooring there would
charge 1 for a render that cost nothing.

> **One caveat, stated rather than hidden.** The factory's *gate* runs before the handler, so a
> workspace at its monthly cap is refused even on a reuse. It does not bite in practice — nothing
> has to call `create` to get an existing video, because the panel reads `renders.list` and
> `renders.get`, both plain queries with no limit gate.

Grep `REUSE_COSTS_NOTHING`.

## Retry, exactly once

`providerRenderId` is **unique**, which is what makes "one retry with a fresh id" enforceable
rather than aspirational. `prepareRenderRetry` clears it — not tidiness: leaving the old id would
collide on the retry's own `markRenderStarted`, and it would let a late webhook for the *first*
attempt match this row.

A retry costs no quota, because the factory bumps only on `create` and the first attempt failed
through no choice of the customer's. `attempts` is what stops that being a way to render forever,
and the limit is enforced twice — a readable refusal in the router, and an `attempts: { lt: limit }`
filter in the service so two simultaneous clicks produce one retry.

The enqueue id carries the attempt number. Without it the retry would deduplicate against the
original run and nothing would happen, which presents as a button that does nothing.

## The composition gap Phase 03 left

A `<Composition>` fixes its `durationInFrames` at **registration** time — when the bundle is built,
long before anyone asks for a render. The Phase 03 compositions were registered from fixtures, so
they would have rendered **every document at the fixture's length**: a 60-second project handed to
a composition registered from a 7.6-second fixture produces 7.6 seconds of video. It succeeds, it
is billed, and the only symptom is a video that stops mid-sentence.

So Phase 04 adds a `timeline` composition with `calculateMetadata`, which runs with the real
`inputProps` in hand and derives everything from `planComposition()`. The fixture compositions were
moved onto the same function, so the studio exercises the path a paid render depends on. Grep
`METADATA_FROM_THE_PROPS` and `ONE_PRODUCTION_COMPOSITION`.

## Deploys are versioned, and that is what makes them safe

The serve URL is **composed** from the bucket, site name and `REMOTION_SITE_VERSION`:

```
https://{bucket}.s3.{region}.amazonaws.com/sites/{site}-{version}/index.html
```

A render resolves it once, at start, and carries it for its whole life. Without that, deploying
mid-render swaps the bundle under a render whose chunks are already being produced **in parallel** —
and the result is not a failed render but a video whose first half came from one build and whose
second half came from another. It succeeds, it is paid for, and nothing in the logs explains why
the output changes halfway through.

Rolling back is putting the old value back in the environment. No redeploy, no code change. Grep
`VERSIONED_SITE_URL`.

A hand-written `REMOTION_SERVE_URL` plus a separate version variable would be two sources of truth
for one address, and they drift silently.

## Status

Phase 04's box in `docs/phases/PROGRESS.md` is **unticked**, and the reason is broad: **no render
has ever run in the cloud.** There is no AWS account, nothing is deployed, and `REMOTION_*` is
unset.

What **is** verified:

- A real local render, **byte-identical by sha256** to the Phase 03 renders taken before any of
  this phase's changes — so `calculateMetadata` changed the plumbing and not one pixel.
- The watermark composites, **looked at in an extracted frame** rather than inferred. The
  invisibility bug above was found this way and could not have been found any other way.
- The webhook's signature path, probed against a running server: 400 unsigned, 400 wrong-secret,
  400 non-JSON, 503 unconfigured, and **200 with a correct HMAC** — with `render/finished`
  confirmed on the Inngest queue by GraphQL.
- Both workflows registered and served; at the close of this phase `/api/inngest` reported six
  functions — four declared plus two `onFailure` handlers. (Phase 05 adds `credits.reconcile`, so
  the number you see today is higher.)
- `next build` clean with `/api/webhooks/remotion` present.
- The migration is **applied**; `migrate diff` reports no drift and both unique constraints exist.

What is **not**: a 60-second render completing on Lambda; reuse returning an existing output
end-to-end; a broken composition failing cleanly; a timeout being retried; a new site version not
breaking a render in flight; and the watermark **entitlement** path from `checkBooleanFeature`
through the row to the prop. Only the webhook-rejection check of the seven "done when" items is
verified.

**R2 is also still unconfigured** (carried from Phase 02), so `finalize` has never copied an output
into a bucket and `signAssetUrl` has never produced a download link.

## What Phase 04 did not finish

- **Credits.** `creditsCharged` and `costBreakdown` stay null — Phase 05 fills them.
- **Draft and preview renders.** Out of scope; every render is a final render today.
- **Local development needs a tunnel.** The renderer calls back to `NEXT_PUBLIC_APP_URL` and AWS
  cannot reach localhost, so a local render will start and then time out without one.
- **`npm install` needs `--legacy-peer-deps`.** A plain install crashes with
  `Cannot read properties of null (reading 'edgesOut')` resolving `better-auth`'s peers — an
  npm/arborist bug that reproduces on the unmodified lockfile. Watch CI's `npm ci`.
- **Remotion requires a paid company licence beyond individuals and small teams.** Phase 03 raised
  it; this is the phase where it starts running on infrastructure at scale.

## Where to go next

`docs/15-phase5.md` — credits. Three things from this phase it builds on directly:

- **`estimateRenderCost` prices the frame count** `planComposition()` already derives.
- **The five workflow steps are where the hold, commit and release hang.** `finalize` commits in
  the same transaction as the asset rows; every failure path refunds.
- **`onFailure` is the safety net.** It already marks the row honest; Phase 05 makes it give the
  money back too, and if it is ever unwired a crash strands a customer's credits.
