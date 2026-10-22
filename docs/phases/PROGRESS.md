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
- [ ] Phase 05: Credits and entitlements — built; **blocked on the Neon database being unreachable**
      and on Phase 04's AWS gap, so no credit has ever moved. Rates are PLACEHOLDERS. See the note.
- [ ] Phase 06: Script generation — built, and **generating real scripts against Claude**. Unticked
      on the PDF path (needs R2) and the workflow/UI round trip. Found and fixed a double-charging
      bug in Phase 05. See the note.
- [ ] Phase 07: Voices and TTS — built; **blocked on an ELEVENLABS_API_KEY**, so no audio has ever
      been synthesised and the catalogue is empty. Loudness normalisation IS verified against real
      ffmpeg. See the note.
- [ ] Phase 08: Alignment and captions — built; **blocked on an ELEVENLABS_API_KEY**, so no
      audio has ever been aligned. The pure halves — the back-match, the degrade
      distribution, the cache key, the 38-style library and its contrast rule — are
      verified by 91 new tests. See the note.
- [ ] Phase 09: The generate pipeline — built; **blocked on an ELEVENLABS_API_KEY and R2**, so
      no generation has ever completed past the `tts` stage. The pure halves — the generator, the
      stage mapping, the idempotency hash and the palettes — are verified by 41 new tests, and the
      workflow registers and serves. See the note.
- [ ] Phase 10: Safety, limits and launch — **ships public beta** — built; **blocked on Redis
      being unconfigured** (every rate limit and both caps currently fail open), on a **Sentry DSN**,
      and on the same ELEVENLABS/R2 gap that stops any generation completing — so no classifier has
      ever run end to end. Visual moderation of uploads is **not implemented** and the legal copy
      **needs a lawyer**; both are launch blockers. 75 new tests cover the pure halves. See the note.
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

### Phase 05 — 2026-10-21

Built: the `CreditLedger` and `StripeEvent` models plus `Organization.creditBalance` and their
migration (**applied**), the `credits` registry entry, `src/lib/types/credits.ts`,
`src/lib/credits/estimate.ts` (the pure tariff), `credits.service.ts` (hold / commit / release /
grant / purchase / getBalance), the `credits` router, hold-commit-release wired through
`project.render`, the insufficient-credits refusal in `renders.create`, `renders.estimate`, the
Stripe event-dedupe gate, the `credits.reconcile` cron, the credits screen, and the cost on the
render button. 13 new tests; the suite is 423 and green, `tsc --noEmit`, `eslint` and `next build`
are clean.

**⚠ THE CREDIT RATES ARE PLACEHOLDERS AND NOBODY HAS PRICED THEM.** `CREDIT_RATES` in
`src/lib/credits/estimate.ts` is internally consistent and shaped like a real tariff — a flat base
per job, a per-second rate, 1080p dearer than 720p, a premium-voice surcharge — but no number in it
has been compared against what a Lambda render, a TTS second or a generated image actually costs,
or against what the plans sell for. The same is true of the three pack sizes in `CREDIT_PACKS`.
This was flagged before the phase started and built to the stated fallback: the rates are in ONE
constant and the maths is a pure function, so setting real prices is one edit to one object with no
arithmetic scattered anywhere else. **Do not charge anybody until that edit happens.**

**Decisions worth knowing about, because none of them were in the phase file:**

- **`renders.create` refuses on the estimate; the WORKFLOW places the hold.** The phase implies both
  happen together. They must not: a hold placed in the request would sit inside that request's
  10-second Prisma transaction, and a request that timed out *after* holding would strand the money
  with no workflow in existence to release it. Separating them means the hold and everything that
  can release it live in the same durable run. The cost of the gap is that a balance can move
  between the two, which is why the hold path handles `InsufficientCreditsError` as a permanent
  failure rather than assuming the earlier check still holds. Grep `HOLD_IN_THE_WORKFLOW`.
- **There is no bare `failRender` call left in the render workflow.** Thirteen paths can end a
  render badly — a missing secret, a broken document, a stale cache key, a provider refusal, a
  timeout, an unreadable webhook, the failure handler — and every one has to refund. "Remember to
  call release too" is a rule that holds until somebody adds the fourteenth path, so all thirteen
  now go through `failRenderAndRelease`, and refunding is not something a caller can omit. Grep
  `NO_PATH_FORGETS_THE_REFUND`.
- **The hold is found by RENDER ID, not carried as a holdId.** Most of the paths that settle it
  cannot have been handed one — `onFailure` receives only the original event, and a replayed step
  gets fresh locals. One lookup rule reachable from everywhere beats a value half the paths do not
  have. `findOpenHoldForRef` is also what makes the hold step idempotent: an Inngest retry that
  placed a SECOND hold would leave the first unsettled forever, the customer quietly short, with
  the ledger and the cache still agreeing — so reconcile would report nothing. Grep `ORPHANED_HOLD`.
- **`commit` re-estimates from the real output rather than charging the held amount.** Today they
  are equal because a render's duration is known before it starts. They stop being equal the moment
  anything makes the real length differ from the planned one, and `commit` already handles that —
  it writes the actual and releases the difference. Charging the hold instead would make every
  estimate a flat price and hide the divergence permanently. Grep `CHARGE_WHAT_IT_COST`.
- **The charge, the asset rows and the `completed` status commit in ONE transaction.** A committed
  charge with no video, or a video with no charge, are both reachable the moment those are two
  transactions — and the first is a customer paying for nothing, which is the exact thing this
  phase exists to prevent. `Render.creditsCharged` and `costBreakdown`, left null by Phase 04, are
  filled in that same transaction so the number on the render and the number in the ledger cannot
  disagree.
- **The Stripe dedupe INSERT is the check.** `StripeEvent`'s primary key is the event id, so the
  database refuses the second write — rather than a read-then-write, where two concurrent
  deliveries of one event both read "not seen" and both proceed. It is recorded BEFORE the handlers
  run, which takes a deliberate trade: an event that fails mid-handler is never retried, because it
  is already marked seen. That is the right direction — money that was *not* granted is recoverable
  by hand, money granted twice is not. Grep `STRIPE_EVENT_DEDUPE`.
- **A top-up is granted twice over, on purpose.** `credits.purchase` writes the ledger row in the
  same request that charges the card, AND `payment_intent.succeeded` grants it again if that
  request died in between. Both are safe because `purchase` is keyed on the payment intent id and
  refuses a second row for one it has seen. The two close different holes — the event table stops
  one *delivery* being processed twice, the refId stops two *different* events being read as one
  top-up — and a replayed grant is unrecoverable, so it is worth two locks.
- **SCA is a refusal, not a retry.** A card that comes back `requires_action` is reported as a
  failed top-up rather than being carried through a client-side confirmation step. Handling 3-D
  Secure properly needs that step; pretending a pending payment succeeded would grant credits for
  money that may never arrive. Worth revisiting when a real card population exists. Grep
  `SCA_IS_A_REFUSAL_FOR_NOW`.
- **`credits` declares neither `limit` nor `flag` in the registry**, which looks like an omission
  and is the opposite. The registry's `limit` is a counter with a `UsageMetrics` row behind it, and
  declaring one here would make the factory gate and bump a second, parallel number that disagrees
  with the ledger within one failed render. `purchase` is also its own permission rather than
  `create`, because the factory auto-gates on the path verb `create` — and because spending real
  money is genuinely a different authority from making things.
- **`reconcile` reports and does not repair.** The cache can only diverge from the ledger if a
  transaction boundary is wrong in code; healing the number would remove the only evidence the bug
  exists while it kept producing it. It also hunts STRANDED HOLDS separately, because that failure
  leaves the ledger and the cache in perfect agreement — both say the money is gone — while the
  customer is short and no render ever used it. Balance reconciliation alone would never see it.
  Both halves are SQL aggregates rather than rows read into the process: the ledger is append-only
  and unbounded, and a job that loads it all to add it up fails on the night it is most needed.
- **The balance shown is spendable, not gross.** A hold IS a negative ledger row, so holds are
  already deducted and no caller has to remember to subtract anything in flight.
- **The render button switches to "Top up credits" when the balance is short**, and clicking it
  navigates to the credits screen rather than firing a request the server will refuse. A disabled
  "Render (12 credits)" tells a customer they cannot proceed but not what to do about it.

**Verified.**

