# Build progress

Tick a phase and add a dated note — what was built, and anything deferred — when its "Done when"
checks pass. If a check was deferred rather than met, say so explicitly; a tick that is not true is
worse than an empty box.

- [x] Phase 00: Foundations and seams — 2026-10-18
- [x] Phase 01: Timeline document — all checks met; verified end to end 2026-10-19.
- [ ] Phase 02: Media assets and storage — built; **blocked on R2 credentials** for the ingest
      round-trip. See the note below for exactly which checks are met and which are untested.
- [ ] Phase 03: Render core — built and rendering; the Player has no real document to mount
      until generation exists (Phase 06/09). See the note below.
- [ ] Phase 04: Cloud rendering — built; **blocked on an AWS account** for the Lambda deploy, so no
      render has ever run in the cloud. See the note below for exactly which checks are met and
      which are untested.
- [ ] Phase 05: Credits and entitlements
- [ ] Phase 06: Script generation
- [ ] Phase 07: Voices and TTS
- [ ] Phase 08: Alignment and captions
- [ ] Phase 09: The generate pipeline
- [ ] Phase 10: Safety, limits and launch — **ships public beta**
- [ ] Phase 11: Backgrounds library
- [ ] Phase 12: Reddit story format
- [ ] Phase 13: Quiz format
- [ ] Phase 14: Voiceover visuals
- [ ] Phase 15: Timeline editor
- [ ] Phase 16: Motion graphics studio
- [ ] Phase 17: Platform surface

## Blocked on an owner decision

These cannot be unblocked by writing code. Settle each before its phase starts.

- [ ] **Gameplay-footage licensing** (Phase 11) — the largest non-technical risk in the product.
- [ ] **Commercial-use terms for the chosen video model** (Phase 17).
- [ ] **Music and SFX licences** must explicitly permit end-user publication and monetisation
      (Phase 11).

## Notes

### Phase 00 — 2026-10-18

Built: npm/CI/Vitest (91 tests), registry cleanup + `period`, Zod public env, jobs seam
(Inngest) + `hello`, storage seam (R2) + key convention, slot-based `DataTable` (+ both
existing screens migrated), periodic usage windows, personal-workspace auto-create, and
the post-signup plan step.

**Verified end to end:** a fresh signup with zero memberships reaches `/dashboard` through
one redirect, with `Jatin's workspace` created and owner membership set; a second visit
redirects zero times. Inngest ran `hello/requested` to `Completed` against the dev server.
Both eslint provider fences were probed with throwaway violations and rejected.

**Deferred, needs you:**
- `npx prisma migrate dev --name member_unique_and_indexes` — schema is updated and the
  diff is just two indexes; checked for duplicate `(organizationId, userId)` pairs first
  and found none.
- The R2 round-trip. Adapter, keys and tests are in; the smoke test needs a real bucket
  and the five `R2_*` variables. Also still needs the lifecycle rule deleting `tmp/` after
  24 hours — the key convention assumes it and nothing in code enforces it.
- Visual review of the two migrated list screens. They were `Card` + `divide-y` rows and
  are now real tables, so the look changed.

**Corrected along the way:** the two `as Route` lint errors were NOT removable — `Route` is
generated into `.next/types` by the build, so `tsc --noEmit` and eslint both lie about them
without it. CI now runs `npm run build` first for exactly this reason.

### Phase 01 — 2026-10-19

**First, a correction to the branch state.** `phase/01-timeline-document` was pointing at the
baseline commit, not at the Phase 00 tip — the history is linear and the branch had been cut from
`2dfebb1`, so none of Phase 00 was present. Fast-forwarded to `phase/00-foundations` before
starting; nothing was lost.

Built: `src/lib/timeline/` (the v4 document schema, `validate`, `migrate`, `apply`,
`resolveWordAnchors`, `hashDoc`, and the shared time maths), five fixtures, the `Project` and
`Timeline` models, the `projects` registry entry, `projects.service.ts`, the `projects` router
(`create` / `list` / `get` / `rename` / `delete` / `duplicate`) and the `/dashboard/projects`
screen. 196 new tests; the suite is 287 and green, `tsc --noEmit` and `eslint` are clean, and
`next build` succeeds with `/dashboard/projects` present.

**Decisions worth knowing about, because none of them were in the phase file:**

- **A duration anchor is an END, not a start.** `{ start: { wordIndex: 4 } }` means "when word 4
  is spoken"; `{ duration: { word: 'anyway' } }` means "until 'anyway' has been said", measured
  to that word's end. Resolving a duration anchor the same way as a start produces a duration
  equal to a timestamp — a nonsense number that happens to be positive, so it renders.
- **`timing: 'anchored' | 'resolved'` is a field on the document.** The phase says `validate`
  must reject a resolved document still holding anchors, which means `validate(doc)` has to know
  the expectation; carrying it on the document is what keeps the signature one argument.
- **An item's `assetId` is a key into `doc.assets`, not an Asset row id.** That is what
  `architecture.md`'s example shows, and it is genuinely confusing, so it is documented loudly in
  `schema.ts` as ASSET_HANDLE_INDIRECTION.
- **The video's length is the span of the video and audio lanes only** (SPINE_TRACKS). A document
  with neither — a pure motion piece — falls back to the furthest point on any lane, which makes
  the out-of-range rule vacuous for it rather than failing everything at zero.