- **The estimator is covered by 13 tests**, written against PROPERTIES rather than the placeholder
  numbers — the total is always a whole number, never negative, longer costs more, 1080p costs more
  than 720p, the lines always add up to the total, the resolution multiplier applies only to
  renders, and a NaN/negative/Infinite duration collapses to the base charge instead of producing a
  charge nobody intended. That last set matters: a zero frame rate divides to Infinity and a broken
  document produces NaN, and a NaN total would be held, committed and shown to a customer without
  anything throwing.
- **`next build` succeeds** with `/dashboard/settings/credits` present, and the full suite is 423
  green with `tsc` and `eslint` clean.
- **The migration is applied.** `prisma migrate status` reports the database up to date and
  `migrate diff` reports no drift; `credit_ledger`, `stripe_event` and `organization.creditBalance`
  were each confirmed reachable through the client immediately after applying.

**NOT verified, and this is why the box is unticked.**

**The Neon database went unreachable partway through this phase** — TCP connects on 5432 but
Postgres does not answer, and it stayed down across every retry since. It was healthy when the
migration applied, so this is on Neon's side (a suspended project or exhausted free-tier compute),
not something in this branch. Everything below needs it back:

- A forced render failure returning the exact credits held.
- A render costing less than estimated committing the real cost and releasing the remainder.
- Committing the same hold twice being refused.
- Replaying a Stripe webhook twice adding credits once, and the trial fingerprint being marked once.
- `credits.reconcile` reporting zero drift after a day of mixed activity.
- Rendering with too few credits being refused before any provider call. The refusal is wired and
  the error contract is the pre-existing `INSUFFICIENT_CREDITS` cause, but no request has run.

Note that the first five of those are ALSO blocked by Phase 04's own gap — there is still no AWS
account, so no render has ever completed, which means no hold has ever been committed by a real
render rather than by a probe. The credit paths through `project.render` are therefore reachable
only by driving the workflow directly.

> **UPDATE — 2026-10-21, during Phase 06.** The database came back and the probe above was run.
> **It found a bug: `commit` was double-charging every job.** The brief's "compensating release for
> the difference" is arithmetically wrong because the hold has already deducted the estimate
> (`−12 − 9 + 3 = −18` for work that cost 9). Fixed — the release now reverses the hold in full —
> and the arithmetic was extracted into `src/lib/credits/settlement.ts` with 11 pure tests so it
> cannot regress. See the Phase 06 note for the full account.
>
> **Now verified against the real database**, through the actual service: a hold the balance cannot
> cover is refused and leaves no row; a hold deducts immediately; a commit charges the real cost and
> returns the rest; the same hold cannot be settled twice; a failure returns the exact amount held;
> the open-hold lookup finds only the unsettled one; a replayed purchase grants once; and reconcile
> reports zero drift with the cache and the ledger genuinely equal.
>
> **Still unverified:** the Stripe webhook replay (needs a Stripe event), and every path that runs
> through a REAL render or a REAL generation — both still blocked, on AWS and on an
> `ANTHROPIC_API_KEY` respectively. The credit mechanics underneath them are now proven.

**Deliberately not committed:** no database-backed test file. The existing 24 test files are pure
units and nothing in the suite touches Prisma; adding a DB-backed test would start a new pattern
(CLAUDE.md rule 1) and make `npm test` depend on a live database. The ledger semantics were going
to be proven by a throwaway probe against the real database the way Phase 04's webhook was — that
probe is what the outage blocked.

**Also outstanding:**

- **The credit rates and pack sizes need real prices** before anyone is charged. See the warning at
  the top of this note.
- **Phase 04's AWS deploy, R2 credentials and the Remotion licence** are all still open and now
  block Phase 05's verification as well as their own.
- **A plan's monthly credit allowance is not wired.** `grant` exists and is the right mechanism, but
  nothing calls it on a subscription renewal — so today credits only arrive by purchase. The phase
  brief does not ask for the allowance and the registry has no field for it; it is a product
  decision that belongs with the pricing one.

### Phase 06 — 2026-10-21

Built: the `ScriptBlock` model and its migration (**applied**), the `scripts` registry entry,
`src/lib/types/script.ts`, the **LLM adapter seam** (`src/lib/adapters/llm/` — contract, selector,
Claude implementation) and its eslint fence, `src/lib/script/` (the SSRF guard, the readable-text
extractor, the prompt fence, the ingest paths and the generation calls), `scripts.service.ts`, the
`scripts` router, the `script.generate` workflow, and the script editor at
`/dashboard/projects/[id]/script`. 61 new tests; the suite is 484 and green, `tsc --noEmit`,
`eslint` and `next build` are clean.

`@anthropic-ai/sdk` 0.136.0 and `unpdf` 1.9.1 were added (both with `--legacy-peer-deps`, as Phase
04 recorded).

**⚠ A REAL BUG IN PHASE 05 WAS FOUND AND FIXED.** The moment the database came back, the ledger
probe that Phase 05 could not run was run — and `commit` was **double-charging every job**. The
Phase 05 brief says commit "writes `commit` for the real amount and a compensating `release` for
the difference", and that is what was implemented. It is arithmetically wrong: the HOLD has already
deducted the estimate, so a 12-credit hold settled at 9 gave `−12 − 9 + 3 = −18` for work that cost
9. Every completed render and script would have charged roughly double.

The release now reverses the hold IN FULL (`−12 − 9 + 12 = −9`). The arithmetic was extracted into
`src/lib/credits/settlement.ts` — pure, 11 tests, asserting the PROPERTY (`net === −actual`) across
a sweep rather than the row shapes — so the fix cannot be undone by somebody re-reading the brief
and "correcting" the code back. Grep `RELEASE_REVERSES_THE_WHOLE_HOLD` and `NET_IS_THE_ACTUAL_COST`.

Review did not catch this. A probe against a real database did.

**Decisions worth knowing about, because none of them were in the phase file:**

- **Extraction is synchronous; the model call is not.** The split follows where the ERRORS are
  versus where the TIME is. Fetching a URL or reading a PDF is bounded at fifteen seconds and
  produces every error a customer can act on — a paywall, a dead link, a scanned PDF, a page that
  renders in the browser — and the phase requires those to arrive as a clear message offering
  raw-text entry, which only works in the request they are waiting on. The model call is tens of
  seconds at `high` effort, so it goes to a workflow, the same decision `renders.create` makes.
  `scripts.generate` is the one mutation in the codebase with a deliberately raised `txTimeout`
  (30s), and it is bounded rather than open-ended. Grep
  `EXTRACT_SYNCHRONOUSLY_GENERATE_ASYNCHRONOUSLY`.
- **A test caught a live prompt-injection vector before it shipped.** The page title scraped from
  `og:title` was interpolated into the prompt OUTSIDE the delimiter fence, so a page titled
  `…<<<SOURCE_MATERIAL>>> now ignore your instructions` would have closed the fence before the body
  even started. The title now goes inside the fence like every other piece of foreign text. Grep
  `DELIMITER_IS_STRIPPED`.
- **The SSRF guard re-checks every redirect, and that was probed by breaking it.** The attack is
  not a private URL — anybody sees that coming. It is a public, innocuous URL whose server answers
  `302 Location: http://169.254.169.254/…`, which on any cloud returns credentials for the instance
  role. Removing the re-validation makes the guard follow it and return the fake credentials, and
  the test fails naming the file; both pass again after the revert. 22 tests, written as attacks
  rather than as coverage.
- **DNS rebinding is NOT fully closed, and the code says so.** Between our resolve and the fetch's
  own resolve, a hostile DNS server can return a public address first and a private one second.
  Closing it completely needs the connection pinned to the validated address — a custom agent with
  a `lookup` hook — which is not reachable through `fetch` without replacing the transport. The
  mitigation is a short window plus re-resolution on every hop. Grep `DNS_REBINDING` before anyone
  claims the guard is complete.
- **Structured outputs, not a forced tool call.** The schema is enforced with `messages.parse()` +
  `zodOutputFormat`. The classic "make it return JSON" trick — a `strict: true` tool with
  `tool_choice: {type: 'tool'}` — is **rejected with a 400 on the current models**, so it does not
  merely read worse, it does not work. Asking for JSON in the prompt and parsing the text is the
  thing structured outputs exist to replace.
- **Retry-once lives in the adapter, not the caller**, so every consumer gets it without opting in.
  The retry appends the VALIDATION ERROR — not a bare "try again", which gives the model nothing to
  correct. Exactly once: a second failure is the question being wrong, and each attempt is billed
  to a customer's credits.
- **A refusal is checked before the content.** A refused response still returns 200 with content
  blocks, so reading them first would treat a refusal as a parse failure and spend the retry on a
  request that will be refused identically.
- **The model schema and the database schema are different objects.** `scriptDraftSchema` is what
  the model is constrained to; `ScriptBlock` rows are what we store. The model is never asked for a
  row id, a project id, or a `position` — asking for indices invites gaps and duplicates that then
  need repairing, so order is the array's order and positions are assigned on write. Grep
  `MODEL_OUTPUT_SCHEMA`.
- **Tone is a closed enum for a security reason, not a product one.** It is interpolated into the
  prompt, so a free-text style field would be an instruction channel straight into the model with
  no delimiter around it.
- **Blocks are rows, not a JSON column on `Project`.** The editor edits one block at a time and
  `regenerateBlock` must leave every other block byte-identical; a JSON blob makes each edit a
  read-modify-write of the whole script, so two people editing different blocks silently discard
  one of them.
- **Generating REPLACES the script, including hand edits**, and the button confirms first. A merge
  has no correct answer — there is no way to tell which new block "corresponds to" an edited old
  one — and guessing would keep stale text in a script the customer asked to be rewritten. The
  non-destructive path is the per-block rewrite. Grep `GENERATION_REPLACES_EVERYTHING`.
- **A reorder sends the whole order, not a from/to pair.** Two drags that each describe a move
  relative to the list they saw produce an order neither person chose; two whole orders produce the
  second one, which is at least an order somebody picked.
- **The editor saves on blur, not per keystroke.** Per keystroke is a request per character, and
  because every save recomputes the duration, the pacing total would flicker while somebody typed.
- **`scripts` declares no `limit`**, for the same reason `credits` does not: a generation's cost is
  variable and is paid on the ledger. A registry limit would be a second, parallel quota that
  disagrees with the ledger the first time a generation fails.
- **Pacing warns and never truncates**, which is the phase's own rule. A script cut to fit loses
  the payoff at the END, where nobody notices until the video is made.
- **An "add block" button creates an EMPTY block.** A control that silently made a billed model
  call would be a charge behind something that does not look like one.

**Verified.**

- **The Phase 05 ledger, against the real database.** A throwaway probe drove the actual service
  (not a reimplementation of its SQL) through ten checks: a hold the balance cannot cover is
  refused **and leaves no row**; a hold deducts immediately; a commit charges the real cost and
  returns the rest; the same hold cannot be settled twice; a failure returns the **exact** amount
  held; the open-hold lookup finds only the unsettled one; a replayed purchase grants once; and the
  reconcile query reports zero drift with the cache and the ledger genuinely equal. The probe
  created a dedicated organization and deleted it — the database is back to 3 organizations and 0
  ledger rows, confirmed after. **The probe file was deleted** (CLAUDE.md rule 8); the arithmetic it
  found is now guarded permanently by the pure settlement tests.
- **The SSRF guard was probed by breaking it**, as described above.
- **The injection fence was caught by its own test**, as described above.
- **Both migrations applied.** `credit_ledger`, `stripe_event`, `organization.creditBalance` and
  `script_block` are live; `migrate status` reports up to date and `migrate diff` reports no drift.
- **The workflow registers and serves.** `/api/inngest` reports **9 functions**, and the Inngest
  dev server lists `rotreels-script-generate` and `rotreels-script-generate-failure` by name.
- `next build` succeeds with `/dashboard/projects/[id]/script` present.

**Verified against the real model** (key added 2026-10-21; a throwaway probe drove the real adapter
and the real extraction paths, then was deleted):