- **`trim`, `split` and `move` refuse caption items.** A caption's timing is derived from the
  words it covers, so "make this caption longer" is not an operation on the caption.
  `setCaptionText` edits the words instead, redistributes the span in proportion to word length,
  and shifts every later caption's word range — skipping that last part is how an edit near the
  top of a script desyncs the rest of the video.
- **`hashDoc` is FNV-1a, not SHA-256.** The module is pure, so `node:crypto` is out and
  WebCrypto's digest is async, which would make `hashDoc` uncallable from a render path. It is a
  cache key, not a security boundary.
- **`projects.duplicate` checks the plan cap and bumps the counter by hand.** The procedure
  factory gates on the path segment `create` and nothing else, so `duplicate` would otherwise
  slip past the cap and leave the counter one short. It is the one handler in the router that
  touches either, and it says so.
- **`createProjectSchema.aspect` is required, not defaulted.** A zod `.default()` makes the
  schema's input and output types differ, which breaks React Hook Form's resolver typing
  outright.

**Caught by the tests, not by review:** `resolveWordAnchors` writes caption times snapped to the
frame grid, while `validate` was comparing that cache against the raw word times at microsecond
tolerance — so every document the resolver produced failed validation. The tolerance is now one
frame, which is the precision the resolver actually works at.

**Verified end to end (2026-10-19, after the migration was applied).** Driven in a headless
browser against `next dev`, on a throwaway account, with `RESEND_API_KEY` unset for that process
so the verification link went to the dev outbox and **no real email was sent**:

- Create, list, rename, duplicate (twice) and delete all work from the UI. The empty state, the
  filtered empty state, the `· copy` subtitle from `parentId`, the confirm dialog's "cannot be
  undone", and the toasts all render.
- The per-format source field switches with the format and disappears for `motion`.
- Search and both facets filter correctly, and the request carries the normalised input
  (`{"search":"zzzz"}` — the `all` sentinel never reaches the wire).
- **The plan limit holds on both sides.** At 3 projects on free, "New project" opens the upgrade
  modal instead of the create sheet, carrying the registry's own copy — "Upgrade to Starter for
  more projects" — and the plan table reads 3 / 30 projects straight from `limit.perPlan`.
  Calling `projects.create` over tRPC directly, bypassing the client gate, returns **403
  FORBIDDEN: "Current usage: 3/3"**; `projects.duplicate` with a real id returns the same,
  which is the hand-written `EXPLICIT_GATE_ON_DUPLICATE` check firing.
- **The usage counter is honest in both directions.** It read 0 → 3 → 0 across the run, so the
  factory's auto-increment on `create`, the hand-written increment in `duplicate` (two of the
  three) and the auto-decrement on `delete` all landed.
- The sidebar entry appears from `RESOURCES.projects.nav` with no nav wiring, and `Audit Logs`
  is correctly absent on free.
- Zero console errors and zero failed requests on every screen, apart from the 403/404s this
  probe deliberately caused.

All QA rows were deleted afterwards; the workspace is back to empty with the counter at 0.

**One finding, NOT in Phase 01's code — pre-existing, in the dashboard shell.** A single
hydration mismatch fired on the first load of `/dashboard/projects`, in
`SidebarProvider`/`Sidebar`/`SidebarInset`. The cause is `useIsMobile()`
(`src/hooks/use-mobile.ts`), whose lazy initial read returns `false` on the server, against
`src/components/ui/sidebar.tsx:185`, which branches on it **structurally**
(`if (isMobile) return <Sheet>`). Server renders the desktop tree, a narrow client renders the
sheet, React discards the tree. It affects every dashboard page, not just this one, and it only
shows at mobile width — which is why manual desktop testing has never hit it. Not reproduced on
the four subsequent hard loads of the same page, and the projects screen contributes none of the
mismatched nodes. Worth fixing (SSR-safe `isMobile`, or a CSS-only branch) but it is not this
phase's and not a blocker.

**Still outstanding, by design:**
- The branch policy is written down and the data shape is settled (`parentId`, `manualEdited`),
  but nothing regenerates yet, so it is a contract rather than a behaviour until Phase 15.
- `Timeline.revision` is returned by `projects.get` and no write checks it. Optimistic
  concurrency is Phase 15's.
- One leftover artifact: the throwaway QA account `qa-phase01-check@example.com` and its
  auto-created workspace. Its projects are deleted; the user and org rows remain.

### Phase 02 — 2026-10-19

Built: the `Asset` / `AssetVariant` models and their migration (applied), the `assets` registry
entry, `src/lib/types/asset.ts` (the content-type allowlist, the per-plan per-file caps, every
input schema and the toolbar normalizer), the `media` adapter seam
(`src/lib/adapters/media/` — contract, provider selector, ffmpeg implementation),
`src/lib/media/` (the pure `ingest-plan` and the server-only `staging`), `assets.service.ts`,
the `assets` router, the `asset.ingest` workflow, the reusable `<MediaUpload>` drop zone, the
reusable `<UsageMeter>`, and `/dashboard/media`. 52 new tests; the suite is 339 and green,
`tsc --noEmit` and `eslint` are clean, and `next build` succeeds with `/dashboard/media` present.