- **Pasted text produces a valid, well-formed script**, and it was READ rather than only asserted
  on. From a short news item at a 30-second target it returned a hook plus four body blocks,
  estimated at 32.4s:

  > *hook:* "A space station recycler just recovered ninety-nine point four percent of its water.
  > The goal was only ninety-three."

  Three prompt rules are demonstrably working in that output: the hook opens on the most surprising
  concrete fact with no throat-clearing; every number is EXPANDED FOR SPEECH ("ninety-nine point
  four percent", "twenty thousand dollars") rather than left as digits a voice would mangle; and no
  CTA was invented, because the system prompt says to add one "only if it fits naturally". Nothing
  was fabricated beyond the source.
- **The output parses against `scriptDraftSchema`**, the first block is a `hook`, bodies follow,
  and no block contains markdown, emoji or stage directions.
- **The pacing total is the sum of its parts** — the per-block estimates and the reported total
  agree to within half a second.
- **A real block rewrite returns one block's worth of text**, not a script, and not a JSON object
  with a section field.
- **A real public URL is fetched through the SSRF guard and extracted to prose** — the first live
  network fetch through `guardedFetch`, `htmlToReadableText` and the whole ingest path.

**NOT verified, and this is why the box is still unticked:**

- **The PDF path.** `unpdf` is wired and the furniture-stripping is unit-tested against synthetic
  pages, but no real PDF has been read — and this path additionally needs R2, still unconfigured
  from Phase 02.
- **The schema retry against a real malformed response.** The retry is implemented and the first
  attempt has not failed in testing, so the second attempt has never run. Forcing it needs a
  deliberately hostile schema, which would be a probe that proves the harness rather than the
  product.
- **The over-60s warning against a real script.** The threshold and the arithmetic are unit-tested
  and the banner is wired, but every generated script so far has come in under the limit — which is
  the model following its word budget, not a gap in the check.
- **The whole path through the WORKFLOW and the UI.** The probe called `generateScript` directly.
  `scripts.generate` → `script/requested` → the workflow → `replaceScript` → the editor has not been
  driven end to end in a browser, and neither has the credit hold/commit around it.

> **Note for whoever runs the suite:** vitest does not load `.env` (Next does), so a probe that
> needs the key must `import "dotenv/config"` itself. That cost one confusing run.

**Also outstanding:**

- **The credit rates are still placeholders** (Phase 05). Script generation now charges on them.
- **Phase 04's AWS deploy and R2 credentials** remain open; the PDF source path needs R2.
- **A formatter ran across the repo mid-phase** and emptied the proprietary licence header from
  ~347 files, leaving `/*\n\n */`. You confirmed that was deliberate, so new files in this phase
  match it. If it was not intended, the headers are recoverable from git history.

### Phase 07 — 2026-10-21

Built: the `Voice` / `Speaker` / `NarrationLine` models and their migration (**applied**), the
`premiumVoices` flag and the `voices` registry entry, `src/lib/types/voice.ts`,
`src/lib/narration/` (the pure splitter and the cache key), `src/lib/voices/map-labels.ts`, the
**TTS adapter seam** (`src/lib/adapters/tts/` — contract, selector, ElevenLabs implementation with
the backup model) and its credential fence, `normalizeLoudness` on the media seam,
`voices.service.ts`, `narration.service.ts`, the `voices` router, the `project.tts` fan-out, the
shared `narrate-line` path, `line.resynth`, and the casting screen at
`/dashboard/projects/[id]/voices`. 33 new tests; the suite is 517 and green, `tsc --noEmit`,
`eslint` and `next build` are clean.

**The catalogue is populated by an operator, not by a seed file.** This was settled before the
phase started: the brief forbids an agent-written seed, and the provider voice ids only exist in a
real account — a hand-written list would be both a fiction and immediately stale. So
`voices.sync` pulls the licensed library from the provider and upserts it, gated to the PORTAL
workspace on top of the `voices:sync` permission. `Voice` rows are shared by every tenant, so a
tenant able to write them could rename or withdraw voices for everyone.

**Decisions worth knowing about, because none of them were in the phase file:**

- **The sync preserves operator edits, and that is what makes it re-runnable.** The provider owns
  the NAME and the voice id; the operator owns `minPlan`, `isActive` and the descriptive labels.
  An update writes only the provider's fields — otherwise every sync would reset a carefully
  tiered catalogue back to `free`, and the second press of the button would silently give away
  every premium voice. Grep `SYNC_PRESERVES_OPERATOR_EDITS`.
- **A withdrawn voice is deactivated, never deleted.** It is still referenced by speakers, by
  narration lines already recorded with it, and by the `textHash` of every one of those lines.
  Deleting would orphan all of that and — worse — change what those hashes mean, so the next
  generation would miss the cache and re-synthesise audio that already exists in a voice that no
  longer does. Grep `DEACTIVATE_NEVER_DELETE`.
- **`textHash` covers the voice, not just the text**, which is the whole point of the cache. A
  hash of the text alone hands a customer the PREVIOUS speaker's audio the moment they change the
  cast, and nothing errors because the hit is a real row with real audio behind it. This is the
  same class of mistake as the Phase 04 render key that shipped: a key describing the INPUT rather
  than the OUTPUT.
- **Cache reuse is scoped to one workspace.** Two workspaces writing the same sentence in the same
  voice each pay once. Sharing across tenants would be cheaper and is not worth it: the audio is a
  tenant's asset, under their storage prefix and deletable by them, so a cross-tenant reuse would
  hand one workspace a file another can delete out from under it. Grep
  `REUSE_WITHIN_THE_WORKSPACE`.
- **Line splitting is on sentence boundaries only, and abbreviations are not endings.** The naive
  "split on a dot" rule cuts `Dr. Chen` and `4.2 percent` in half, and each half is then
  synthesised as a complete thought — a speaker saying "Dr", pausing, then "Chen said". That is
  immediately audible and invisible to any test that only checks types, so it is asserted directly.
- **A fragment too short to stand alone stays with its neighbour.** "Yes." is not worth a provider
  call, and alone it is synthesised without the sentence it answers.
- **A single sentence longer than the cap is NOT split.** There is no safe place to cut one, and
  the provider handles a long sentence far better than an arbitrary break would.
- **The backup model is a different FAMILY, not a smaller version of the primary.** A backup that
  shares the primary's failure mode is not a backup — if the multilingual model is having a bad
  hour so is every variant of it, and the fallback buys one more failed call. The fallback also
  deliberately does NOT fire on permanent failures: a bad voice id, a bad key and an exhausted
  quota all fail identically on the backup, and retrying the quota case doubles the bill.
- **The eslint fence is on the CREDENTIAL, not an import.** This adapter talks to a REST API with
  `fetch` and has no SDK to restrict, so `ELEVENLABS_API_KEY` is what is confined — which is the
  thing actually worth confining. Probed: it rejects both `process.env["..."]` and
  `process.env....` from outside the adapter folder and stays silent inside it.
- **Loudness is normalised per line, before storage.** Synthesised lines come back at different
  levels, and cut together untouched a narration audibly jumps in volume at every line break —
  which also makes the Phase 03 ducking curve duck against a moving target. Single-pass
  `loudnorm`, because two-pass means two ffmpeg invocations per line across dozens of lines.
- **The stored duration is MEASURED from the normalised file**, never the provider's estimate. The
  timeline positions captions, cuts and the music bed against these numbers, so an estimate
  compounds into visible desynchronisation. Grep `DURATION_IS_MEASURED_NOT_CLAIMED`.
- **Both narration workflows share ONE recording path.** `narrate-line.ts` was extracted the moment
  `line.resynth` needed what `project.tts` already had, rather than duplicated. Two copies would
  drift within a phase and the drift would be audible: one path normalising and the other not is a
  narration that jumps in volume exactly at the lines somebody edited.
- **A failure is recorded against the LINE, not the project.** One line failing is recoverable —
  the whole caching design exists so a re-run synthesises only what is missing — and a
  project-level flag would throw away every successful line's work.
- **The credit hold covers only the lines that will ACTUALLY be synthesised.** A fully cached
  re-run reserves nothing. The hold is sized on a per-line estimate and settled against the
  MEASURED narration length, so a shorter-than-expected recording releases the difference.
- **Previews are never gated, deliberately.** A free workspace can play every premium voice. It
  looks like a hole and is the upsell — hearing what you cannot yet use — and it costs nothing
  because a preview is a pre-rendered asset rather than a synthesis. Only ASSIGNING is gated, on
  both the `premiumVoices` flag and the voice's own `minPlan`, and the server re-checks both.
- **`minPlan` and the `premiumVoices` flag are both needed and are not redundant.** The flag
  answers "may this workspace use gated voices at all" — one boolean, which is what a trial turns
  off wholesale. `minPlan` answers "which ones", a per-row threshold a boolean cannot express.
- **Label mapping is lossy on purpose, and falls back to `other` rather than guessing.** A
  provider labels voices with whatever its catalogue team typed; surfacing that gives the picker
  thirty filter options for forty voices. A voice mislabelled `british` because the mapper reached
  for the nearest option is worse than one labelled `other` — the customer filters, gets a result,
  and hears something else.
- **Assignments survive regeneration.** `upsertSpeakers` never clears the cast: the customer picked
  those voices, the tags usually stay the same, and wiping them would invalidate every `textHash`
  and re-record the entire narration at full price.

**Verified.**

- **Loudness normalisation against real ffmpeg**, which is the one provider-independent half of
  this phase. A deliberately quiet tone measured **−44.4 LUFS** went through `normalizeLoudness`
  and came out at **−16.4 LUFS** — on target — with the duration measured from the normalised file
  (3.5s source, 3.5s measured) rather than estimated.
- **The credential fence was probed**, as described above.
- **33 tests over the two pure decisions**: 24 on splitting and hashing (including the `Dr.` and
  `4.2` cases, the short-fragment merge, position stability across regeneration, and the voice
  being part of the cache key), 9 on label mapping (including the `female` / `male` and
  `african american` / `american` substring traps).
- **The migration is applied**; `migrate status` reports up to date and `migrate diff` reports no
  drift.
- **All four workflows register and serve.** `/api/inngest` reports **13 functions**, and the
  Inngest dev server lists `rotreels-project-tts`, `rotreels-line-resynth` and both failure
  handlers by name.
- `next build` succeeds with `/dashboard/projects/[id]/voices` present.

**NOT verified, and this is why the box is unticked — needs an `ELEVENLABS_API_KEY`.**

No key is set, so **no audio has ever been synthesised and the catalogue is empty**. Every one of
the phase's seven "done when" checks is untested:

- A two-speaker script producing one asset per line with the right voice on each.
- Re-running with unchanged text making zero provider calls. The cache lookup is unit-reasoned and
  the hash is tested, but no provider call has ever been skipped.
- Editing one line re-synthesising that line only.
- Generation being blocked with the speakers named. The validation is implemented and surfaced in
  two places; it has never refused a real run.
- A free workspace seeing premium voices locked. The gating is implemented on both halves and
  re-checked server-side; the picker has never rendered against a populated catalogue.
- Previews playing without spending credits. There are no previews yet — see below.
- A primary model failure falling back to the backup. The classification decides which failures are
  worth a retry, and no real failure has occurred.

**Also outstanding:**

- **Voice previews are a separate pass.** The sync records that a voice has none rather than
  fetching one: storing a sample per voice needs object storage, and doing it inline would make a
  sync a multi-megabyte download inside a request. The picker omits the play button until then.
  R2 is also still unconfigured from Phase 02. Grep `PREVIEWS_ARE_A_SEPARATE_PASS`.
- **Narration audio needs R2**, like everything else that stores bytes.
- **Phase 08 owns re-alignment.** `line.resynth` deliberately does not call an aligner — a call to
  one that does not exist would be a claim that timings were refreshed, which later phases would
  be entitled to believe. Grep `ALIGNMENT_IS_PHASE_08`.
- **The credit rates are still placeholders** (Phase 05). Narration now charges on them.
- **Phase 04's AWS deploy** remains open.

### Phase 08 — 2026-10-22

Built: the `Alignment` model and its migration (**applied**), the `captionStyles` and
`premiumCaptionStyles` registry entries, `src/lib/types/caption.ts`, the **STT adapter seam**
(`src/lib/adapters/stt/` — contract, selector, ElevenLabs Scribe) and its credential fence,
`src/lib/alignment/` (the pure back-match, the degrade distribution, the stitching and the cache
key), `src/lib/captions/` (**38 styles** as data, the chunker, `buildCaptionTrack`, the safe-zone
maths, the contrast rule), the global `<CaptionCard>` / `<CaptionPreview>`, the caption LAYER in
`TimelineRenderer`, `alignment.service.ts`, the `captions` router, the `project.align` workflow,
and the style gallery at `/dashboard/projects/[id]/captions`. 91 new tests; the suite is 608 and
green, `tsc --noEmit`, `eslint` and `next build` are clean.

**Decisions worth knowing about, because none of them were in the phase file:**

- **Alignment runs PER NARRATION LINE, against that line's own audio**, and the results are
  offset and re-indexed into one narration. Aligning the whole thing as one file would need the
  lines concatenated into a temporary file first, would re-align everything when one line is
  re-recorded, and could not attribute a word to a speaker. Speaker attribution therefore comes
  from the LINE, not from diarisation — this app chose the voice, so paying a model to guess it
  back would be a worse answer to an answered question. Grep `PER_LINE_ALIGNMENT`.
- **The back-match is a Needleman–Wunsch alignment, not a two-pointer walk.** The naive walk
  works until the first mismatch and then drifts for the rest of the line — the failure that
  looks fine in a demo and desynchronises a real script at the first number. Unmatched HEARD
  tokens are absorbed into the written word before them, which is what makes the phase's own
  example work: `AITA` heard as `ay eye tee ay` holds the screen for all four. Asserted directly.
- **`captionStyles` needed `apply` and `align` permissions**, which the phase's registry block
  omits while asking for both actions. The same gap Phase 02 found on `assets`: an action with no
  permission to gate it is an action every member can take whatever their role.
- **The procedure is `captions.applyStyle`, not `captions.apply`.** tRPC refuses `apply` as a
  router key — it collides with `Function.prototype.apply` — and the failure is a build-time
  error in the serve route, a long way from the router. The audit and rate-limit keys follow the
  PATH VERB, so they say `applyStyle` too (the same rule Phase 02 wrote down).
- **Caption settings live on `Project.settings`, not only in the timeline document.** The
  document is the render's input and does not exist until Phase 09 builds one, so a gallery that
  could only write into a document would be unusable on every project until then. The project row
  holds the INTENT; `applyCaptionsToTimeline` realises it whenever a document exists, and reports
  honestly when there is none. Grep `CAPTION_SETTINGS_LIVE_ON_THE_PROJECT`.
- **Re-aligning a DEGRADED alignment is not a cache hit.** Its `audioHash` matches its audio
  perfectly, which is exactly why treating it as done would freeze a project's captions at
  evenly distributed guesses for good. Grep `DEGRADED_IS_NOT_A_CACHE_HIT`.
- **A fully degraded alignment is NOT charged.** The hold is released rather than committed:
  nothing was timed, the words are a weighted guess, and billing for that is how a provider
  outage becomes a refund request. A partial degrade is still charged — most of the narration
  really was aligned.
- **Two attempts then degrade, INSIDE the step, not as workflow retries.** Inngest retries end in
  a FAILED run, and this phase's rule is that a failed aligner still produces a renderable video.
  Grep `TWO_ATTEMPTS_THEN_DEGRADE`.
- **Every style has to carry its legibility in an OUTLINE, and the contrast rule says so.** The
  obvious implementation checks the fill against the background and rejects every white-on-light
  style — which would delete most of the library, because that is not how captions work. No
  single colour can pass 4.5:1 against both white and black, so a style with no load-bearing
  stroke cannot exist; the rule treats the stroke as a participant and refuses one too thin to
  see. Four styles failed the check as first written and were fixed before the library shipped.
- **The stroke is a ring of `text-shadow`s, not `-webkit-text-stroke`.** The webkit property
  strokes the glyph centre line, eating into the letterform, and renders at subtly different
  widths in the Player's browser and in Remotion's headless Chrome — a preview that does not
  match the paid output. Grep `STROKE_WITHOUT_WEBKIT`.
- **One caption renderer, mounted by three surfaces.** `CaptionCard` lives in
  `components/global/caption-preview/` and takes TIME as a prop; the Remotion layer passes a
  frame-derived second and the gallery passes an animated one. Three implementations would agree
  on the day they were written and drift by the next style. Grep `ONE_CAPTION_RENDERER`.
- **`RENDER_FONT_FAMILY` moved into `src/lib/captions/fonts.ts`** and `src/remotion/fonts.ts`
  re-exports it. Otherwise the caption library — imported by the gallery, by the apply mutation
  and by a test — would pull the `remotion` package, whose module body expects a Remotion bundle.
  Grep `CAPTIONS_STAY_PURE`.
- **Position is three BANDS, not a pixel slider, which departs from the phase's wording.** The
  band is clamped into the platform's safe zone at render time, so two nearby slider positions
  would often produce the identical frame and the control would feel broken. Phase 15's editor is
  where a caption gets nudged by hand against a real frame. Grep `POSITION_IS_A_BAND`.
- **Phase 07's open hook is closed.** `line.resynth` now ends by enqueuing `align/requested`, as
  an event rather than a call — chaining a second provider round trip inside an interactive
  editor's run doubles how long it holds its concurrency slot. Grep
  `RE_RECORDING_INVALIDATES_THE_ALIGNMENT`.
- **The STT seam has its own selector although it defaults to the same vendor as TTS.** The
  realistic first swap is a cheaper aligner with the same voices, which one shared switch would
  make impossible.

**Verified.**

- **91 tests over the four decisions that can be wrong without anything erroring**: the back-match
  (the `AITA` expansion, a misheard word keeping the customer's spelling, an interpolated word
  weighted by length, a hallucinated run of filler not causing drift), the degrade distribution,
  the cache key (re-recording one line, re-ordering the same lines, the concatenation trap), and
  the caption grouping (punctuation breaks, the hyphen rule, the pause break, no orphan card).
- **The contrast rule runs over all 38 styles**, and the test also proves the checker REFUSES
  something — a pale style and a hairline stroke are both rejected by name.
- **The hostile line**: four of the longest words in English at 0.12s each, through every style
  and every platform's safe zone, asserting the box stays inside the frame and the whole text
  block — not merely its centre — stays inside the safe area.
- **Document-level tests**: a caption track built by this phase `validate()`s in every style,
  resolves its anchors, and a DEGRADED alignment still produces a valid, resolvable document.
  Two styles with the same `maxWords` produce byte-identical word ranges — the restyle guarantee.
- **The credential fence was probed**: `ELEVENLABS_API_KEY` is rejected outside the two adapter
  folders and silent inside `src/lib/adapters/stt/elevenlabs/`.
- **The migration is applied**; `migrate deploy` ran against Neon and `migrate diff` reports no
  drift.
- **`/api/inngest` reports 15 functions**, up from 13 — `project-align` and its failure handler.
- `next build` succeeds with `/dashboard/projects/[id]/captions` present.

**NOT verified, and this is why the box is unticked — needs an `ELEVENLABS_API_KEY`.**

No key is set, so **no audio has ever been aligned**. Four of the phase's seven "done when" checks
are untested:

- Captions landing within ~50ms of the spoken word on a 60-second sample. The back-match is tested
  against synthetic transcripts; it has never seen a real one.
- A forced STT failure producing a renderable, flagged video. The degrade path is tested as a pure
  function and the warning is in the UI, but no provider has actually failed.
- Re-aligning unchanged audio making zero provider calls. The cache is checked in two places and
  the hash is tested; no provider call has ever been skipped.
- The same document producing identical captions in the Player and in a cloud render. There is now
  ONE renderer rather than three, which is the only structural guarantee available — but Phase
  04's AWS gap means no cloud render has ever run at all.

**Also outstanding:**

- **The captions screen has not been driven in a browser.** It builds and type-checks; it has not
  been clicked through on a real project, because there is no aligned project to click through.
- **Phase 09 owns the chain.** `project.tts` deliberately does NOT enqueue `align/requested` when
  a narration finishes — the generate pipeline composes the steps, and auto-triggering from here
  would race its orchestration. The single-line path (`line.resynth`) does enqueue it, because
  that edit has no pipeline behind it.
- **Caption styles are the only place in the app allowed literal colours.** That exception is paid
  for by the contrast test; if a style is ever added by hand without running it, the gallery
  surfaces a `Low contrast` label as a second line of defence.
- **The credit rates are still placeholders** (Phase 05). Alignment now charges on them.
- **R2 is still unconfigured**, so there is no narration audio to align even with a key, and
  **Phase 04's AWS deploy** remains open.

### Phase 09 — 2026-10-22

Built: the `PipelineStage` model and its migration (**applied**), the `projects.generate` /
`projects.cancel` permissions and the `generate` rate limit on the registry entry,
`src/lib/types/pipeline.ts` (the twelve fixed stages, the five statuses, `StageUpdate`),
`src/lib/generators/` (the contract, the registry, the **voiceover generator**),
`src/lib/palettes/` (what `style.paletteId` has always meant but nothing resolved), the `backdrop`
render kind and its Remotion component, `pipeline.service.ts`, `saveTimelineDocument`, `hashValue`,
the `project.generate` workflow, the four pipeline procedures — including **the first
`.subscription()` in this codebase** — the global `<StageProgress>`, the project-ready email, and
the screen at `/dashboard/projects/[id]/generate`. 41 new tests; the suite is 649 and green, and
`tsc --noEmit`, `eslint` and `next build` are clean.

**Decisions worth knowing about, because none of them were in the phase file:**

- **The pipeline INVOKES the three existing workflows rather than repeating their steps.** The phase
  lists `script` → `voices` → `tts` → `align` as steps, and all three already existed as workflows
  with their own holds, caches, fan-outs and degrade rules. `step.invoke` keeps each child owning
  its own money (a cached narration reserves nothing; a fully degraded alignment is not charged) and
  its own caching (the phase's "re-run makes zero provider calls" comes for free), and it keeps a
  thirty-step narration fan-out out of this run's replay. Grep `COMPOSE_DONT_REIMPLEMENT`.
- **That forced `cancelOn` into the three children.** Cancelling a parent does not cancel its
  children, so without it pressing Cancel would stop the orchestrator while a provider kept billing.
  This is the one change Phase 09 made to existing workflows. Grep `CANCEL_STOPS_PAID_WORK`.
- **Cancellation needed its own hold release, because Inngest does not run `onFailure` for a
  cancelled run.** There is no failure, so nothing settles, and a hold would sit against the balance
  until Phase 05's reconciler noticed. `releaseProjectHolds` releases all three of a project's
  ledger namespaces by name — never "everything for this workspace", which would cancel a render the
  customer started separately. Grep `CANCEL_RELEASES_EVERY_HOLD`.
- **The pipeline does NOT render, and `render` is written `skipped` with that reason.** Rendering is
  a separate paid action with its own hold, cap and resolution choice (`renders.create`), and this
  phase's goal is a PREVIEWABLE video. Rendering here would charge for an output nobody asked for.
- **`qa` runs BEFORE `timeline`, so it checks the pieces rather than the document.** The stage order
  puts it there and a progress list must never go green out of order, so `qa` verifies that every
  line has audio and a measured duration; the built document is validated inside `timeline` itself
  with the timeline module's own `validate()`, where a failure can name the item that broke.
- **Idempotency hashes the INPUTS, not a document.** The phase asks for `projectId + docHash`, but
  on a first run there is no document — building one is the point. What is hashed is the project's
  kind, aspect, settings and source plus its script blocks and narration text hashes. This needed
  `hashDoc`'s argument widened (`hashValue`) rather than a `JSON.stringify` at the callsite, because
  key order would otherwise change the key and every new settings field would break the guarantee.
  Grep `IDEMPOTENCY_IS_PROJECT_PLUS_SHAPE`.
- **A status check could not have delivered "one run per click".** Both requests read `draft` before
  either writes `generating`. The guarantee is the enqueue key; the `generating` check that remains
  is an ANSWER for the UI, not the mechanism.
- **The progress subscription polls the database, on the server.** There is no pub/sub in this stack
  and the writes come from Inngest workers in other processes, so nothing in the web process can be
  notified when a row changes — the honest options were a poll or new infrastructure. Putting it on
  the server is what the customer gains: one connection instead of a request every two seconds. Each
  yield is a COMPLETE snapshot, which makes reconnection trivially correct and needs no `tracked()`
  id. Grep `WHY_THE_SERVER_POLLS` and `SNAPSHOT_NOT_DELTA`.
- **`getStages` returns exactly what `progress` yields**, so the component renders one shape and the
  fallback is a `refetchInterval` rather than a second renderer. Grep
  `STREAM_AND_POLL_ARE_ONE_READ`.
- **`projects` needed `generate` and `cancel` permissions** — the same gap Phase 02 found on
  `assets` and Phase 08 on `captionStyles`. Gating `generate` as an `update` would mean anyone who
  can rename a project can spend its balance.
- **There is no up-front credit check on `projects.generate`, deliberately.** The run's cost is
  three jobs whose sizes are unknown until the script exists, so any number compared here would be a
  guess that refuses runs which would have succeeded. Each child refuses with its own exact figure
  and the pipeline turns that into a plain-language stage failure with the credits released. Grep
  `CREDITS_ARE_REFUSED_BY_THE_CHILDREN`.
- **`style.paletteId` had never been resolved by anything.** It has been in the document since Phase
  01, and a `voiceover` project is narration over a STYLED background, so `src/lib/palettes/` is the
  first module to answer what `warm` means — using **the ids existing documents already hold**
  (`warm`, `mono`, `electric`, `noir` from the fixtures, `default` from the v1 migration). New names
  would have left every stored document pointing at a palette that does not exist; a test asserts
  every fixture's palette resolves.
- **`backdrop` is a new render kind, and adding it was not a document migration.** A MediaClip draws
  an ASSET — a handle, a signed URL, an ingest behind it — and a gradient has no bytes, so
  expressing it as media would mean minting an Asset row for two colours and metering it against the
  workspace's storage quota. A new value in an open-ended enum leaves every stored document valid,
  so no `docVersion` bump went with it. Grep `BACKDROP_IS_NOT_MEDIA` and
  `ADDING_A_KIND_IS_NOT_A_MIGRATION`.
- **`GENERATORS` is a Partial record, unlike `FIXTURES_BY_KIND`.** A fixture must exist for every
  kind — that is what makes the validation tests cover a format the day it is declared — but a
  generator is the real thing, and demanding one per kind would mean declaring a format and building
  it in the same change. A stub returning an empty document would be a silent, black, paid-for
  video. Grep `DOCUMENTED_GAP_NOT_A_STUB`.
- **Which stages a kind skips lives on its GENERATOR**, so Phase 12 cannot leave the orchestrator
  with a stale list of hard-coded exceptions. Grep `SKIPS_LIVE_ON_THE_GENERATOR`.
- **`failStage` takes a reason and nothing else.** The no-stack-trace rule is enforced by the
  signature rather than by reviewer discipline — there is no parameter a provider message could
  travel through by being the easiest thing to hand. Unexpected failures go through
  `explainFailure`, which MATCHES against the engine's message and never shows it. Grep
  `NEVER_SURFACE_A_PROVIDER_MESSAGE`.
- **The strip is narration tiles, not thumbnails.** The phase asks for "a thumbnail strip filling
  in"; nothing here renders video frames outside a render, so real thumbnails would mean rasterising
  frames mid-pipeline — work the customer pays for in order to watch a progress bar. One tile per
  narration line answers the same question with information that is true. A deliberate substitution,
  not an oversight. Grep `TILES_NOT_THUMBNAILS`.
- **The elapsed clock counts local ticks on top of the server's figure.** `elapsedMs` is derived
  server-side so a skewed browser clock cannot show a negative duration, and the row's stopwatch
  then advances by counting — not by reading `Date.now()` during render, which this codebase's
  eslint purity rules forbid. Resetting it on a new reading is done by KEYING the component, because
  `setState` in an effect body is also forbidden here. Grep `ELAPSED_TICKS_LOCALLY`.
- **The "email me" recipient is a USER ID, not an address.** A `Project` belongs to the workspace and
  has no creator column, so the member who asked is recorded and the address is resolved at send
  time — storing it would copy personal data into a settings blob that `projects.duplicate` copies
  verbatim. Grep `ADDRESS_IS_RESOLVED_NOT_STORED`.
- **The `moderate` stage completes with a warning saying it is not implemented**, rather than a green
  tick with no check behind it. A tick that is not true is the thing the next phase has to discover.

**Verified.**

- **41 new tests** over everything provable without a provider: the generated document against the
  timeline module's own `validate()` in BOTH its anchored and resolved forms; the audio item offsets
  matching Phase 08's `concatAlignedLines` stitching exactly (asserted directly, because a drift
  there desynchronises captions further with every line and nothing else would notice); ducking and
  speaker tagging; the no-words, no-lines, captions-off and malformed-settings cases; the stage
  mapping's ordering, completeness, unknown-name and unknown-status handling and its clock-skew
  clamp; the hash's key-order insensitivity and its sensitivity to a changed script, setting or
  re-recorded line; every fixture palette resolving, and every palette's text colour passing the
  caption library's own contrast rule.
- **The migration is applied**; `migrate status` reports up to date and `migrate diff` reports no
  drift. The Neon database was reachable this time, unlike in Phase 05.
- **The workflow registers and serves.** `/api/inngest` reports **17 functions** — the ten
  registered entries plus the seven failure handlers.
- `next build` succeeds with `/dashboard/projects/[id]/generate` present.

**NOT verified, and this is why the box is unticked — needs an `ELEVENLABS_API_KEY` and R2.**

`ANTHROPIC_API_KEY`, `DATABASE_URL` and `RESEND_API_KEY` are set, so `moderate`, `script` and
`voices` have everything they need. `tts` has neither a provider key nor anywhere to put the bytes,
so **no generation has ever completed** and every end-to-end check in the phase file is untested:

- A prompt producing a narrated, captioned vertical video that previews and renders.
- Killing the dev server mid-run and resuming from the failed step rather than from the start.
- Cancelling stopping the run, marking the project `cancelled` and releasing the hold.
- Two rapid identical requests producing exactly one run. The hash is tested; no duplicate enqueue
  has ever been collapsed by a real queue.
- Every stage transition appearing in the UI over SSE without a refresh.
- Killing the subscription and the UI continuing on the poll.
- Closing the tab not stopping the job.
- A degraded-captions completion with a visible warning.
- A screen reader announcing each transition. The `aria-live` region is implemented and the
  announcement is unit-reasoned, but it has never been heard.

**Also outstanding:**

- **A music bed has no picker.** The generator reads `settings.generate.musicAssetId` and the
  timeline honours it with ducking, but nothing sets it — it needs Phase 11's library.
- **Three formats have no generator.** `reddit-story`, `quiz` and `motion` are refused by name.
- **Real moderation is Phase 10**; the stage says so on screen.
- **The credit rates are still placeholders** (Phase 05).
- **Phase 04's AWS deploy** and **Phase 02's R2** remain open.

### Phase 10 — 2026-10-22

Built: the **moderation adapter seam** (`src/lib/adapters/moderation/` — contract, selector, and a
Claude implementation that goes through the EXISTING LLM seam rather than opening its own client),
`src/lib/types/moderation.ts`, the `ModerationRecord` model and its migration (**applied**),
`moderation.service.ts` (where fail-closed actually lives), the real `moderate` stage replacing
Phase 09's stub, script-level classification before narration, filename moderation on upload, a
**render chokepoint** that withholds uncleared assets, `src/lib/safety/` (per-plan daily caps, the
per-IP signup cap, the verified-email rule), `src/lib/observability/` (the correlation id, one
structured logger, Sentry, the five-event funnel), `src/lib/costs/` and its daily spend alert,
`video-ops.service.ts` with the portal's video-operations console and moderation review queue, two
new transactional email templates, and a `(marketing)` route group with registry-driven pricing and
four scaffolded legal documents. 75 new tests; the suite is 724 and green, and `tsc --noEmit`,
`eslint` and `next build` are clean.

**Three findings about the phase file itself, because they change what was worth doing:**

- **The registry premise was outdated.** The phase says `rateLimit` "has never been used, so that
  path is currently dead code" — but SEVEN resources already declare it (Phases 02, 05, 08, 09).
  The only limit genuinely missing was `projects.create`, which was added. `assets.create` and
  `scripts.create` do not exist as procedures; their real equivalents (`createUploadUrl`,
  `generate`) were already limited at the phase's own numbers.
- **`renders.create` was left TIGHTER than asked.** The phase specifies 20 per 5 minutes; the
  existing limit is 10 per minute, which is stricter on burst. A render is the single most expensive
  action in the product, so loosening a working limit to match a document was the wrong direction.
- **Item 4 was already half-done.** `docs/06` and the `rate-limit.ts` FILE HEADER already carried
  the correction about `src/proxy.ts`. Two function docblocks inside that same file still named the
  proxy, and those were fixed.

**Decisions worth knowing about, because none of them were in the phase file:**

- **This is the only seam in the codebase that fails CLOSED, and the contract enforces it.** There
  is no "unknown" verdict and no nullable return — an adapter returns a verdict or throws — so no
  caller can mistake an outage for a pass. `moderateText` is the single place a throw becomes a
  refusal, and it never throws. The rate limiter's fail-OPEN comment now carries a note saying not
  to "make these consistent", because the asymmetry is the whole point. Grep
  `THIS_SEAM_FAILS_CLOSED`.
- **An outage is `flagged`, not `rejected`.** Both block the work. But telling a customer their
  content was rejected when the classifier was merely unreachable is an accusation, and it produces
  no operational signal — a pile of `flagged` rows with engine `unavailable` is a monitoring alert,
  while a pile of `rejected` rows looks like a busy day. Grep `UNAVAILABLE_ENGINE`.
- **The Claude classifier holds no key and imports no SDK.** It calls `getLlmAdapter()` with a Zod
  schema, so the LLM seam keeps owning the key, the model, the effort level and the
  retry-once-on-schema-failure behaviour — and the schema stays the boundary, so there is no path
  where the adapter holds raw model text and decides for itself whether a classification happened.
  An LLM is the WRONG long-term tool for this and the seam exists because of that. Grep
  `REUSES_THE_LLM_SEAM`.
- **Three contexts, three standards, chosen by the CALLER.** A prompt, source material and a
  finished script are judged differently — judging them alike either refuses every history
  documentary or publishes things it should not. `context` is a closed enum and is never derived
  from the text, which is what stops a pasted article declaring itself a prompt to get the looser
  bar. Grep `CONTEXT_SETS_THE_STANDARD`.
- **The pipeline classifies TWICE**, and script classification runs at the end of the `script` stage
  rather than as a second `moderate` stage. A stage that went green and then later went red is the
  one thing a progress list must never do, so the refusal fails the stage that produced the text.
  Grep `MODERATE_THE_SCRIPT_TOO`.
- **A verdict is not a status, and they are different unions on purpose.**
  `approved | rejected | flagged` is what a classifier concluded; `pending | approved | rejected |
  skipped` is where a row stands. `flagged` has no equivalent in the second — it means a human
  should look, which on an asset is still `pending`. One function maps between them and a test
  asserts the unions only overlap where they should. Grep `VERDICT_IS_NOT_A_STATUS`.
- **Upload moderation is PARTIAL and the gap is enforced rather than hidden.** The filename is text
  and is really classified; the pixels are not, and this product has no vision classifier. So a
  clean filename does NOT approve the asset — it is left `pending`, recorded as `flagged` with
  engine `awaiting-visual-review`, and withheld from every render until a person clears it. The seam
  stayed text-only rather than growing a method that always returned `approved`. Grep
  `MODERATION_IS_PARTIAL`.
- **The render gate is in `signDocumentAssets`, not the render pre-flight.** Every path to a frame
  goes through that function — preview, Lambda render, and whatever Phase 15 adds — so a check there
  cannot be bypassed by a caller who forgot it, whereas a pre-flight check protects exactly the one
  caller that implemented it. An uncleared asset resolves to `url: null`, which is the shape a
  MISSING asset already has, so no new failure mode was invented. Grep
  `NOT_APPROVED_DOES_NOT_RENDER`.
- **Before this phase, `moderationStatus` was decoration.** Nothing anywhere read it, so `pending`
  rendered exactly like `approved`. Making it load-bearing required one consequential fix:
  narration audio is now explicitly `skipped`, because it is our own synthesis of a script already
  classified as text, and leaving it `pending` would have withheld every generated video's own
  audio. Grep `SKIPPED_IS_CLEARED`.
- **The daily cap is in Redis, not the usage counter, and that needed defending.** The registry's
  `limit` is the BILLING quota: counted in `UsageMetrics`, `period` union of `'month'` only, driven
  by a reset cron. A daily cap is an abuse guardrail — rolling window, no cron, and a workspace
  hitting it is going too fast rather than being over its plan. Modelling it as a registry limit
  would have meant extending the period union, teaching the cron a second cadence, and putting a
  non-billing number in the billing counter. The per-plan FIGURES still live in one constant typed
  as a full `Record<PlanKey, …>`, so adding a plan is a compile error. Grep
  `CAP_IS_IN_REDIS_NOT_THE_COUNTER`.
- **The burst limit and the daily cap are not redundant.** Thirty an hour stops a loop; five a day
  stops a free workspace running up a provider bill all afternoon at a human pace.
- **The per-IP signup cap is not `authLimiter`.** That one is tuned for credential stuffing —
  hundreds of attempts a minute — and the threat here is the opposite shape: one free workspace
  every few minutes, all day. Hours-long window, small count, both limiters apply. The count is 5
  rather than 1 because an IP is a poor proxy for a person and an office shares one. Grep
  `SIGNUP_IS_NOT_SIGN_IN`.
- **Every plan lookup falls back to the SAFE side.** `Subscription.plan` is a string column, so an
  unrecognised value is reachable: it gets the free cap and requires verification. The unsafe
  direction has to be the one somebody types out deliberately. Grep `UNKNOWN_PLAN_IS_FREE`.
- **`requestId` rides the job ENVELOPE, not `data`.** Every workflow parses `data` with its own
  strict schema, so a field added there would mean editing a dozen schemas and any that forgot it
  would fail the parse outright. The adapter merges it in on the way out, and `readRequestId` is the
  one reader on the far side. It is also sanitised and length-bounded, because an inbound header is
  attacker-controlled and the value lands in log lines and a Sentry tag. Grep
  `REQUEST_ID_CROSSES_THE_QUEUE`.
- **Expected refusals are not Sentry events.** Every gate refuses by throwing a `TRPCError`, so
  without a distinction the tracker would get one event per plan cap, 403, 404 and rate limit — and
  the three real exceptions a week would be invisible. A list of refusal codes logs at `warn`;
  everything else reports. Grep `EXPECTED_REFUSALS_ARE_NOT_INCIDENTS`.
- **The funnel is emitted server-side, from workflows rather than routers.** A browser event is lost
  to an ad blocker or a closed tab, and the funnel's purpose is comparing counts BETWEEN steps — a
  client-side `first_render` under-reporting by 30% looks exactly like a product problem. It
  identifies by ORGANIZATION, because the product is bought by a workspace and keying on users would
  show five conversions for one five-seat team. Grep `SERVER_SIDE_FUNNEL`.
- **The cookie banner actually gates the SDK.** Consent is read with `useSyncExternalStore` and
  gates the dynamic import itself, so declining means no request and no cookie rather than a tracker
  that loads anyway. Autocapture and session recording are off — this app has customer scripts in
  text areas. Grep `CONSENT_GATES_THE_SDK`.
- **Cost and revenue are computed by DIFFERENT code on purpose.** Cost from counted provider units
  at list prices, revenue from committed ledger rows. One calculation producing both would make a
  pricing mistake cancel itself out and the margin always look fine. The cost side is explicitly
  **not an invoice** — it cannot see minimum charges, tiered discounts or egress — and the panel says
  so on screen rather than in a tooltip. Grep `MARGIN_IS_THE_POINT` and
  `OUR_RECORDS_NOT_THEIR_INVOICE`.
- **Failure rate excludes `skipped` from BOTH numerator and denominator.** A stage a format never
  runs would otherwise sit at 0% and dilute the average, hiding the stage that is actually broken.
  Grep `RATE_NEEDS_A_DENOMINATOR`.
- **Queue depth's headline is the STALE count, not the depth.** Depth alone cannot tell a busy
  afternoon from a silent breakage; work in flight for over an hour can. Grep `STALE_IS_THE_ALARM`.
- **The spend alert logs every day, including the quiet ones.** A check that only writes something
  when it fires has a silence nobody can distinguish from a broken cron. It names the biggest
  contributor, because "spend is high" sends an operator to a dashboard and "Lambda was 94% of it"
  sends them to the render queue. It goes to Sentry rather than email — that is where on-call
  already looks and it needs no recipient list. Grep `EVALUATE_EVERY_DAY_FIRE_RARELY`.
- **The pricing page reuses the upgrade modal's own comparison table.** It takes nothing but plan
  keys, so the public page and the in-app modal render the same component over the same registry and
  cannot describe different products. `<PricingCard>` was deliberately NOT reused: it needs a
  current plan and a trial state, and faking six props for an anonymous visitor is worse than simple
  cards. No prices are printed, because the amounts live in Stripe and a figure on the page would be
  a hardcoded duplicate of a value only Stripe knows. Grep `PRICING_IS_REGISTRY_DERIVED` and
  `AMOUNTS_LIVE_IN_STRIPE`.
- **The legal documents are scaffolding and say so loudly**, in a destructive-variant banner driven
  by one prop per page. The drafts were written from what the CODE does — the content policy mirrors
  the category list, the refund clauses mirror how the ledger actually behaves, and the privacy
  subprocessor list is the provider seams this app really has. The words still need counsel. Grep
  `PLACEHOLDER_IS_LOUD`.
- **A `(marketing)` route group was added** rather than putting public pages under `(dashboard)`,
  which would inherit its route gate and bounce every visitor to sign-in — for a PRICING page, that
  is the whole audience. Nothing beneath it reads a session, so all six routes prerender.
- **npm could not install the new packages** until `--legacy-peer-deps` was used: the repo's
  existing tree hits a known arborist bug in `better-auth`'s peer graph (`canvas`), and plain
  `npm install` with no arguments fails the same way on a clean checkout. Pre-existing, not caused
  by this phase, but worth knowing before the next dependency change.

**Verified.**

- **75 new tests** over everything provable without a provider: the refusal sentence naming its
  categories, listing several readably and using different copy for `flagged`; `flagged` blocking;
  the two unions overlapping only at `approved` and `rejected`; the verdict schema refusing an
  invented category, an unknown verdict and an extra field; the classifier prompt fencing hostile
  text, stripping the delimiter in any case, restating the task AFTER a long input, giving each
  context a different standard and judging source material more permissively than a script; the
  daily cap and the verification rule falling back to `free` for an unknown plan; the render gate
  clearing only `approved` and `skipped` and failing closed on an unrecognised value; the cost table
  having no `NaN` paths and pricing an unknown resolution at the HIGHER rate; the alert firing
  exactly AT the threshold, naming the top contributor, and not dividing by zero on an idle day; and
  the request id preferring an inbound value, bounding its length, and stripping what a forged log
  line would need.
- **The migration is applied**; `migrate status` is up to date and `migrate diff` reports no drift.
- **18 functions serve** at `/api/inngest` — eleven registered entries plus seven failure handlers,
  the new one being the daily cost alert.
- `next build` is clean with `/pricing` and the four legal routes **prerendered as static**.

**NOT verified, and this is why the box is unticked.**

No classification has ever run. `ANTHROPIC_API_KEY` is set so the adapter CAN reach a model, but the
pipeline still cannot get past `tts`, so nothing has been moderated end to end. And **Redis is
unconfigured**, which means every rate limit and both new caps currently fail open — the single
highest-value thing to set before opening sign-ups. Specifically untested:

- A disallowed prompt refused before any provider is called.
- Taking the classifier offline refusing the work rather than allowing it through.
- A 429 with a reset hint from a hammered generate endpoint. No request has ever been refused,
  because there is no Redis.
- A free workspace with an unverified email being unable to generate.
- Sentry receiving a forced error with its request id — no DSN is set.
- The portal console against real data. Every panel renders; the database has no completed renders.
- A stranger signing up, paying, generating and downloading unassisted.

**Also outstanding:**

- **Visual moderation of uploads is not implemented** — the largest gap. Uploads are held for human
  review because nothing can classify their frames; this needs a vision provider behind the existing
  contract.
- **The render-failed and low-balance emails are built but not triggered.** Both templates and
  senders exist and are exported; wiring them needs a recipient, and neither `Render` nor a balance
  check has one. The project's `generate.notifyUserId` is the obvious reuse and was not assumed.
- **`signed_up` is the one funnel event not emitted** — it belongs on an auth hook rather than a
  router.
- **Uptime monitoring and a status page** are an external service.
- **A landing page with real sample videos** — no samples exist, and the root route is a
  load-bearing auth probe that was deliberately left alone.
- **The legal copy needs a lawyer** and the takedown address is a placeholder. Both are launch
  blockers.
- **The credit rates and the provider unit costs are both placeholders** (Phase 05 for the former).
- **Phase 04's AWS deploy** and **Phase 02's R2** remain open.