**Where ffmpeg runs — the decision the phase asked for.** It runs IN THE PROCESS THAT RUNS THE
WORKFLOW, which therefore has to be a long-lived container (a Node worker serving `/api/inngest`,
or a dedicated worker image) and **not** a serverless function: an ffmpeg build is larger than a
serverless bundle, a transcode outlasts a serverless execution budget, and a retried step needs a
real local disk. Lambda is the right answer for *rendering* in Phase 04 and the wrong one here —
ingest is many short jobs that want a warm process and a local disk, not one long job that
parallelises across frames. Recorded in full in `src/lib/adapters/media/types.ts` under
`FFMPEG_RUNS_IN_A_CONTAINER`, and behind a seam so Phase 04 can revisit it without touching a
workflow. eslint now confines `node:child_process` to that one folder.

**Decisions worth knowing about, because none of them were in the phase file:**

- **The audit templates are keyed by the PATH VERB, not by the CRUD word.** The phase's registry
  block keys the upload template `create`, but `writeAuditRow` looks a template up as
  `describe[pathAction]` — so on `assets.completeUpload` a `create` key resolves to nothing and
  the audit row ships with no description at all. The keys are `completeUpload`, `update` and
  `delete`. This compiles either way, which is what makes it worth writing down.
- **`assets` carries `update` in its permissions**, which the phase's registry block omits while
  also asking for a rename row action. An action with no permission to gate it is an action every
  member can take regardless of role. Rename is all it grants.
- **`createUploadUrl` must be signed with the file's EXACT size.** `signedPutUrl` signs
  `ContentLength` into the URL, so a URL signed with the plan cap accepts a file of exactly that
  size and rejects every real upload. The client sends `file.size`; the server checks it against
  the cap and signs it. Grep `EXACT_CONTENT_LENGTH`.
- **The per-file cap is NOT the storage quota** and could not live in `RESOURCES`: the registry's
  `limit` shape is a counter with a usage row behind it, and nothing accumulates for a per-file
  cap — declaring it there would create a second `storage`-shaped quota the factory would try to
  gate and bump. It is `UPLOAD_BYTES_PER_PLAN`, and a test asserts it stays BELOW each plan's
  total storage so one file cannot fill a workspace.
- **`completeUpload` HEADs the object and charges the quota what the BUCKET reports.** A
  client-supplied byte count is the number the quota is billed on, so it is exactly the number not
  to trust. It also doubles as proof the upload actually happened.
- **The proxy is derived from the vertical master, not from the original.** That pairing is what
  makes the editor preview and the final render the same framing, which `architecture.md` names as
  the reason they match. Asserted in `ingest-plan.test.ts`.
- **Crop vs pad is a property of the MATERIAL.** Backgrounds and generated footage crop (bars
  behind narration look broken); a customer's own upload and images pad (cropping a third off
  someone's photo is the worse failure). A full `Record` over `AssetKind`, so a new kind cannot
  ship without the decision being made. Backgrounds are also muted at ingest; uploads are not.
- **Moderation writes `skipped`, not `approved`.** Phase 10 makes it real; `approved` would be a
  claim nothing checked, which every later phase would be entitled to believe.
- **Delete removes the objects LAST, outside what can roll back.** The worst case is then objects
  with no row — swept by the cleanup cron, and nothing in the product breaks — rather than a row
  pointing at objects that are already gone, which renders as a tile that looks fine and 404s.
  Grep `ORPHAN_OBJECTS_OVER_MISSING_OBJECTS`.
- **Library rows (`organizationId: null`) are read-only to tenants.** The ownership predicate is
  "mine OR library", so a plain scoped lookup would let one workspace rename or delete media every
  other workspace can see. Both writes refuse it explicitly and the row menu is not rendered.
- **`formatBytes` was extracted out of `resources.ts`** so the pricing copy, the media table and
  the usage meter cannot round the same number differently on the same screen.
- **Thumbnails render through a plain `<img>`, not `next/image`.** A signed URL is unique per
  request and uncacheable, so the optimiser cannot help and would re-fetch every tile on every
  page view. `images.remotePatterns` was still added for the PUBLIC library objects Phase 11 will
  serve unsigned — derived from `R2_PUBLIC_URL` and omitted when unset, because an empty hostname
  is a build error.
- **The media library polls while anything is `processing`.** Nothing pushes the end of an ingest
  to the browser, and the interval stops by itself once no visible row is processing.

**Verified end to end (2026-10-19).** Driven in a headless browser against `next dev`, on a
throwaway account, with `RESEND_API_KEY` unset for that process so **no real email was sent**:

- `/dashboard/media` renders. The sidebar entry appears from `RESOURCES.assets.nav` with no nav
  wiring. The storage meter reads **"0 B of 100 MB used"** straight from `limit.perPlan`, the drop
  zone says **"up to 50 MB each"** resolved from the workspace's actual plan, the four tabs come
  from `ASSET_TABS`, and the empty state renders. Zero console errors on the page itself.
- The file input's `accept` is exactly the eight allowlisted types, generated from
  `CONTENT_TYPE_ALLOWLIST`.
- **Every server-side refusal was probed over tRPC directly, bypassing the client gates:** a
  200 MB file returns 400 — *"That file is 200 MB. The largest single file on your plan is
  50 MB"*; an MKV, a 0-byte file and `kind: 'render_output'` are each refused by the schema with
  the permitted values listed; `completeUpload` against another workspace's key returns **403**,
  and does so BEFORE it touches storage; and `assets.get` on an unknown id returns **404**, never
  403, so an id cannot be probed for existence.
- **A legitimate presign passes the per-file cap and the storage gate** and then fails only on the
  missing bucket credentials — which is the proof that `GATE_BEFORE_SIGNING` ran and allowed it.
- `asset.ingest` is registered and served: `/api/inngest` reports 4 functions (the three declared
  plus the failure handler).

**NOT verified, and this is why the box is unticked — needs R2.** No `R2_*` variables are set in
`.env`, so nothing can be uploaded and these checks are untested:

- A 16:9 MP4 becoming a `vertical_1080` plus a `proxy_480` and a thumbnail.
- The storage bar moving on upload and moving back on delete. The counter writes are in place and
  the gate reads 0 / 100 MB correctly, but no bytes have ever been charged.
- Signed URLs expiring, and deleting an asset removing every R2 object.
- A corrupt file marking the asset `failed` with a readable error. The refusal logic is unit-tested
  (`assertSupportedMedia`, nine cases) but has never run against a real file.

ffmpeg 9.0.2 IS installed and on PATH on this machine, so the ingest path should run as-is the
moment a bucket is configured. The R2 lifecycle rule deleting `tmp/` after 24 hours is still
outstanding from Phase 00, and the key convention still assumes it.

**Also deferred:** one throwaway QA account remains — `qa-phase02-media@example.com` and its
auto-created workspace. It owns no assets and no projects; the user and org rows remain, as
Phase 01's do.

### Phase 03 — 2026-10-20

Built: `src/remotion/` (the `TimelineRenderer` composition, the component registry, `MediaClip`,
`TextOverlay`, `AudioClip`, the bundled-font loader, the dev asset map and the studio root),
`src/lib/render/` (the pure frame plan, the ducking curve and the forward-compatibility
sanitiser), `projects.preview` plus `signDocumentAssets`, the preview page at
`/dashboard/projects/[id]/preview`, a determinism eslint fence over both folders, and
`remotion.config.ts`. 42 new tests; the suite is 381 and green, `tsc --noEmit`, `eslint` and
`next build` are clean.

Remotion 4.0.536 was added (`remotion`, `@remotion/player`, `@remotion/cli`) plus
`@fontsource/geist-sans` as a dev dependency — the source of the two woff2 files copied into
`public/fonts/`, so the render font is the same Geist the app UI uses and is versioned by the
lockfile rather than downloaded.

**Decisions worth knowing about, because none of them were in the phase file:**

- **The plan is a pure module, separate from the composition.** `src/lib/render/` takes a
  document and returns a frame-addressed draw list, importing no React and no Remotion. That is
  what makes the interesting questions testable without a browser — visibility windows, stacking
  order, frame conversion — and Phase 15's editor needs the same answers for its ruler without
  importing a composition. Grep `PLAN_IS_PURE`.
- **Tracks composite by TYPE first, then by document order.** `LAYER_ORDER` is a fixed per-type
  floor (video → scene → overlay → caption) because a generator is free to list its tracks in any
  order, and the Reddit fixture already puts its scene track before its audio. Sorting globally by
  `z` was the alternative and it is wrong: only overlays declare `z`, so everything else would
  collapse to one depth. Ties break on document position, so the sort is total — an unstable draw
  order would mean two different videos from one document hash, which is what Phase 04 caches on.
- **A `render` value outside the schema's union no longer blanks the video.** `timelineDocSchema`
  is `.strict()` with a closed enum, which is right for everything that WRITES a document and
  wrong for the thing that renders one: a document from a newer release would fail the whole parse
  on one unrecognised overlay. `dropUnknownRenderKinds` removes those items before the parse and
  logs them, so the rest still renders. Grep `ONE_BAD_ITEM_IS_NOT_A_BAD_DOCUMENT`. The other half
  — a kind that IS in the union but has no component yet, like `redditCard` — was already handled
  by the registry's own fallback. Both were probed in a real render.
- **Components receive ITEM-RELATIVE frames.** The walker mounts every item in its own
  `<Sequence from={…}>`, so `useCurrentFrame()` inside a component starts at 0 for that item. This
  is written on `RenderItemProps` as `FRAMES_ARE_RELATIVE_INSIDE` because the first version of
  MediaClip subtracted the offset again and pushed every Ken Burns progress negative.
- **Looping uses Remotion's `<Loop>` for video and explicit sequences for ducked audio.** `<Loop>`
  mounts the repetition belonging to the current frame, which keeps a frame a pure function of its
  number — the element's own `loop` attribute has an internal playhead that out-of-order frame
  rendering cannot rely on. Ducked audio cannot use `<Loop>` at all: its children cannot tell which
  repetition they are, so a ducking curve inside one would reset every few seconds and duck against
  the wrong part of the narration. Grep `EXPLICIT_REPETITIONS_FOR_DUCKED_LOOPS`.
- **Ducking is computed from where the narration actually is.** The document stores `duck: true`,
  never a curve, so re-recording a line re-ducks the music with no document change. Narration is
  identified by an audio item naming a `speaker` — not by a track called "narration", which would
  make the mix depend on a label the editor lets a customer rename. An item that asks to be ducked
  is excluded from its own windows, so it cannot duck against itself.
- **Crop/pad, mute and Ken Burns all read from the document**, never from a constant in a
  component. `fit` defaults to `cover`; Ken Burns is opt-in through the item's open `props` bag and
  is a LINEAR drift, because an eased one needs a curve in the document to be reproducible and that
  belongs to Phase 16.
- **`TextOverlay` is the one component allowed to hardcode colour**, and it is documented as the
  exception rather than a lapse: these pixels are composited by a headless browser with no
  stylesheet, no CSS variables and no dark mode, so a theme token would render as the browser
  default — black text on dark gameplay footage. Phase 08 moves the values into the document's own
  palette. Grep `RENDER_COLOURS_ARE_LITERAL`.
- **`createElement`, not JSX, for the registry dispatch.** Assigning a looked-up component to a
  capitalised local trips `react-hooks/static-components`: the compiler cannot tell a registry
  lookup from a component built during render. `createElement` states the dispatch is dynamic, and
  the identity really is stable because the registry is a module constant. The render output was
  byte-identical before and after that change.
- **Two guards on determinism, deliberately doubled.** An eslint rule over `src/remotion/**` and
  `src/lib/render/**` bans `Date.now`, `Math.random`, `performance.now`, `crypto` and bare
  `new Date()`; `determinism.test.ts` asserts the same thing by reading the files, because a lint
  rule is skippable and this one must not be. The test strips comments first — every file on this
  path names the forbidden calls in the comments explaining why they are forbidden.

**Verified end to end (2026-10-20).**

- **A real local render.** `npm run remotion:render` produces `out/reddit-story.mp4`: H.264 +
  AAC, **1080×1920, 30fps, 228 frames, 7.6s**, from a document-derived duration with nothing
  hard-coded. A frame pulled out of it shows the background video filling 9:16 and the text
  overlay in the bundled font — looked at, not inferred.
- **Determinism, byte-for-byte.** Rendering the same document twice produced **byte-identical
  MP4s** — stronger than the brief's "identical frames". The `createElement` refactor afterwards
  produced a file identical to the pre-refactor render too.
- **Both determinism guards were probed** with a throwaway `Math.random()` in a component: eslint
  rejected it by rule name and the test failed naming the file. Both pass again after the revert.
- **Missing tracks render correctly.** All four fixtures render: `voiceover` (no music bed, and
  ANCHORED, so it also exercises `resolveWordAnchors` before rendering), `quiz` (no overlay track)
  and `motion` (no video and no audio at all — no spine). Mean frame luma confirms they are real
  frames, not black ones.
- **Unknown render kinds, in a real render.** A probe document carrying both `someFutureThing`
  (outside the union) and `redditCard` (in the union, no component) logged one warning each —
  *"Dropped 1 item(s)… The rest of the video still renders"* and *"No component for render kind
  'redditCard' — drawing nothing"* — and rendering continued.
- **Browser playback.** The Remotion studio plays `reddit-story` at 1080×1920/30fps with the
  video decoded (`readyState: 4`, 540×960, playing at 3.4s), **two audio elements mounted**, and
  **both font faces reporting `GeistRender:loaded`**. Zero console errors, zero failed requests.
- **The preview page works** against a real project: the route is gated, the page renders, and
  `projects.preview` returns 200 while correctly distinguishing "no timeline" from "broken
  timeline". The QA project was deleted afterwards.

**NOT verified, and why.**

- **The `<Player>` has never been handed a real document**, because nothing in the product can
  create a `Timeline` row yet — `projects.create` writes the project only, and generation is
  Phase 06/09. The preview page therefore always shows its empty state today. The composition it
  would mount is the same one the CLI renders and the studio plays, both verified above, so what
  is untested is the binding in `project-preview.tsx`, not the rendering.
- **No render has ever used a real R2 asset**, for the same reason Phase 02 is unticked: no `R2_*`
  credentials. Every render so far resolves its media through the dev asset map, so
  `signDocumentAssets` has been exercised only against an empty handle list.
- **Pixel snapshots are the local render, not the test suite.** The three-frame snapshots are
  taken against the PLAN. A pixel snapshot needs a headless browser, takes tens of seconds and
  breaks on a Chrome or ffmpeg bump that changes nothing about this product; the plan is where the
  decisions that can actually be wrong live.

**Two wrinkles worth knowing about.**

- `remotion render --props=<file>` builds a bundle whose `public/` is missing, so `staticFile()`
  URLs 404 under that flag while the identical URL resolves in a normal render. The probe above
  worked around it. It does not affect `npm run remotion:render`, the studio, the Player, or
  Phase 04's Lambda path (which uses a deployed site rather than this CLI bundle).
- The studio reports *"Can't save default props"* for every composition, because they are
  registered in a `.map()` over `FIXTURES_BY_KIND` rather than as static literals. That only stops
  the studio writing prop edits back into `root.tsx`; rendering and the Player are unaffected, and
  the loop is what makes a fifth project kind appear in the studio with no edit.

**One licensing note for the owner.** Remotion is free for individuals and small teams but
requires a paid company licence beyond that — see remotion.dev/license. `architecture.md` committed
to Remotion, so this is a cost to confirm rather than a decision to revisit, and it lands before
Phase 04 deploys a renderer.

### Phase 04 — 2026-10-20

Built: the `renders` and `watermarkFree` registry entries, the `Render` model and its migration
(**not applied** — see below), the Phase 04 half of `src/lib/types/render.ts` (status, resolution,
per-plan entitlements, every input schema), `src/lib/render/cache-key.ts`, the `render` adapter seam
(`src/lib/adapters/render/` — contract, selector, Remotion Lambda implementation, webhook helpers),
`renders.service.ts`, the `renders` router (`create` / `list` / `get` / `retry`), the
`project.render` workflow, the signed webhook at `/api/webhooks/remotion`, the `Watermark`
component, a production `timeline` composition with `calculateMetadata`, the `usePlanTier` hook and
the export panel on the preview page. 29 new tests; the suite is 410 and green, `tsc --noEmit`,
`eslint` and `next build` are clean.

`@remotion/lambda` and `@remotion/lambda-client` were added at 4.0.536, pinned to the Remotion
version Phase 03 chose. **npm needed `--legacy-peer-deps`**: a plain `npm install` crashes with
`Cannot read properties of null (reading 'edgesOut')` while resolving `better-auth`'s peers. That is
an npm/arborist bug, not a conflict in this tree, and it reproduces on the unmodified lockfile — but
it means CI's `npm ci` should be watched on the first run after this branch.

**Three deliberate corrections to the phase brief.** Each one is a place where following the brief
literally would have produced a bug, and each is documented at the code it affects:

- **The watermark is resolved at `renders.create`, not in `finalize`** (the brief's step 7). It
  cannot be resolved in `finalize`: it is a composition prop, so it decides PIXELS, and by
  `finalize` the frames already exist. It also has to be fixed before the cache key is computed —
  if the workflow re-resolved it and the plan had changed in between, the file produced would not
  match the key it is stored under, and the next request would be served a render whose watermark
  state its key denies. Resolved once, written to the row, read from the row by the workflow. The
  entitlement is still the only source, which is what step 7 was protecting. Grep
  `WATERMARK_RESOLVED_ONCE`.
- **The MP4 and poster are stored by the workflow's `finalize` step, not by the webhook** (the
  brief's step 6). The webhook verifies and relays; that is all. Three reasons, all pointing the
  same way: the copy is tens of megabytes plus an ffmpeg invocation, which is precisely the work
  `FFMPEG_RUNS_IN_A_CONTAINER` says must not happen in a serverless function; Remotion retries a
  webhook that does not return 2xx, so a slow copy produces a second delivery while the first is
  still running; and if the copy failed there the event would never be sent, so the workflow would
  wait out its full 45 minutes and record `timedOut` — reporting a storage failure as a render
  timeout, which sends whoever investigates to the wrong system. Grep `FINALIZE_DOES_THE_COPY`.
- **The event is `render/finished`, not `remotion/render.finished`.** The brief's name has a dot
  and a vendor in it; `select-provider.test.ts` has enforced `domain/verb` since Phase 00, and the
  domain here is `render` — the event means "a render finished", which stays true whatever renders
  it. The webhook ROUTE is still provider-specific and still named after Remotion. The existing
  test caught this, which is the whole reason it exists.

**Decisions worth knowing about, because none of them were in the phase file:**

- **`Render.docHash` is NOT `hashDoc(doc)`.** It is `renderCacheKey()`, which folds the document
  hash together with the resolution and the watermark. The brief's `@@unique([projectId, docHash])`
  is described as what makes reuse "correct rather than best-effort", and that is only true if the
  key says everything about the FILE — `hashDoc` says everything about the DOCUMENT, which is a
  different claim. Storing a bare document hash breaks in both directions: a 720p render would
  satisfy a later request for 1080p, and a free workspace's watermarked output would be handed back
  after it upgraded, so the first thing a new subscriber does returns the file they just paid to
  replace. The key is readable rather than re-hashed (`v1-a1b2c3d4e5f60718-1080p-wm0`) so support
  can read a row without running code. `cache-key.test.ts` has a `satisfies` guard that fails to
  compile if a field is added to the inputs without a decision about the key.
- **A reused render has to CANCEL the factory's counter bump, or reuse is not free.** The factory
  auto-increments on any successful `<resource>.create` and cannot see that the handler returned an
  existing row instead of making one — so without the correction, re-downloading an unchanged video
  would spend a render from the monthly quota, which is exactly what the reuse rule exists to
  prevent. The handler calls `incrementUsage(..., -1)` and the factory's `+1` lands on top inside
  the same transaction, netting zero. It is deliberately not `decrementUsage`, which floors at
  zero: a render made in January is still reusable in February, when the periodic counter has been
  reset to 0, and flooring there would charge the customer 1 for a render that cost nothing. One
  caveat is stated rather than hidden in the code — the factory's GATE runs before the handler, so
  a workspace already at its cap is refused even on a reuse. It does not bite in practice: nothing
  has to call `create` to get an existing video, because the panel reads `renders.list` and
  `renders.get`, both plain queries with no limit gate. Grep `REUSE_COSTS_NOTHING`.
- **`RENDER_KEY_VERSION` exists for the case the scheme cannot otherwise express**: a change to
  `src/remotion/` that changes the picture without changing any document — a font swap, a fixed
  overlay position, a bug in the ducking curve. Every existing render would otherwise be reused and
  no customer would ever see the fix. Bumping it invalidates the whole cache deliberately.
- **`calculateMetadata` was missing and a cloud render would have been silently truncated.** A
  `<Composition>` fixes its `durationInFrames` at REGISTRATION time, so the Phase 03 compositions
  render every document at the length of the fixture they were registered from. A 60-second project
  would have produced 7.6 seconds of video — it succeeds, it is billed, and the only symptom is a
  video that stops mid-sentence. The new `timeline` composition derives everything from its props,
  and the fixture compositions were moved onto the same function so the studio exercises the path a
  paid render depends on. Grep `METADATA_FROM_THE_PROPS`.
- **`renders` declares no `delete` permission, deliberately.** The procedure factory
  auto-DECREMENTS a limit resource's counter on `<resource>.delete`, so a delete verb would refund
  the monthly quota every time someone tidied their render history — a free render for two clicks.
  The output is an Asset and is deleted through `assets.delete` like any other media. Grep
  `RENDERS_HAVE_NO_DELETE`.
- **Resolution-by-plan is a `Record`, not a registry `flag`.** A flag is a boolean and this is a
  SET per plan; modelling it as `hd1080` + `hd720` flags would put two entries in a relationship
  nothing enforces (a plan with 1080p and not 720p). `watermarkFree` IS genuinely boolean, which is
  why that one is in the registry. Free is 720p + watermark: good enough to prove the product
  works, not good enough to publish.
- **A resolution is a `scale`, never a forced width.** The composition resolves every normalized
  box and font size against the document's own canvas, so changing the canvas would MOVE things on
  screen. `720p` is two thirds, written as a fraction rather than 720/1080 because it has to hold
  for the 1:1 and 16:9 canvases Phase 15 allows.
- **The webhook's signature is over the RE-STRINGIFIED body, not the raw bytes.** This is the one
  place the route differs from the Stripe webhook it is otherwise modelled on: Stripe signs the raw
  body, so that handler must not parse first; Remotion signs `JSON.stringify(body)`, so this one
  must. "Follow the Stripe webhook" would have led straight to a handler that rejects every genuine
  call, so it is written down at the top of the route and asserted in `webhook.test.ts`. Grep
  `SIGNATURE_IS_OVER_RESTRINGIFIED_JSON`.
- **The webhook payload schema is NOT `.strict()`**, which inverts the rule everywhere else in this
  codebase and is right here because somebody else writes that object. The provider adds fields in
  minor versions, and a strict schema would reject a whole payload for a field nobody reads —
  stalling every render in flight on the next provider upgrade.
- **The workflow re-reads the row and re-derives the cache key in every step that needs the
  document.** The document can be edited between the request and the render (Phase 15's editor, a
  regeneration), and rendering the CURRENT document under the OLD key would poison the cache
  permanently: that key would thereafter return a video of a document it does not describe, and no
  re-render could dislodge it because the row already says `completed`. The run refuses and the
  customer re-requests. Grep `KEY_MISMATCH_IS_A_STALE_RENDER`.
- **Every asset is HEAD-checked against the bucket before a single Lambda is invoked.** Signing is
  local HMAC and SUCCEEDS for an object that is not there, so a row pointing at a deleted object
  yields a perfectly valid URL that 404s inside the renderer forty minutes later. `signDocumentAssets`
  returning `url: null` is right for a PREVIEW (a hole beats a blank screen) and wrong for a render
  somebody is being charged for. Grep `PREFLIGHT_BEFORE_PAYING`.
- **A timeout asks the provider before writing the render off.** From inside the wait, a render that
  died and a render that finished while our webhook was briefly unreachable look identical, and they
  call for opposite actions — writing `timedOut` without asking throws away a video that exists and
  has been paid for, then invites the customer to spend their one retry re-rendering it. This is the
  only sanctioned `getProgress` call: one question at the end of the window, not a loop. Grep
  `A_DROPPED_WEBHOOK_IS_NOT_A_FAILED_RENDER`.
- **The poster is a frame extracted from the output file, not a second `renderStillOnLambda` call.**
  A still render is a second paid invocation for one image and — because it renders the composition
  again rather than reading the video — it could disagree with the frame actually in the output. The
  file is already on local disk in `finalize`, so the extraction is nearly free, and it is
  best-effort: a missing thumbnail is cosmetic and must not throw away a video that rendered.
- **Render output bytes are NOT charged to the `storage` quota**, consistently with `AssetVariant`.
  What a plan caps about renders is HOW MANY; charging both would let five free renders exhaust a
  quota meant for uploads, with no way for the customer to tell which cap they hit. Grep
  `RENDERS_ARE_NOT_METERED_ON_STORAGE`.
- **Every terminal write filters on the status it expects** (`updateMany`, not `update`). Two live
  bugs depend on it, both ordinary consequences of an at-least-once webhook and a parallel renderer:
  a late webhook resurrecting a render already marked `timedOut` (whose retry is now rendering the
  same thing twice), and a progress write arriving after completion and stranding the UI on a
  spinner over a video that exists. Grep `TERMINAL_IS_FINAL`.
- **`renders.retry` costs no quota, and `attempts` is what stops that being unlimited.** The factory
  bumps the counter on `create` and nothing else, so a retry is free by construction — which is
  correct, because the first attempt failed through no choice of the customer's. The limit is
  enforced twice: a readable refusal in the router, and an `attempts: { lt: limit }` filter inside
  the service so two simultaneous clicks produce one retry rather than two renders.
- **`renders` carries a per-minute rate limit** on top of the monthly cap. The plan cap is a MONTHLY
  number and does nothing about thirty renders in one minute from a stuck client, which on an
  unlimited plan is unbounded spend. The monthly quota is the budget; this is the blast radius.
- **The watermark needed its own background, and a real render is what proved it.** The first
  version used near-white text with a soft shadow, copying `TextOverlay`. Rendered against the test
  pattern it vanished completely into a white vertical band. That is not cosmetic for a watermark
  specifically: a mark that disappears over pale footage is a free export for anyone whose video has
  a bright bottom third, which is most screen recordings and every white-background explainer. It
  now sits on a translucent dark pill and is inset from the bottom by 6% of the height, far enough
  that cropping it out costs a visible slice of the video. Grep
  `WATERMARK_NEEDS_ITS_OWN_BACKGROUND`.

**Verified end to end (2026-10-20).**

- **The local render still works and is byte-identical to Phase 03's.** `npm run remotion:render`
  produces the same 228-frame, 1080×1920, 30fps MP4 with the same **sha256** as the renders taken
  before any of this phase's changes. The `calculateMetadata` refactor therefore changed the
  composition's plumbing and not one pixel of its output.
- **The watermark composites, and was looked at rather than inferred.** A render with it forced on
  produces a different file (1,339,424 bytes vs 1,288,169), and a frame pulled out of it shows the
  mark on its pill over the footage. The first attempt's invisibility was found this way too — the
  frame is the only thing that could have shown it.
- **All four determinism guards still pass.** The eslint rule and `determinism.test.ts` both cover
  the new `Watermark` component; it is static by construction and reads nothing outside its props.
- **The webhook's signature check was probed against a running server**, with a real HMAC built the
  way Remotion builds it:
  - no signature → **400** *"Missing render webhook signature"*
  - wrong secret → **400** *"Invalid signature"*, logged server-side
  - body that is not JSON → **400**
  - no `REMOTION_WEBHOOK_SECRET` configured → **503**, because with no secret there is no way to
    tell a genuine call from a forged one and accepting anything would be worse than refusing
    everything
  - **correct signature → 200** `{"received":true,"acted":true}`, and `render/finished` was
    confirmed on the Inngest queue by GraphQL. That is the full relay: verify → translate → enqueue.
- **Both workflows are registered and served.** `/api/inngest` reports **6 functions** (four
  declared plus two failure handlers), and the Inngest dev server lists `rotreels-project-render`
  and `rotreels-project-render-failure` by name.
- `next build` succeeds with `/api/webhooks/remotion` and the preview route present.

**NOT verified, and this is why the box is unticked — needs an AWS account.** No `REMOTION_*`
variables are set and nothing has been deployed, so **no render has ever run in the cloud** and
every check below is untested:

- A 60-second project rendering on Lambda and the workflow completing without a polling step. The
  `waitForEvent` is in place and the relay that resumes it has been proven end to end, but the two
  halves have never been joined by a real render.
- Re-rendering an unchanged project returning the existing output. The reuse logic is unit-tested
  against the cache key and the query is in place, but no `Render` row has ever reached `completed`.
- A deliberately broken composition failing cleanly with a stored error.
- A render exceeding the timeout being marked `timedOut` and retried once.
- Deploying a new site version not breaking a render in flight. The versioned serve URL is composed
  from `REMOTION_SITE_VERSION` and resolved once per render, which is the mechanism — but nothing
  has deployed two versions.
- A free workspace's output carrying the watermark and a paid one not. The component is proven in a
  local render; the ENTITLEMENT path from `checkBooleanFeature` through the row to the prop has not
  run.
- ~~The migration has NOT been applied.~~ **Applied 2026-10-20**, before Phase 05 started, so the
  two phases' schema changes stay separable. `prisma migrate status` reports the database up to
  date and `migrate diff` reports no drift. The `render` table is reachable with all 19 columns and
  both unique constraints the logic depends on — `render_projectId_docHash_key` (what makes reuse
  correct) and `render_providerRenderId_key` (what makes "one retry with a fresh id"
  enforceable). It is empty, which is expected: nothing can finish a render without AWS.
- **R2 is still unconfigured**, carried over from Phase 02, so `finalize` has never copied an output
  into a bucket and `signAssetUrl` has never produced a download link.

**Also deferred / worth an owner decision:**

- **The Remotion company licence.** Phase 03 raised it as a cost to confirm; this is the phase where
  it starts running on infrastructure at scale. See remotion.dev/license.
- **Local development needs a tunnel.** The renderer calls back to `NEXT_PUBLIC_APP_URL` and AWS
  cannot reach localhost, so a local render will start and then time out without one. Recorded in
  `.env.example` and in the setup checklist's help text.
- **Three older call sites read `gatesQuery.data?.tier` by hand** and predate the new `usePlanTier`
  hook. They are unchanged — moving them is a refactor with no behaviour change and did not belong
  in this phase — but they should move onto it when next touched.
- No throwaway QA account was created this phase; the webhook probes needed no authenticated
  session. `REMOTION_WEBHOOK_SECRET` was added to `.env` for the duration of the probe and the file
  was restored from a backup afterwards — `git diff .env` is clean.
