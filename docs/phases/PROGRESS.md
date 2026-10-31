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
- [ ] Phase 10: Safety, limits and launch — **ships public beta** — built; **blocked on the same
      ELEVENLABS_API_KEY and R2 gap** that stops any generation completing, so no classifier has ever
      run end to end. Redis IS configured, so the rate limits and the per-plan daily caps are live.
      Visual moderation of uploads is **not implemented** and the legal copy **needs a lawyer**;
      both are launch blockers. 75 new tests cover the pure halves. See the note.
- [ ] Phase 11: Backgrounds library — built; the mechanism is complete and the **catalogue is
      deliberately empty**, because the gameplay-footage licensing position is still an open owner
      decision and a licence string nobody has verified is the one fiction this product cannot
      afford. Also **blocked on R2**, so no library asset has ever been fetched or served. 53 new
      tests cover the pure halves. See the note.
- [ ] Phase 12: Reddit story format — **the first complete format** — built; **blocked on
      REDDIT_CLIENT_ID/SECRET**, so no thread has ever been fetched, and on the same
      ELEVENLABS/R2 gaps that stop any video completing. **No avatar artwork exists**, so the
      format renders with captions and a background but no faces — the largest gap, and not a code
      gap. 41 new tests, including the committed hostile-thread injection fixture. Retention was
      narrowed from the phase file's wording, deliberately; see the note.
- [ ] Phase 13: Quiz format — built; **blocked on the same ELEVENLABS_API_KEY and R2 gaps** that
      stop any video completing, so no quiz has ever rendered. Everything that can be verified
      without a provider is: 73 new tests cover the four cross-field rules, the shot plan, the
      countdown gap and the word shift it implies, the word anchors and their seconds fallback, the
      prompt's injection properties and the paste import. **The countdown is silent** — the sfx
      catalogue is Phase 11's and still empty. "Narration with SSML" was implemented **without**
      SSML, deliberately; see the note.
- [ ] Phase 14: Voiceover visuals — built; **blocked on the same ELEVENLABS_API_KEY and R2 gaps**
      that stop any video completing, and additionally on **STOCK_API_KEY and an image-model key**,
      so no clip has ever been searched and no image has ever been generated. The fallback chain's
      own promise — that a video completes with both providers unset — is the path that IS exercised,
      and it is the only one that can be today. 62 new tests cover the clip scoring and its
      deterministic tie-break, the stored choice union's provenance requirements, the prompt cache
      key in both directions, the SSRF allowlist, the prompt fencing against a committed hostile
      block, and the per-block timeline arithmetic including the guard that an existing project's
      document is byte-identical. **Whether a fetched stock clip may render at all is now an
      operator switch** (`STOCK_LIBRARY_PRE_CLEARED`, default off) — see the note.
- [ ] Phase 15: Timeline editor — built; the pure halves are **verified** (the browser-equals-server
      claim and the undo hash are asserted over one fixture by 38 new tests), while the conflict
      path, the snapshot trail and the branch-on-regenerate are **built but never exercised against
      a live database** — Neon has been unreachable since Phase 05, so no revision row has ever been
      written. Scrubbing on proxies is untested (R2), and no narration line has ever been re-recorded
      from the editor (ELEVENLABS_API_KEY). Two new ops were needed and are argued in the note, and
      `ApplyOpsResult` carries a third status the phase's contract does not list. See the note.
- [ ] Phase 16: Motion graphics studio — **16a, 16b and 16c of four are built**; 16d (the AI
      designer) is not started, so no motion video exists and nothing is metered yet. 16a is the
      scene language, the layout engine and the deterministic checks; 16b the ten primitives, the
      `motion → MotionScene` registry entry and the review gallery; 16c the seven style tokens,
      eight library styles, the "design one for me" model call and its code validation. All three
      are **verified without a provider** by 245 new tests — the measurement against the real
      `hmtx` advances, the phase's "catch an overflowing text element and an overlap", the rule
      that no animation can move the measured ink, and the whole style library passing its own
      validator. **Three things have never run**: the gallery's human review, any composite to
      MP4, and `designMotionStyle` against Claude. Two gaps are not code gaps — only one font
      family is bundled, and `stack-center` holds three list items plus a heading in a vertical
      frame, not four. See the three notes.
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
pipeline still cannot get past `tts`, so nothing has been moderated end to end. Specifically
untested:

- A disallowed prompt refused before any provider is called.
- Taking the classifier offline refusing the work rather than allowing it through.
- A 429 with a reset hint from a hammered generate endpoint. Redis IS configured, so the limiters
  are live rather than failing open — but no request has actually been refused, so the wire format
  of the refusal has never been observed.
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

### Phase 11 — 2026-10-26

Built: `src/lib/types/background.ts` (the catalogue vocabulary, the manifest schema and the plan
ladder), `src/lib/library/backgrounds.manifest.ts` (the catalogue as data — **empty on purpose**,
see below), `assetObjectKey` / `libraryKindForAssetKind` in the storage key convention, `publicUrl`
on the storage contract and its R2 implementation, CDN serving for library objects inside
`signScopedKey`, `backgrounds.service.ts` (the catalogue queries, the breadth cursor and
the one background resolver), the `backgroundLibrary` registry entry with its breadth limit,
`src/trpc/routers/backgrounds.ts` (`list` / `applyBackground` / `sync`), the `library/requested`
event and `library-ingest.ts`, a library-aware `asset-ingest` (two prefixes, and `approved` for a
curated row), `backgroundAssetId` on `settings.generate`, a resolved background on
`GeneratorContext`, the voiceover generator's footage track, and
`src/components/global/background-picker/`. 53 new tests; the suite is 777 and green, and
`tsc --noEmit`, `eslint` and `next build` are clean. **No migration** — `Asset` already carried
`source`, `license`, `minPlan` and `durationSec`, and the phase file's "no new models" was taken to
mean no new columns either.

**The catalogue is empty, and that is the deliverable rather than a gap.**

The phase opens by requiring the owner to settle the gameplay-footage licensing position before
anything is seeded, and says in so many words: build the gating, the picker, the licence column and
the looping, and leave the catalogue thin. That is what happened. Writing plausible rows would have
meant inventing source URLs and licence sentences nobody has verified — the same fiction
`voices.sync` refused when it declined to ship a seed file, except that here the fiction would live
in a licence column. The discipline is enforced instead: the manifest schema refuses the `"owned"`
column default, the empty string, `"CC0"`, `"fair use"` and eleven other placeholders, refuses a
duplicate key, and parses at module scope so a bad row fails the build. An empty catalogue is a
working product — the picker offers the styled backdrop and the workspace's own uploads.

**Four findings about the phase file itself, because they changed what was worth doing:**

- **`licenseKind` in the phase's `BackgroundManifestEntry` contract had nowhere to live.** `Asset`
  has no column for it and the phase forbids new models, so a declared `licenseKind` would have been
  validated and then discarded — exactly the decoration Phase 10 spent its time removing. The
  document's licence CATEGORY is derived from `Asset.source` instead (`licenseCategoryForSource`),
  where `library` becomes `licensed`, and an unrecognised source maps to `unknown` rather than
  `owned`. The prose TERMS still live on `Asset.license`, which is the field an operator needs.
- **The phase's `listBackgrounds` contract returns one `items` array; it had to be two.** The
  breadth cap applies to the CATALOGUE and not to a customer's own files, so in one interleaved list
  a workspace that had uploaded twenty clips would push catalogue rows past its plan's breadth and
  lock backgrounds it had paid for. Grep `LIBRARY_IS_ITS_OWN_QUERY`.
- **The registry block names one permission (`read`); the entry declares three.** A mutation with no
  permission is gated by nothing — the procedure builder refuses an ungated mutation outright — so
  the write needs `apply`, and the operator's catalogue import needs `sync` for the same reason
  `voices.sync` does. Both follow that entry's shape exactly.
- **Step 4 was already true.** `signAssetUrl` has handled "mine or library" since Phase 02 and
  needed no change; what it needed was the CDN branch (step 3), which went into the same function.

**Decisions worth knowing about, because none of them were in the phase file:**

- **The breadth cap is a CURSOR, not a row index, and the first version of it was wrong.** "The
  first N of the catalogue" looks like `skip + index` on the page being rendered, which the list
  handler has for free — and that is correct only while the page IS the catalogue in order. Under a
  SEARCH it is the rank among the matches, so a free workspace searching "rain" would have seen the
  first ten hits unlocked even if they were rows thirty to forty, clicked one, and been refused by a
  server that re-checks properly. The cap is now resolved once into the `(createdAt, id)` of the last
  included row, and one PURE function compares every row against it — the same function on the read
  and the write, which is the only reason the badge and the refusal cannot drift. Grep
  `A_CURSOR_NOT_A_ROW_INDEX`.
- **The catalogue is ordered OLDEST FIRST**, the only ordering in this codebase that is not newest
  first, and it is load-bearing. A plan's breadth is "the first N of the catalogue", so on a
  newest-first list every background the operator added would silently push a different one out of
  reach and a customer would find the loop they used last week locked. Oldest first means the set a
  plan can use only ever grows. Grep `CATALOGUE_ORDER_IS_STABLE`.
- **The breadth cap is a registry `limit` that counts nothing.** It is declared there so the pricing
  page and the upgrade modal's comparison table get it for free — catalogue breadth is a thing
  customers buy — but the resource has no `create` verb, so the procedure builder's plan gate and
  counter bump never fire and `UsageMetrics` stays empty for it. It is applied at read time as a
  CURSOR comparison, and the write recomputes the cursor rather than trusting a boundary the client
  sent. Grep `BREADTH_NOT_A_COUNTER` and `BREADTH_IS_APPLIED_AT_READ_TIME`.
- **The manifest key is the asset's PRIMARY KEY** (`lib-<key>`), not a new column. That is what makes
  a re-sync an update: without it, correcting a licence string would mint a new asset, leave the old
  one in the catalogue and strand every project pointing at it. It also makes the object key stable,
  so the bytes are fetched once. Grep `MANIFEST_KEY_IS_THE_IDENTITY`.
- **The ingest had exactly one place it could go wrong, and it was the keys.** A library asset's
  variants written under `orgs/<whoever-synced-it>/uploads/…` fail `isLibraryKey`, so `signScopedKey`
  refuses them for every OTHER workspace — the catalogue would be invisible to the tenants it exists
  for, and it would look like a signing bug. `assetObjectKey` is a discriminated union with no
  default, so the library case cannot be forgotten and an organization id cannot be passed for a
  shared row. Grep `ONE_OWNER_ONE_PREFIX`.
- **The CDN decision is four lines inside `signScopedKey`, not a branch in three callers.** Every
  path that turns an asset into a URL already goes through that function — the picker's thumbnails, a
  voice preview, and `signDocumentAssets` on the way to a render — so putting it anywhere else would
  have meant two callers signing a public object forever. The ownership check still runs first for
  tenant keys, so no amount of CDN configuration can make a customer's upload public. Grep
  `LIBRARY_IS_SERVED_FROM_THE_CDN`.
- **A library row is `approved`, which is the only exception to Phase 10's fail-closed moderation.**
  An upload is held `pending` because nothing has looked at its pixels; a library row exists only
  because somebody added it to the manifest, which is a code change a person reads and which carries
  the licence they established. Holding it afterwards would mean asking an operator to clear, in a
  queue, the thing they just committed — and until they did, every picker would be empty. It is
  `approved` rather than `skipped` because `skipped` means "moderation does not apply" and is for our
  OWN output; a curated loop is somebody else's footage that a person vouched for. The record names
  `library-manifest` as its engine, so the queue can tell a model's verdict from a human's. Grep
  `LIBRARY_IS_APPROVED_BY_REVIEW`.
- **One resolver feeds both the picker and the pipeline.** If each had resolved its own background,
  the picker could pre-select one row while the generator used another, and the customer would get a
  video with a background they can see they did not choose — with nothing on either side looking
  wrong in isolation. Three places are tried in order (the project's choice, the workspace's last
  pick, the catalogue default), and EVERY candidate is re-checked including the stored one, because a
  background can be deleted, rejected by a later review, or fall out of reach on a downgrade. Grep
  `ONE_RESOLVER_TWO_CALLERS` and `THREE_PLACES_TO_LOOK`.
- **The background is resolved BEFORE the generator and handed to it as a fact.** `GeneratorContext`
  carries a `db` and the obvious reading is that the generator queries the library — but choosing one
  weighs three candidates against the plan, and `GENERATOR_CONTEXT_IS_FACTS` says a generator must
  not be able to read a plan. So the plan is resolved in the workflow (where the render pre-flight
  already reads one), the resolution happens in a service, and generators stay pure. The `db` on the
  context remains unused. Grep `RESOLVED_BEFORE_THE_GENERATOR`.
- **The plan is read FRESH in the workflow, not taken from the event.** A run that waited in a queue
  while the workspace downgraded must use the plan it has now.
- **Footage REPLACES the backdrop rather than layering with it.** A backdrop sits on the scene track
  and composites above a video item, so a document carrying both would draw a gradient over the
  footage the customer chose, and the bug would read as "my background did not apply". Grep
  `FOOTAGE_OR_BACKDROP_NEVER_BOTH`.
- **A clip with no measured duration is emitted with `loop: false`**, and the tile says "plays once"
  on screen. The loop divides by the source length, so a loop with no modulus is a division by zero —
  and silently promising a seamless loop the renderer cannot deliver is worse than saying so.
- **Changing the background rewrites no document.** `captions.applyStyle` can restyle an existing
  timeline because a restyle provably cannot change the timing; swapping the footage changes what
  every frame looks like, and half-rewriting a document from a router would produce a preview the
  pipeline never built. The handler returns `appliesToNextGeneration` so the UI says so rather than
  leaving the customer to notice.
- **The picker is a `radiogroup`, not twenty buttons.** The tiles are a single-select, and the
  phase's "fully keyboard navigable" means a roving tabindex with arrow keys — a grid of buttons is
  reachable with Tab but makes a screen-reader user hear twenty unrelated controls instead of one
  choice with twenty options. The COLUMN COUNT is measured from the laid-out tiles rather than
  hard-coded, because the grid is responsive and Up/Down have to move exactly one row. Grep
  `RADIOGROUP_NOT_A_LIST_OF_BUTTONS` and `ROVING_TABINDEX`.
- **A locked tile stays focusable.** `disabled` would take it out of the keyboard order, so a
  keyboard user could not discover the thing exists — which defeats the entire point of
  `LOCKED_NOT_HIDDEN`. Clicking it opens the upgrade modal.
- **"No footage" is a TILE in the group, not a Clear button beside it.** The styled backdrop is one
  of the options and a customer going back to it is choosing a look, not undoing something. Grep
  `BACKDROP_IS_A_CHOICE`.
- **The licence is printed on every tile.** It is the answer to the riskiest question in this
  product, and somebody about to publish something monetised should not have to open anything to
  read it.
- **`writeGenerateSettings` gained a `clear` argument**, because `patch` cannot express removal:
  `exactOptionalPropertyTypes` refuses an explicit `undefined`, and a key left present with an
  undefined value is not what "back to the styled backdrop" means. The clearable keys are DERIVED
  from the schema, so `notifyWhenDone` can never be deleted by mistake. Grep
  `CLEARING_IS_NOT_PATCHING`.
- **`backgroundLibrary.applyBackground`, not `.apply`** — tRPC reserves `apply` (it collides with
  `Function.prototype.apply`) and the router throws during `next build`. This is also why
  `captionStyles` is reached at `applyStyle`; the phase file's contract named `apply` and could not
  have worked. The PERMISSION is still `backgroundLibrary:apply`.
- **`visuals` stays `skipped` for voiceover, now deliberately rather than pending.** Choosing a
  background is one read and one decision taken before the build, not a stage's worth of work, and a
  stage that goes from pending to complete in the same instant is noise on a progress list somebody
  is watching. Phase 14's per-block stock search is what fills that stage in.

**Verified.**

- **53 new tests** over everything provable without a provider: the manifest schema refusing the
  `"owned"` default, fourteen placeholder licences, a one-word licence, a non-hyphenated key, a kind
  with no library shelf, an extra field and a duplicate key; the licence category enum matching the
  timeline document's own union exactly, and an unrecognised `source` mapping to `unknown` rather
  than `owned`; a library asset id surviving the storage traversal guard; `assetObjectKey` putting a
  library object where `isLibraryKey` accepts it and `isOwnedByOrganization` does not, and keeping
  the traversal guard on that path; every library folder being reachable from some asset kind; the
  plan ladder locking a row above the plan, freeing an ungated one, and LOCKING an unrecognised
  `minPlan`; `plansUpTo` selecting exactly what `backgroundAvailableOnPlan` allows over every plan
  pair; `publicUrl` answering null with no CDN configured and needing no credentials; the registry
  entry declaring no `create` verb and no period; the breadth cursor including its own boundary row,
  locking everything on a zero cap, breaking a tie on id exactly as the catalogue ordering does, and
  giving one verdict per row whatever query found it; and the generator replacing the backdrop, spanning
  and looping the narration, staying muted, refusing to loop an unmeasured clip, carrying the
  licence and no URL, keeping the music bed alongside, and emitting no footage at all for an empty
  run.
- **The suite is 777 and green**; `tsc --noEmit`, `eslint --max-warnings=0` and `next build` are all
  clean, with `/pricing` and the four legal routes still prerendered.
- **No migration was needed**, and `migrate status` confirms the database is up to date.
- **12 workflows are registered**, the new `library-ingest` among them with its own failure handler.

**NOT verified, and this is why the box is unticked.**

No library asset has ever existed. Specifically untested:

- A library background rendering in a generated video, cropped to 9:16 and looping to the narration
  length. This needs R2 (Phase 02's open blocker) and a real clip, and the looping itself is Phase
  03 code that has never run against a short source.
- A background shorter than the narration looping without a visible seam — a thing only a human can
  judge, against footage that does not exist yet.
- A library asset resolving for a workspace that does not own it, and a CDN URL being served at all.
  `R2_PUBLIC_URL` is unset, so even with a catalogue the code would fall back to signing.
- A gated library asset being refused below its `minPlan` over the wire, and the breadth cursor
  refusing a row. Both are unit-tested as pure functions; neither has refused a real
  request.
- The sync, the fetch and the library ingest end to end. No bytes have moved.
- The picker against real data. It renders, and it renders the empty state.

**Also outstanding:**

- **The licensing position is still an open owner decision** — footage AND music — and it is the
  reason the catalogue is empty. It is the first unchecked box under "Blocked on an owner decision"
  and nothing in this phase changes that.
- **No music or SFX picker.** The manifest, the ingest, the licence discipline, the key convention
  and the plan gate all already cover the audio kinds, and `settings.generate.musicAssetId` has
  existed since Phase 09 — but nothing is wired to it, so a bed can only be chosen by writing the
  setting directly. Deferred deliberately: there is nothing to choose from until the music licences
  are settled, which is the same owner decision.
- **No operator console for `sync`.** The mutation has no screen, the same state `voices.sync` has
  been in since Phase 07. An import against an empty manifest is a button with nothing to do.
- **A library asset cannot be withdrawn from a screen.** Raising a row's `minPlan` is a manifest edit
  plus a re-sync; deleting one is `assets.delete`. A sync deliberately never deletes, because
  projects point at these rows.
- **Phase 02's R2** and **Phase 04's AWS deploy** remain open, and both of them block this phase's
  end-to-end checks.

### Phase 12 — 2026-10-28

Built: the **Reddit adapter seam** (`src/lib/adapters/reddit/` — contract, selector, a pure URL
parser holding the host allowlist, and an official-API implementation with an OAuth app),
`src/lib/types/reddit.ts` (the five refusal sentences, the three speaker roles, the condensation
schema, the retention window), `src/lib/types/avatar.ts`, the `Avatar` model and its migration
(**applied**), `avatars.service.ts`, `src/lib/script/reddit-prompt.ts` + `condense.ts`,
**`SCRIPT_WRITERS`** (`src/lib/script/writers.ts` — the new extension point),
`src/lib/generators/common.ts` (everything a format shares, extracted from the voiceover
generator), `reddit-story.ts`, `avatar-windows.ts` (the flicker maths),
`src/lib/captions/speakers.ts`, the `RedditCard` and `AvatarOverlay` component families registered
into the render registry, `src/trpc/routers/reddit.ts` and `avatars.ts`, the `redditStories` and
`avatars` registry entries, the `reddit-retention` cron, the Reddit input panel on the script
screen, and the eslint credential fence plus the setup-checklist row. 41 new tests; the suite is
852 and green, and `tsc --noEmit`, `eslint --max-warnings=0` and `next build` are all clean.

**Five findings about the phase file itself, because they changed what was worth doing:**

- **The phase's `RedditFetchError` union is five values; the adapter declares seven.**
  `unavailable` was added as an honest catch-all — Reddit answering something this build does not
  recognise is not any of the five, and folding it into one of them would hide a case worth adding
  later. `rate_limited` was in the phase's list and is the one failure that is OURS rather than the
  thread's, so it is reported as transient while the other five are permanent.
- **Step 7's "switches to `talking` on that speaker's word timings" contradicts its own next
  sentence.** Word timings are available (aligned words carry a speaker), and using them directly
  switches the mouth shut on every comma — which is precisely the sub-200ms flip the same step
  forbids. It is implemented at LINE granularity, which satisfies both readings: a line is the
  measured unit of audio, so a line is a continuous stretch of talking and the gaps between lines
  are the real pauses. Grep `TALKING_IS_PER_LINE_NOT_PER_WORD`.
- **Step 7's `reaction` "on marked beats" has no marker and no producer.** Nothing in the document
  marks a beat, and inventing one would be a document concept with one consumer and no author. The
  rule chosen instead needs no new concept and is what these videos actually look like: a character
  reacts for 450ms as it arrives, then speaks. Grep `REACTION_IS_THE_ENTRANCE`.
- **Step 12's "outputs expire" was narrowed, deliberately, and this is the one place the phase was
  not followed literally.** See the section below.
- **Step 2's paste-text fallback would not have worked for this format** as the contracts are
  written. The condenser originally required a structured thread, which meant a fetch failure
  offered a fallback that produced single-voice narration while the fetched path produced several —
  a different product depending on whether Reddit was up. It takes flattened TEXT instead, so both
  paths go through the identical prompt and schema. Grep `PASTE_IS_THE_SAME_PATH`.

**The retention decision, because it is the one deviation worth arguing about.**

The phase says "outputs of this kind expire after the configured window". The sweep removes **our
copy of somebody else's thread** — the flattened source text, the structured thread and the
snapshot — and does NOT touch the script, the narration audio, the timeline or any render.

Those are the customer's own derived work and they SPENT CREDITS on them. Deleting a finished video
on a schedule is taking back something they paid for, and this app's own privacy copy promises the
opposite ("your projects and media stay until you delete them"). Shipping a cron that quietly
deletes paid outputs is also not a thing to do without the owner saying so. If that IS wanted, it
is a separate decision with legal copy and a customer notification attached rather than a side
effect of a retention job — and this note is where to start. Grep
`WHAT_EXPIRES_IS_THE_CACHED_SOURCE` and `NEVER_DELETE_THE_CUSTOMERS_WORK`.

The privacy policy's retention section now states what the sweep does, with the window read from
`REDDIT_RETENTION_DAYS` rather than restated — a retention clause that omits a deletion the product
performs is worse than no clause.

**Decisions worth knowing about, because none of them were in the phase file:**

- **There is NO Reddit workflow.** `SCRIPT_WRITERS` is a registry keyed by `ProjectKind`, mirroring
  `GENERATORS`, and the existing script workflow resolves the writer from the project's kind — so
  the credit hold, the retry classification, the refund on every path and the one transaction that
  saves and charges are all Phase 06's, unchanged. The alternative was
  `if (kind === 'reddit-story')` inside `project-generate`, which the generator registry's own
  header explains the cost of. Phase 13 gets all of it free. Grep `ONE_WORKFLOW_MANY_WRITERS`.
- **`reddit` is a FOURTH source kind, not a flavour of `url`.** `extractSource` stays the one
  extraction entry point, with an exhaustive switch — but `scriptSourceSchema` (the wire input of
  `scripts.generate`) deliberately does NOT accept it, because that endpoint writes a
  single-narrator script and would produce a Reddit project with no card, one voice and no expiry
  while nothing errored. Two unions sharing their three common arms as values, so they cannot drift.
  Grep `REDDIT_IS_NOT_A_SCRIPT_SOURCE`.
- **`ExtractedSource` grew a `thread` field.** The speaker split needs the STRUCTURE, and
  recovering it from the flattened prose would mean parsing our own formatting back out — which
  would make the cast depend on a string template. Grep `STRUCTURE_SURVIVES_EXTRACTION`.
- **Five generator behaviours moved to `common.ts`.** A Reddit story and a voiceover differ in
  exactly two ways (a card and avatars) and are identical in five. Two copies of "a background
  shorter than the narration loops, and one with no measured duration does not" is two places for
  it to stop being true, and the second copy is always the wrong one. The voiceover generator went
  from ~330 lines to ~160 with no behaviour change — all 25 of its existing tests passed against
  the refactor before anything new was added. Grep `COMPOSED_FROM_COMMON`.
- **The avatar state timeline is baked into the document, and it HAD to be.** A render component
  receives `item`, `assets`, `frames` and `canvas` and not the document
  (`RENDER_COMPONENT_CONTRACT`), so the overlay cannot read `doc.words` and could not derive a
  talking state if it wanted to. The component does one scan to find the span covering its frame.
  Grep `WINDOWS_ARE_COMPUTED_NOT_DRAWN`.
- **A window breaks on the SPEAKER and only on the speaker.** The first implementation also broke on
  a long gap, which meant a character left the screen mid-thought and came back a second later — a
  bigger switch than the flicker the rule exists to prevent. A pause inside a window is a `neutral`
  stretch instead: the character standing there, not talking.
- **A dropped short window has its neighbours RE-MERGED.** Dropping a two-word interjection on its
  own left a hole where the surrounding character blinked off and back on — the same flicker wearing
  a different hat. Two passes, because one pass cannot know that the run it is starting will turn
  out too short to keep. Grep `DROP_THEN_REMERGE`.
- **Every avatar overlay shares one `z`**, which is safe precisely because the windows provably do
  not overlap. An incrementing depth would make it depend on how many speakers happened to talk,
  which is a document that re-renders differently after an edit that changed nothing visual. Grep
  `AVATAR_Z_IS_STABLE`.
- **The card is a SCENE item and runs UNDER the narration.** The narrator is already reading the
  title while it is on screen, which is how these videos work — a card that delayed the audio would
  put a silent hold at the front of every video, which is the one place a viewer leaves. It is a
  scene item rather than a caption because the title is not a word anybody narrated and has to be
  legible whether or not the alignment produced anything. Grep `CARD_THEN_STORY` and
  `CARD_IS_NOT_A_CAPTION`.
- **The card carries NO Reddit branding** — no logo, no wordmark, no orange, no snoo, no imitation
  of their UI. Those are trademarks, and a video that looks like it came FROM Reddit is a different
  legal problem from one that quotes a thread. It is our card in the app's own palette, with the
  subreddit as plain-text attribution. Grep `NO_REDDIT_BRANDING`.
- **`condenseSystemPrompt()` takes no arguments**, which is the strongest available form of
  `UNTRUSTED_TEXT_IS_NEVER_SYSTEM`: there is no parameter for thread text to arrive through, so no
  future edit can interpolate one by accident. A test asserts its arity.
- **Usernames never reach the model.** Participants are labelled by role and every handle is
  dropped. Two reasons: a username is a real person's handle and nothing good comes of asking a
  model to write in their name, and it is also free-text its owner chose, which makes
  `u/ignore_all_previous` a delivery vector that costs nothing to close. Grep
  `USERNAMES_NEVER_REACH_THE_MODEL`.
- **`redditStories` is a flag that is TRUE on every plan — a kill switch, not an upsell.** This is
  the one feature depending on a third party's terms, and if Reddit changes them or suspends the app
  the operator needs to turn the format off for everybody in one edit without a deploy. Flipping
  those booleans makes the factory's flag gate refuse every verb, reads included. It is deliberately
  not a `limit`, which would be a second quota counting what `renders` already bills. Grep
  `A_FLAG_NOT_A_LIMIT`.
- **The preview is a deliberate second click**, not a debounce as you type. Every lookup is a
  request against Reddit's API under our shared credentials, so a debounce would spend that budget
  on half-typed links — and the resource's own rate limit would start refusing the customer who is
  typing carefully. Grep `THEIR_RATE_LIMIT_NOT_OURS`.
- **The link is validated locally first**, with the same pure parser the server uses, so a share
  link gets the sentence that names the fix with no request at all. That is the whole reason the
  parser is credential-free and lives outside the adapter's implementation folder.
- **Per-speaker caption colour and its name tag come from ONE function**, so there is no way to
  ship the tint without the tag. The phase requires the pairing and the reason is not decoration:
  roughly one man in twelve cannot reliably distinguish two tinted captions, and for them colour
  alone carries no attribution. Two functions would make "colour only" a one-line shortcut. Grep
  `COLOUR_IS_NEVER_THE_ONLY_SIGNAL`.
- **The colour is DERIVED from the tag, not stored**, so the same speaker is the same colour in
  every video and re-generating cannot reshuffle them. `narrator` is pinned to plain white, because
  it is the voice in most of every video and tinting it would colour most captions in the product
  for no informational gain — which also means a single-voice video looks exactly as it did before
  the feature existed. Grep `NARRATOR_IS_ALWAYS_WHITE`.
- **`Avatar.assetSet` is one jsonb column rather than three.** Three nullable columns could hold a
  row with `talking` set and `neutral` null, which is a character that cannot be drawn at rest and
  the renderer would find out mid-video. One value parsed as a whole is either complete or refused.
  Grep `A_SET_IS_COMPLETE_OR_REFUSED`.
- **The avatar artwork goes through the Phase 11 library pipeline**, as `kind: 'avatar'` entries in
  the background manifest — same ingest, same variants, same `library/avatars/…` prefix, same CDN
  serving. The avatar sync runs SECOND and refuses any character whose three frames are not yet
  `ready`, per character rather than per run. Grep `ARTWORK_MUST_EXIST_FIRST`.
- **A cast member is resolved before the generator and re-checked at generate time.** The plan is
  checked at assignment (so a customer gets an explanation) AND again when the document is built (so
  a workspace that downgraded gets a video without the premium face rather than a leaked feature).
  Grep `CAST_IS_A_FACT` and `UNASSIGNED_IS_NOT_AN_ERROR`.
- **`speakerColors` on the caption track is OPTIONAL, not defaulted.** A `.default()` makes the
  field required on the inferred output type, which would have meant every fixture and every
  caption-track builder growing a `speakerColors: false` that says nothing. No `docVersion` bump
  went with it: an optional field leaves every stored document valid, so there is nothing for a
  migration to change. Grep `ADDING_A_FIELD_IS_NOT_A_MIGRATION`.
- **`backgroundLibrary.applyBackground` taught us that tRPC reserves `apply`** (Phase 11). The same
  class of trap was avoided here: `redditStories.start` rather than `create`, because the path verb
  drives the audit key and the rate-limit key.

**Verified.**

- **41 new tests.** The hostile-thread fixture puts an injection in every attacker-controlled field
  — title, body, subreddit, each comment, each username — and asserts the system prompt's arity, the
  boundary stated before the task, exactly one surviving fence however many markers the thread
  wrote, case-insensitive stripping, the task restated after the fence with nothing of the thread's
  after it, every field inside the fence, every username dropped, and the schema refusing the
  invented role, the extra field and a prompt dump. The URL parser refuses four lookalike hosts, a
  userinfo URL, `http:`, a share link, a subreddit URL and four malformed ids, and accepts the four
  shapes people paste while dropping the query. The avatar maths asserts one window per speaker run,
  a short gap absorbed, a real pause kept as neutral, a short window dropped AND the hole closed,
  the switch landing exactly on the line boundary, no state span shorter than the threshold, and
  full coverage with no gaps or overlaps over forty lines. The reddit generator asserts a valid
  document before and after anchor resolution, the card first and capped, the story still rendering
  with no card, one overlay per run at one depth, three handles per avatar and one set for a
  character used twice, no overlay for a faceless speaker, footage replacing the backdrop, and the
  caption lane asking for colours only when the project did. The caption tints are held to Phase
  08's own contrast threshold.
- **The suite is 852 and green**; `tsc --noEmit`, `eslint --max-warnings=0` and `next build` are all
  clean.
- **The migration is applied** and `migrate status` reports the database in sync.
- **13 workflows are registered**, the new `reddit-retention` cron among them.
- **The voiceover refactor is behaviour-preserving**: all 25 of its existing tests passed against
  `common.ts` before any Reddit code was added.

**NOT verified, and this is why the box is unticked.**

No thread has ever been fetched. `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are unset, so the
adapter has never authenticated. Specifically untested:

- A real public thread URL producing a complete video. This also needs the ELEVENLABS and R2 gaps
  closed — a Reddit story goes through narration, alignment and a background like any other video.
- The five failure cases against real threads. Each is mapped and each mapping is read from a
  documented Reddit response shape, but no deleted, removed, private, quarantined or missing thread
  has actually been fetched — so the branch that reads `[deleted]` out of a 200 has never run.
- A Reddit-looking URL that REDIRECTS into a private range. The host allowlist refuses the obvious
  cases locally and the API host is ours, so the SSRF path is not reachable from this input at all —
  which is the right answer and is not the same as having tested it.
- **A thread containing explicit instructions to the model does not change the model's behaviour.**
  The four structural properties and the schema's refusals are tested; what is NOT tested is a real
  model's response to the fixture, deliberately — see the note in the test file on why that test
  would cost money per run and prove nothing about the next model version. An end-to-end check
  against a live model with the committed fixture is still worth doing once, by hand.
- A two-speaker video with the correct avatar visible per line. The maths is tested exhaustively;
  nothing has been rendered, and no avatar artwork exists.
- The rate limiter refusing a hammered `preview`.
- The retention sweep running against real rows.

**Also outstanding:**

- **No avatar artwork exists**, so the character catalogue is empty and the format renders with
  captions and a background but no faces. This needs an illustrator, three frames per character,
  and a provenance statement per row. It is the largest gap in the phase and it is not a code gap.
- **No character picker in the UI.** `avatars.list` and `avatars.assign` exist, are gated and are
  audited, but nothing on the cast screen calls them — a picker over an empty catalogue is a grid
  with nothing in it. The pipeline already reads `Speaker.avatarId`, so the format works the moment
  a character exists and a row points at it.
- **No portal console for `avatars.sync`**, the same state `voices.sync` and
  `backgroundLibrary.sync` are in.
- **The Reddit app's API terms have not been read by a lawyer.** The implementation uses the
  official API with an OAuth app, respects the rate limits, sends a descriptive User-Agent and holds
  a retention window — but "we are compliant" is a legal conclusion and nobody qualified has drawn
  it. The kill switch exists for the day that conversation goes badly.
- **Phase 11's music picker and its unresolved licence category** (grep
  `MUSIC_LICENCE_IS_NOT_RESOLVED_YET`) and **Phase 11's empty background catalogue** are both still
  open, so a Reddit story currently plays over the styled backdrop.
- **Phase 02's R2**, **Phase 04's AWS deploy** and the **ELEVENLABS_API_KEY** remain the three
  blockers that stop any video completing end to end.

### Phase 13 — 2026-10-28

Built: `src/lib/types/quiz.ts` (the contracts, the four cross-field rules, the five refusal
sentences, the derived request schema), `src/lib/quiz/` (the shot plan, the pronunciation
transform, the paste parser), `src/lib/script/quiz-prompt.ts` + `quiz.ts`, the `quiz` entry in
**`SCRIPT_WRITERS`**, the `quiz` entry in **`GENERATORS`** with `src/lib/generators/quiz.ts`,
the `QuizCard` family registered into the render registry, `src/trpc/routers/quizzes.ts`, the
`quizzes` registry entry, and the quiz input panel on the script screen. 73 new tests; the suite is
925 and green, `tsc --noEmit` and `eslint` are clean, and `next build` succeeds — with the two
Turbopack NFT warnings about `next.config.ts` that this repo already emitted before the phase.

**The card has been rendered and looked at**, which is the one part of this phase that a test
cannot check: `remotion still … quiz` against the committed fixture draws the question, all four
options and the countdown ring emptying, inside the frame. That also exercises the unfamiliar-layout
fallback, because `quizFixture` predates this phase and uses `quiz-four-up`.

**It touched shared code twice, and both are the interesting part of the phase.** Everything else
plugged into the two extension points Phase 12 built, exactly as intended — no workflow's credit
handling, no stage list and no renderer changed.

- **`layNarration` gained an optional beat between lines, and returns the aligned words shifted by
  it.** A countdown is a hole in the narration lane, and `NARRATION_IS_SEQUENTIAL` forbids one
  because `layNarration` and `concatAlignedLines` have to agree about where line four starts. Three
  places could have made the hole: the TTS seam with SSML (widens a contract that deliberately has
  none, for one format, and puts markup in `NarrationLine.text` that the aligner then has to
  reconcile against words nobody said), the narration and alignment stages with a stored per-line
  gap (a column, a migration and two shared-stage edits for something one format wants), or the
  GENERATOR. It went to the generator, because a gap is a layout decision about a document. The
  alignment row stays gapless and stays correct for its own purpose; the DOCUMENT is internally
  consistent, which is the only consistency that matters. Grep `COUNTDOWN_IS_A_LEAD_GAP` and
  `BEATS_SHIFT_THE_WORDS`.
- **`WrittenScript` gained an optional `settingsPatch`.** A quiz's questions are not words anybody
  narrates — they have options and a correct index and the card draws them — so there is no block to
  put them on, and the generator needs them. The workflow merges the patch into `Project.settings`
  in the SAME transaction that saves the blocks and charges the credits, which is the point: a quiz
  whose narration was saved and whose questions were not is a paid-for video of a host asking
  questions no card can draw. The alternatives were a model call inside a 10-second transaction, a
  duplicate workflow with its own hold and refund paths, or a generator that asks a model (which
  breaks Phase 04's render reuse outright). Grep `THE_WRITER_RECORDS_WHAT_IT_DECIDED`.

**Three findings about the phase file itself, because they changed what was worth doing:**

- **Step 7's "narration with SSML" cannot be followed as written, and did not need to be.** The TTS
  adapter's contract states as a decision that it has "no streaming, no SSML, no voice management".
  The two things SSML was wanted for are both achieved otherwise: the countdown is the gap above,
  and the phonetic overrides are a respelling of the SPOKEN copy while the card keeps the original
  spelling. That is strictly better than SSML on both channels — "SQL" is read as "sequel" and still
  reads as "SQL" on screen — and it needs no seam change. If a later phase wants real prosody
  control, that is its own argument. Grep `PHONETICS_ARE_SPOKEN_NOT_SHOWN`.
- **Step 2's "distractors that are actually plausible" needed tuning, not just writing.** The naive
  rule is a length ratio, and it refuses "Jupiter" against "Mars" constantly — four characters
  against seven is 1.75x and a perfectly fair question. It needs BOTH a ratio and an absolute
  character gap, and the committed test has as many accepting cases as rejecting ones, because a
  rule that over-refuses fails invisibly in a suite that only checks bad sets are caught. Grep
  `LENGTH_IS_THE_LLM_TELL`.
- **The voiceover generator's own note predicted this phase would need the `storyboard` stage. It
  does not.** A quiz is multi-shot, but its shot order is entirely determined by the question set,
  so the stage would be a progress row for an arithmetic step — and a stage that goes from pending
  to complete in the same instant is noise on a list somebody is watching. `align` is NOT skipped,
  though a quiz draws no captions, because the word timings are what the cards are anchored to.

**One decision that is a narrowing rather than a finding.** `answerType: 'open'` still stores
options. The phase's own contract makes `options` required with a minimum of two, so "open" is a
presentation choice — the question card does not draw the list and the reveal still does, because
the reveal has to name the right answer. Switching a finished quiz between the two is a settings
change and a re-render rather than a re-authoring. Grep `ANSWER_TYPE_IS_PRESENTATION`.

**Done-when checks:**

- [x] A topic produces a complete quiz video with countdowns and reveals — the document does;
      **the video has never rendered**, for the ELEVENLABS/R2 reasons below.
- [x] Manually entered questions render identically to generated ones — structurally, not merely
      tested: both arms are parsed by one schema and checked by one function, and nothing after
      that point can tell them apart. Grep `ONE_SHAPE_TWO_INPUTS`.
- [x] A set with two correct answers, a duplicate option or a duplicate question is rejected and
      regenerated rather than saved. The rejection is fed back to the model by question number;
      a second refusal is permanent and refunds.
- [x] A very long question auto-scales and stays inside the safe zone without truncation — the
      smallest font band is sized so the schema's 200-character cap WRAPS inside the safe box, so
      the ellipsis is unreachable through the product's own forms.
- [x] An acronym with a phonetic override is pronounced as specified — the narration is respelled;
      **unverified against a real voice**, because no audio has been synthesised.
- [x] The countdown contains no speech — satisfied by there being a hole in the narration rather
      than by anything muting a voice, which is what the committed test measures.
- [x] A free workspace cannot reach the quiz routes at all, server-side included — the `quizzes`
      flag is false on `free`, and the procedure builder's flag gate refuses every verb including
      the reads, with no check in either handler.

**Also outstanding:**

- **The countdown is silent.** `settings.quiz.countdownAssetId` is read and the sfx track is built
  when it is set, but Phase 11's library ships empty and there is no sfx picker, so nothing ticks.
  Silence is a complete video, which is why it is the working default; the unresolved music and sfx
  licence category (grep `MUSIC_LICENCE_IS_NOT_RESOLVED_YET`) is the same open owner decision.
- **No question editing after generation.** The questions are baked into the scene track and are
  edited thereafter through the timeline editor, which is Phase 15 — the phase file says so. Today
  the only way to change them is to re-run the quiz panel, which replaces the script.
- **No model has written a quiz yet.** The prompt, the schema, the four rules and the
  reject-and-regenerate loop are all tested without a model, deliberately — but nobody has seen what
  Claude actually returns for ten hard questions on a niche topic, so the `length_tell` threshold is
  reasoned rather than observed. It is the first thing to check once a generation runs.
- **Phase 11's empty background catalogue** means a quiz plays over the styled backdrop, and
  **Phase 02's R2**, **Phase 04's AWS deploy** and the **ELEVENLABS_API_KEY** remain the three
  blockers that stop any video completing end to end.

### Phase 14 — 2026-10-30

Built: `src/lib/types/visual.ts` (the choice union, the stored shape, the prompt cache key),
`src/lib/visuals/select.ts` (which clip wins for a block), two new provider seams —
`src/lib/adapters/stock/` with a Pexels client and `src/lib/adapters/image/` with an image client,
both fenced on their credential by eslint like the ElevenLabs and Reddit seams —
`src/lib/script/visual-prompt.ts` + `visuals.ts` (the one shot-plan call),
`buildBlockVisualTracks` in `src/lib/generators/common.ts`, the branch in
`src/lib/generators/voiceover.ts`, `src/services/visuals.service.ts` (the chain, both caches, the
ingest), `src/inngest/functions/visual-ingest.ts`, the `visuals` stage in `project-generate.ts`, the
`aiImages` registry entry, `src/trpc/routers/visuals.ts`, and the global
`components/global/visual-picker/`. 62 new tests; the suite is 987 and green, `tsc --noEmit` and
`eslint` are clean, and `next build` succeeds — with the one Turbopack NFT warning about
`next.config.ts` that this repo already emitted before the phase.

**One migration, and it adds columns rather than tables.** `asset` gained `sourceProvider`,
`sourceId`, `attribution` and `promptHash`; `narration_line` gained `blockId`. All nullable, no
backfill. Grep `PROVENANCE_IS_NOT_OPTIONAL` and `LINE_REMEMBERS_ITS_BLOCK`.

**It touched shared code four times, and all four are the interesting part.**

- **`NarrationLine` remembers its block.** A per-block visual is timed to the words of its block,
  and `splitBlockIntoLines` turns one paragraph into several takes — so a block's span is the union
  of several lines' spans and nothing recorded which lines were whose. `splitScriptIntoLines` had
  carried a `blockId` on its drafts since Phase 06 and the persistence layer dropped it. The
  alternative was re-splitting the script in the context assembly and pairing by position: the same
  mapping computed twice from the same inputs, wrong the moment the split rule is tuned, with the
  symptom being pictures one paragraph out. Nullable with no foreign key, because a block may be
  deleted while its recorded audio is still good and a cascade would delete narration somebody paid
  to synthesise.
- **A video item may carry `props`.** `MediaClip` has read a `kenBurns` prop since Phase 03 with a
  note saying "a generator can set it today" — and it could not, because `videoItemSchema` is
  `.strict()`. An optional field in an existing object, so every stored document stays valid and no
  `docVersion` bump goes with it. It IS hashed, and there is a test in each direction: two builds of
  the same visuals hash alike, and turning a clip into a drifting still does not.
- **One function owns what is behind the words.** A backdrop sits on the scene track, which
  composites ABOVE video (`LAYER_ORDER`) — so a document carrying both a full-length backdrop and
  per-block clips draws a gradient over every picture, and the bug reads as "my visuals did not
  apply". `buildBlockVisualTracks` returns the clips AND the fallback over exactly the stretches
  they do not cover, which makes the overlap structurally impossible. The test asserts the invariant
  rather than the shape. Grep `ONE_FUNCTION_OWNS_WHAT_IS_BEHIND_THE_WORDS`.
- **`PROJECT_HOLD_REFS` gained `visuals`.** The stage holds against the images it plans and settles
  on the ones it produced; a cancel between those two points is precisely the window that tuple
  exists to cover.

**Two tests changed what the code does, which is the point of writing them.**

- **An unreported clip duration scored ZERO, which is not neutral — it is the worst possible
  score.** The rule claimed `UNKNOWN_IS_NOT_PENALISED` and did the opposite: a clip of unknown
  length lost to one measured as covering an eighth of the block, i.e. known to stutter seven times.
  It now scores half the weight of each term it cannot measure, which beats everything measured as
  worse and loses to everything measured as better. Grep `NEUTRAL_IS_THE_MIDDLE_NOT_ZERO`.
- **The shot plan was being paid for on deployments that could not use it.** With no stock search
  and no image budget every block falls through to the backdrop whatever a model proposes — and
  that is the state of every deployment that has configured neither key, which is also the state
  the phase requires to produce a complete video. The model is no longer asked. Grep
  `NO_PLAN_WITH_NOWHERE_TO_SPEND_IT`.

**The hardest decision in the phase: whether a fetched stock clip may render.** Both obvious
answers are wrong and the resolution is an operator switch, so it is written out in full on
`STOCK_REVIEW_ENGINE` in `src/inngest/functions/asset-ingest.ts`. The default posture
(`PIXELS_ARE_UNCHECKED`) holds a third party's file `pending` because nothing has looked at its
frames — applied to stock footage that makes the feature **dead**, since every clip is searched,
downloaded and transcoded and then withheld from the render anyway. Writing `approved`
unconditionally is the claim this codebase refuses everywhere else, and
`LIBRARY_IS_APPROVED_BY_REVIEW` is no precedent: that approval is earned by a person reading a
specific asset into a manifest, in a diff, and nobody reads a stock search result. So the claim
moved to the party who can make it: `STOCK_LIBRARY_PRE_CLEARED` defaults to **false**, and setting
it is the operator stating that their chosen provider's library is moderated before publication.
Each cleared clip's record names the setting as the basis, and it can only promote a `pending` to an
`approved` — a filename the classifier rejects is still rejected.

**Three findings about the phase file itself.**

- **`Asset.source` needed no new value.** The phase says it "gains two values already allowed by the
  Phase 02 union: `stock` and `ai_image`". `stock` was indeed already there; `ai_image` was not, and
  `generated` was — meaning the same thing and already carrying the open owner decision about
  commercial rights for generated media. A second value for one concept would make every "ours or
  somebody else's" query check two strings forever. The distinction lives on the CHOICE, which is
  where it is read.
- **The contract's three sources are four.** `resolveBlockVisual` is specified as returning
  `'stock' | 'ai_image' | 'background'`, and step 8 requires a customer to be able to upload their
  own for a block — which is none of the three. Folding it into `stock` would record a Pexels
  licence against a customer's own file, exactly the unverifiable provenance the rest of the phase
  exists to prevent. The automatic chain still only ever produces the phase's three. Grep
  `UPLOAD_IS_A_FOURTH_SOURCE`.
- **The `storyboard` stage still does not fill in.** The voiceover generator's Phase 09 note
  predicted this phase would need it, and the quiz's note already disagreed for the same reason: a
  voiceover is now multi-shot, but its shot order is entirely determined by the block order, so the
  stage would be a progress row for an arithmetic step. `visuals` is the stage that filled in, as
  that same note predicted.

**Done-when checks:**

- [x] A five-block script produces five matching visuals, each timed to its own block — the
      DOCUMENT does, and the test asserts the times rather than the count, because five clips at
      zero would pass a count. **No real clip has ever been fetched**, for the STOCK_API_KEY reason
      below.
- [x] With both providers disabled, the video still completes on the styled background — this is
      the only arm that has actually run, and it is tested as the same code path with different
      inputs rather than as a special case.
- [x] Every stock and generated asset carries its provider, source id and licence — structurally:
      the choice union cannot be constructed without them, which is tested as three separate
      refusals.
- [x] A generated image records its prompt and `modelVersion` — and the version is the one the
      provider SERVED rather than the one we asked for, which is what "which model drew this"
      means. **Unverified against a real model.**
- [x] Re-running with an identical prompt makes no second model call — the cache is checked before
      the generation inside `ingestBlockVisual`, and the key's normalisation is tested in both
      directions (a constant-returning hash would pass only one).
- [x] A free workspace is refused image generation with the upgrade modal, and the server refuses
      it too — the `free` cap is a real `0` rather than a missing feature, the stage's budget is the
      lower of the quota and the balance, and `setBlockVisual` re-checks both.
- [x] Swapping one block's visual leaves the other blocks untouched — enforced in three places by
      construction: the input names one `blockId`, `upsertBlockVisual` replaces one entry, and the
      ingest is one run per block with its own failure handler.
- [x] No timeline item references a provider URL directly — structural: `ResolvedBlockVisual`
      carries an `assetId` and nothing hotlinkable, so a generator has no URL to reach for.

**Also outstanding:**

- **No clip has been fetched and no image generated.** `STOCK_API_KEY` and `IMAGE_API_KEY` are both
  unset, so the stock client, the image client and the whole ingest half are unexercised against a
  real provider. The chain's unconfigured arm is what runs today. The Pexels response mapping and
  the rendition choice are the first things to check once a key exists — the response shape is
  parsed with zod rather than indexed, so a changed API is a readable refusal, but nobody has seen
  the real shape.
- **No model has written a shot plan yet.** The two kinds of writing the prompt asks for — keywords
  for a search, prose for an image — are the thing most likely to come back wrong, and the failure
  is SILENT: a model that writes beautiful queries returns no results, which looks exactly like a
  library with nothing in it. The prompt's worked example is reasoned rather than observed.
- **A Ken Burns drift has never been looked at.** The arithmetic is Phase 03's and is a pure
  function of the frame; whether 8% over a four-second block reads as motion or as a creep is a
  judgement nobody has checked on a phone.
- **No visual moderation of the pixels, for stock or for uploads.** Unchanged from Phase 10 and
  still a launch blocker; this phase adds the operator switch described above rather than solving
  it. A generated image is `skipped` because its PROMPT was classified under the stricter standard
  before the model ran — that is a defensible floor, not a vision classifier.
- **Phase 02's R2**, **Phase 04's AWS deploy** and the **ELEVENLABS_API_KEY** remain the three
  blockers that stop any video completing end to end, and the **music and sfx licence category**
  (grep `MUSIC_LICENCE_IS_NOT_RESOLVED_YET`) and the **commercial-rights position on generated
  media** remain open owner decisions.

### Phase 15 — 2026-10-30

Built: `src/lib/timeline/session.ts` (the editor's whole state machine as pure functions — the undo
and redo stacks, the unsaved queue, the rebase onto a confirmed save), two new ops in
`src/lib/timeline/ops.ts`, `src/lib/types/timeline.ts` (the inputs, the save-result union and the
inspector's forms), `src/services/timeline.service.ts` (the compare-and-set save and the snapshot
trail), `src/trpc/routers/timeline.ts` mounted as `timelineEditor`, the `timelineEditor` registry
entry, the branch in `projects.generate`, one migration adding `timeline_revision`, the editor
itself under `dashboard/projects/[id]/edit/_components/` (the shell, the hook, the five-lane tracks
panel, the inspector, the word-timing panel, the overlay drag layer, the delete dialog, the
add-media control), and two components promoted to global — `components/global/render-panel/`
(moved out of the preview route, because the editor ends in the same "export this") and
`components/global/asset-picker/` (the picker the assets router's own notes have called "the
editor's asset picker in Phase 15" since Phase 02). 38 new tests; the suite is 1025 and green,
`tsc --noEmit` and `eslint` are clean, and `next build` succeeds with only the Turbopack NFT
warning about `next.config.ts` that this repo already emitted before the phase.

**One migration, and it adds one table.** `timeline_revision` exactly as the phase file specifies
it, with the unique on `(projectId, revision)` — which is not decoration but the second half of the
concurrency check. Grep `SNAPSHOTS_NOT_AN_EVENT_LOG`.

**What is verified, and what is only built.** The browser-equals-server claim, the undo hash and the
op refusals are asserted directly: `session.test.ts` runs the editor's path and the server's path
over one fixture and compares the hashes, and the undo check is the phase's own wording — `hashDoc`
before and after, which is the same function Phase 04 uses to decide a render can be reused, so a
document that hashes equal is one that renders identically. The conflict path, the branch on
regenerate and the snapshot prune are **built but never exercised against a live database**: Neon
has been unreachable since Phase 05, so no revision row has ever been written. Scrubbing a
three-minute project on proxies is **untested** for the same R2 reason every other phase cites — no
proxy variant has ever been produced. Editing a narration line enqueues `line/changed`, which is
Phase 07's workflow and still **blocked on an ELEVENLABS_API_KEY**, so no line has ever been
re-recorded from the editor.

**Four additions to shared code, and the first two are the phase's real design question.**

- **`restoreDoc` — a whole-document op.** The phase says operations only, and two features cannot be
  expressed as a forward edit: undoing past an autosave, and restoring a snapshot. The undo stack
  holds DOCUMENTS rather than inverse ops because `split` and `delete` have no faithful inverse — an
  inverted delete has to invent the item's array position, and array position is what decides which
  of two clips draws on top. So once the autosave has already sent the ops being undone, there is
  nothing left to send but the document. It does not weaken what ops exist for: `apply()` is still
  the single implementation, the server still runs it on the same input, the result is still
  re-validated as a whole, and the revision compare still happens before any op runs — so a restore
  cannot overwrite another tab's work any more than a trim can. Grep
  `WHOLE_DOCUMENT_IS_STILL_AN_OP` and `UNDO_PAST_THE_SAVE`.
- **`setWordTiming` — the word-level nudge.** A word is not an item: no id, it lives in `doc.words`,
  and the captions over it derive their timing from it. `trim` on a caption is refused for exactly
  that reason (`CAPTIONS_FOLLOW_WORDS`), and this is the thing somebody actually wanted when they
  tried it. It refuses rather than clamps when a nudge would cross a neighbouring word, because the
  alternative is a token order that disagrees with the audio and nothing downstream would report it.
  Grep `NEIGHBOURS_ARE_THE_BOUNDS`.
- **`addItem` registers its own asset handle.** An item naming a `doc.assets` handle the document has
  never heard of fails validate()'s `UNKNOWN_ASSET` rule — so inserting from the media library was
  impossible without it. Part of the same op rather than an op of its own because the two halves are
  one intent, neither is valid alone, and `ATOMIC_PER_OP` would otherwise let the item land while
  the handle was refused. Re-pointing an existing handle is refused: the handle is shared, and
  moving it would silently change which media every other item using it plays. Grep
  `ADD_REGISTERS_ITS_ASSET`.
- **`itemPatchSchema` gained `startWord` and `endWord`.** This is the phase's "regroup words", and
  the contrast with the fields that are still absent is the point: `start` and `duration` remain off
  the patch, because a caption's RANGE is its position and setting a time that contradicts the range
  is precisely what validate() calls `STALE_RESOLUTION`. Every op that moves a word or a boundary now
  DROPS the cached pair rather than recomputing it, so `resolveWordAnchors` stays the only code that
  turns a word range into seconds. Grep `REGROUP_BY_RANGE` and `CACHE_IS_DROPPED_NOT_RECOMPUTED`.

**The save result has three statuses, not the contract's two** — `applied | conflict | rejected`.
`apply()` returns a document even when the result breaks an invariant, because the editor needs
something to render; the SERVER must not store that, or the customer ends up with a project the
render pre-flight refuses and no obvious way back. A rejected save leaves the stored document
untouched, returns the reasons, and the editor keeps the broken state on screen so it can be fixed
or undone. Silently reverting the screen instead would read as a gesture that never registered. Grep
`AN_INVALID_DOCUMENT_IS_NOT_STORED`.

**The editor reads through its own procedure rather than `projects.preview`.** The phase requires
that a free workspace cannot reach the editor "server-side included", and preview is a read every
plan is entitled to — routing the editor through it would leave the screen's data ungated. Mounting
the router under the registry key `timelineEditor` means the procedure factory's flag gate refuses
every verb including the read, so `free: false` in one registry entry is the whole of the
enforcement and there is no per-procedure check to forget. Grep `GATE_IS_THE_WHOLE_ROUTER`.

**Two procedures beyond the phase's contract, both earned by its own sentences.**
`timelineEditor.revisions` and `timelineEditor.restore` exist because the phase asks snapshots to be
"enough to recover from a bad autosave", and a table nothing can read is not a recovery point. The
restore goes through `apply()` carrying one `restoreDoc` rather than writing the jsonb back, so it is
validated and revision-checked like any other edit, and it writes a NEW revision — history is
appended to, never rewound, which is what lets a restore itself be undone. Grep
`HISTORY_IS_APPENDED_NOT_REWOUND`.

**The regeneration policy is now enforced where it is reachable.** `projects.generate` branches when
`manualEdited` is true: a new `Project` with `parentId`, the document copied, the run pointed at the
branch, and the edited version untouched down to its revision. It takes the same explicit plan-cap
check `duplicate` does, for the same reason — the factory's automatic cap fires on the path segment
`create` and nothing else, so without it a workspace at its limit would branch past the cap and
leave the counter one short of reality. The screen follows the run to the new project and says why,
because a silent navigation to a differently-titled project reads as a bug. Grep
`EXPLICIT_GATE_ON_A_BRANCH`.

**One thing the phase lists that is deliberately narrower.** "Drag to reorder" within a lane is two
buttons — send back, bring forward — rather than a draggable list. Both produce the same `reorder`
op, moving one step is the whole of what the gesture is for, and a drag-to-reorder list would be a
second way to express an op that already has one. Said plainly rather than ticked silently.

**Three findings about the phase file itself.**

- **The contract contradicts itself on conflicts.** It specifies a status union and then says the
  mutation "returns `{ doc, revision }` or throws CONFLICT". The union is right and the throw is
  wrong: a thrown CONFLICT is indistinguishable from a network failure at the call site, and losing
  an edit silently is the one thing the phase forbids.
- **The undo requirement and the ops-only requirement are in tension, and the phase does not say
  so.** "Undo/redo in memory, 50 operations" plus "saving posts operations, not documents" plus a
  debounced autosave means undo reaches back past the last save almost immediately. That is what
  `restoreDoc` is for; a reading that forbade it would cap undo at the debounce interval, which is
  not an editor anybody would use.
- **The registry snippet omits the rate limit.** `applyOps` is driven by a debounced autosave rather
  than a button, which is a completely different shape from every other mutation in the app — sized
  here at roughly one save every two seconds for five solid minutes, because tighter throttles a
  productive session mid-edit and looser lets a stuck retry loop write a snapshot row per request.
  Grep `AUTOSAVE_SETS_THE_RATE`.

### Phase 16a — 2026-10-31

Built: `src/lib/types/scene.ts` (the whole scene vocabulary — five layouts, ten primitives, the
animation set, the text-role size table, the slot rules, the error codes, `Beat` and `BeatIntent`),
`src/lib/scene/metrics-data.ts` (generated glyph advances), `src/lib/scene/measure.ts`,
`src/lib/scene/runs.ts`, `src/lib/scene/layouts.ts`, `src/lib/scene/flow.ts`,
`src/lib/scene/check.ts`, `src/lib/scene/document.ts` and the barrel. One new dependency,
`@dagrejs/dagre`, approved before adding as the phase file requires. 82 new tests; the suite is
1107 and green, `tsc --noEmit` and `eslint` are clean. **No migration and no registry entry** — 16a
touches no database and no gate, and `motionStudio`/`motionVideos` belong with 16d, which is the
first commit that can spend a credit.

**The scene language is strict and the document stays loose.** `sceneSpecSchema` in
`timeline/schema.ts` goes on carrying `layout: string` and open `props`, because it also carries
quiz and Reddit cards; `src/lib/scene/document.ts` is the seam where a stored scene becomes a known
one. The same relationship `src/lib/quiz/import.ts` has with a quiz card, and the same
`ONE_SHAPE_TWO_INPUTS` consequence: a hand-written gallery scene and a model's output are
indistinguishable after `parseScene`. Grep `THE_DOCUMENT_IS_THE_LOOSE_FORM` and
`PROPS_CARRY_THE_STRICT_ELEMENT`.

**The measurement is real, and the provenance is checkable rather than asserted.** The advances were
extracted from `@fontsource/geist-sans`'s `.woff` files at the pinned version; those are the same
release whose `.woff2` siblings are the files in `public/fonts`, **byte-identical by md5**, so the
table describes the face that actually renders. A committed table rather than a runtime measurement
because the same check has to run in the browser editor, in Vitest with no DOM, and on the Inngest
worker — `canvas.measureText` exists in one of those three, and an answer that differs between them
is an editor warning that disagrees with a server refusal. Grep `REAL_ADVANCES_NOT_AN_ESTIMATE` and
`METRICS_ARE_GENERATED_DATA`.

**One honest gap in that measurement, stated with its direction.** Geist carries GPOS kerning and
the table does not, so a measured width is at or above the true width and never below. A false
overflow costs one repair attempt; a missed one costs a video with text off the frame. Grep
`ADVANCE_SUM_IS_AN_UPPER_BOUND` — the same asymmetry argument decides the overlap check's treatment
of unresolved anchors (`UNRESOLVED_IS_TREATED_AS_OVERLAPPING`).

**Four decisions beyond the phase file's wording, each earned by its own sentences.**

- **Word anchors here are INDICES only**, not the document's `{ word: 'revenue' }` form. A word
  string is ambiguous in any transcript where the word repeats, and it is not checkable from a pure
  module that holds a word COUNT rather than the transcript — so it would fail at render time
  instead of design time, which is the trade the whole phase is arranged to avoid. Nothing is lost:
  the designer is handed `Beat.startWord` as an index already. The narrowing is proved to be a
  narrowing by a compile-time function, not a comment. Grep `ANCHORS_ARE_INDICES_HERE`.
- **Overlap is checked on INK, not on slots.** Named layouts place slots that do not touch, so
  comparing slots would be theatre that always passes. The check compares the rectangle each wrapped
  text block actually occupies, which is why an overflow and an overlap usually fire together — the
  second is the consequence of the first. Grep `OVERLAP_IS_CHECKED_ON_INK`.
- **Two elements that are never on screen together are not an overlap.** Sequencing elements through
  one region is normal design for a six-second beat, and refusing it would make the engine reject
  good work. Grep `DISJOINT_IN_TIME_IS_NOT_AN_OVERLAP`.
- **Auto-fit has a floor, and below it the element still renders.** Long copy is shrunk toward the
  role's `minSizeVh` because that is what a designer does; past it the run keeps the floor size,
  draws, and reports `TEXT_OVERFLOW`. Both halves are deliberate — the pipeline always finishes AND
  the defect is reported, rather than a beat that is technically in bounds and unreadable. Grep
  `AUTO_FIT_HAS_A_FLOOR`.

**Dagre, not elkjs, and the reason is the call signature.** `dagre.layout()` is synchronous, and the
geometry has to be computed inside `checkScene` (a pure function the editor calls while typing),
inside a Remotion component's render pass (synchronous by construction) and on the worker. elkjs is
Promise-based, which would have put an async seam through all three and made the component render a
frame before it knew where anything goes — in Remotion that is a frame of the wrong picture
composited into a paid video. Grep `DAGRE_IS_SYNCHRONOUS`.

**Two shared things changed rather than copied.**

- **`purity.test.ts` moved up to `src/lib/`** and now guards both `timeline/` and `scene/` from one
  table. The scene engine makes the same isomorphism claim the timeline module does, and copying the
  file would have left two lists of forbidden imports that did not stay in step. Its textual import
  scanner also had to be tightened: it could not tell the `from` keyword from the word `from` in a
  string literal, which `check.ts` contains. Grep `ONE_PURITY_CONTRACT`.
- **The safe zone is Phase 08's**, called through `captionBox` rather than read a second time from
  `SAFE_ZONE_INSETS`. The phase file asks for this and the reason is concrete: two implementations
  of "where TikTok's button rail is" means a caption and a motion element that disagree about the
  bottom of the frame in the same video. Grep `SAFE_ZONE_IS_SHARED`.

**The committed motion fixture was rewritten, deliberately.** It has carried `figure-left`,
`bigStat` and `headline` since Phase 01 — names nothing ever implemented — and it now speaks the
real vocabulary, with a test asserting every beat parses and checks clean. It is used only by tests,
so no stored document changes. Grep `FIXTURE_SPEAKS_THE_SCENE_LANGUAGE`.

**Two things 16c cannot do as written, and neither is a code gap.**

- **A style needs two fonts and only one family is bundled.** `public/fonts` holds Geist at 400 and
  700 — one family, two weights — so 16c's "code validates that both fonts are actually bundled" has
  a single candidate to validate against, and "palette, two fonts" cannot be honoured without
  somebody choosing and licensing a second family. The validation itself will be written; the
  library of 6–10 styles cannot be visually distinct on typography until that choice is made. This
  is the same shape of gap as Phase 11's empty catalogue: the mechanism is buildable, the content is
  an owner decision.
- **`SPLIT_ALONG_THE_LONG_AXIS` is a design decision worth re-reading before 16b.** `split-2` and
  `grid-3` divide the LONGER side of the safe rectangle, so they are columns on 16:9 and rows on
  9:16. Two 500px columns of a 1080-wide frame are unusable, and a project's canvas is chosen per
  video while the designer is not re-run per aspect — but it does mean a scene reads differently at
  the two aspects, which the gallery should be looked at for.

**What is NOT verified.** Nothing has been rendered. No primitive component exists, so no scene has
ever been drawn — the geometry is asserted numerically and by the safe-zone matrix across every
layout, both aspects and all four platform zones, and that is the strongest claim available before
16b. The phase's "every primitive and layout renders in the gallery, reviewed by a human", "renders
to MP4", "across 20 test videos" and every metering line remain untouched. `GAP_VH`, the 62/38
hero split and the role size table are **unreviewed design numbers**: they are data in one table
precisely so the gallery can change them without touching code.

### Phase 16b — 2026-10-31

Built: ten primitive components under `src/remotion/components/motion-scene/`
(`text.tsx` — Title, KineticText, Callout; `numbers.tsx` — Counter, Meter, BarChart;
`structure.tsx` — Compare, List, Icon; `flow-graph.tsx` — FlowGraph), the shared
`text-block.tsx`, `animation.tsx`, `icons.tsx`, `util.ts`, the `canvas.tsx` family and the
`index.tsx` Remotion driver; `src/lib/palettes/tones.ts`; `src/lib/scene/anchors.ts` and
`src/lib/scene/gallery.ts`; `src/components/global/motion-preview/`; the gallery route at
`/dashboard/projects/[id]/motion` with its row-menu entry. `motion → MotionScene` is registered in
`src/remotion/registry.ts`, which now has a component for every `RenderKind`. 118 new tests; the
suite is 1225 and green, `tsc --noEmit` and `eslint` are clean. **No migration, no registry entry,
nothing metered** — 16b touches no database and no gate, and `motionStudio`/`motionVideos` belong
with 16d, the first commit that can spend a credit.

**One registry entry, ten primitives.** `motion` is one `RenderKind`, so it is one key in
`RENDER_COMPONENTS`; the primitives are the family's own dispatch through `MOTION_PRIMITIVES`. That
map is a FULL `Record` rather than the `Partial` the render registry uses, and the asymmetry is
deliberate: an unimplemented render kind is a documented gap because a document written by a newer
release must degrade, while a primitive comes from this app's own closed `SCENE_PRIMITIVES` and a
missing one is a bug nobody should be able to ship. Grep `ONE_FAMILY_TEN_PRIMITIVES`.

**Time is a prop, which is the decision the whole commit turns on.** No primitive calls
`useCurrentFrame`. `MotionSceneCanvas` takes `seconds` and `MotionScene` — the only file in the
folder that imports `remotion` — is a nine-line driver that reads the frame and divides by fps. The
reason is the gallery: the captions gallery already established that a review surface must mount
the REAL component (`PREVIEW_IS_THE_RENDER`), and a primitive that read the frame itself would only
work inside a Remotion context, so a dozen cards would mean a dozen Players. With time as a prop the
gallery drives the same components from one `requestAnimationFrame` loop. It also keeps every
drawing component free of the `remotion` package, which is the gap `CAPTIONS_STAY_PURE` describes.
The price is eight lines of cubic easing written here instead of `interpolate` — the one deliberate
duplication in the folder, and a cubic ease is not a thing that can be got subtly wrong. Grep
`TIME_IS_A_PROP`.

**`RenderItemProps` gained `style`, and that fixed an existing workaround rather than adding one.**
A scene family that needs the palette had no way to reach it: the walker hands a component its
ITEM, and `sceneItemSchema` is `.strict()` with nowhere to put a document-level value. Phase 13's
quiz card worked around that by having its GENERATOR copy `paletteId` and `safeZone` down into an
element's `props`, so the two values exist in as many copies as there are scenes and a restyle has
to rewrite every one. Motion needs both on every beat, so copying that ten more times was the moment
to put the document's `style` in the shared contract instead. Purely additive — every existing
component ignores it and the quiz card's own path still works. Grep
`STYLE_IS_PART_OF_THE_CONTRACT`.

**`LayoutContext` was split in two, because the component proved it was carrying two concerns.** The
renderer lays a scene out every frame and genuinely does not know the word count — the walker passes
no transcript. With one combined context it would have had to invent `wordCount: 0`, which is a
false statement in a type. `LayoutContext` is now what the LAYOUT uses and `SceneCheckContext`
extends it with what the CHECKS need. Grep `CHECKING_NEEDS_MORE_THAN_LAYOUT`.

**Every text run is drawn by one component, and that is what keeps 16a's measurement honest.**
`TextBlock` emits the PRE-WRAPPED lines with `white-space: nowrap`, so the browser is never asked
where to break. Handed the whole string with `overflow-wrap` on, Chrome would wrap by its own rules
— which agree with the measurement almost always, and "almost" is the failure, because the beats
where they disagree are exactly the long ones the check exists for. Overflow is deliberately NOT
clipped: in the gallery the defect has to be visible. Grep `EVERY_TEXT_GOES_THROUGH_HERE` and
`NO_BROWSER_WRAPPING`.

**Animations may only touch opacity, transform and clip-path, and a test enforces it.** If an
entrance could change a layout rectangle, the overflow and overlap checks would describe the element
at rest while the video showed it elsewhere — the exact gap this phase closes. The test reads every
one of the eight movements at three progress points and fails on any other CSS property. Grep
`ANIMATION_NEVER_MOVES_THE_INK`.

**Tone colours are data with a contrast test, and the test immediately earned itself.** A scene says
`tone: 'negative'` and never a hex, because a model cannot run a contrast check. `toneColor` resolves
meaning against the palette — `neutral` is the palette's own `text`, so there is no sixth near-white.
The first `negative` value failed at 3.39 against `warm`, whose background is itself a deep red; one
step lighter measures 4.94 and passes. That margin is thin enough that a sixth palette could push it
under, which is what the test is for. Grep `TONE_IS_MEANING_NOT_COLOUR` and
`TONE_CONTRAST_IS_TESTED`.

**Icons are twelve inline SVG paths, not the icon package the app chrome uses.** A React icon
component is one more module that has to resolve inside the Remotion bundle and one more thing that
can render as an empty box without failing the render — and a beat whose only element is a missing
icon is a blank frame in a paid video. Twelve `d` attributes have no resolution step and no version
to drift. Grep `INLINE_SVG_NOT_AN_ICON_PACKAGE`.

**The gallery found two real defects in its own fixtures, which is the point of having it.**

- A list item reading "Replaced the welcome tour with a single working example they could copy"
  measured **31px past its row**. Shortening it twice still missed, by 7px and then 2px, and only
  inside TikTok's, Reels' and Shorts' insets — it fit a 9:16 frame with no safe zone throughout. The
  honest answer was not a shorter string but a smaller list: **`stack-center` holds three list items
  plus a heading in a vertical frame, not four.** That is a fact about this engine's role sizes worth
  knowing before the designer starts writing lists in 16d, and it is the kind of thing a reviewer
  would have nodded past. Grep `THREE_ITEMS_IS_WHAT_FITS`.
- The short-window animation scaling was off by nothing visible and wrong in principle: an element
  on screen for 0.4s reaches full presence at exactly ONE instant, where the scaled entrance ends
  and the scaled exit begins. The test now samples finely enough to find it. Unscaled, the two would
  cross at roughly 0.55 and the element would read as a flicker.

**Anchor resolution exists but nothing calls it yet, and that is a deliberate seam.**
`resolveSceneAnchors` converts a scene's word anchors to beat-relative seconds, and it is the
generator's job to call it — which is 16d. Until then a stored scene could in principle still carry
an anchor at render time, and `elementWindowSeconds` handles that by showing the element for the
WHOLE BEAT with one warning per process. Drawing it beats drawing nothing: the content is right and
only its timing is wrong, where the alternative is a hole in a frame the customer paid for. The
fallback is tested, and the gallery's fixtures are all timed in seconds — asserted, not assumed.
Grep `RESOLVE_BEFORE_STORING` and `AN_UNRESOLVED_ANCHOR_SHOWS_THE_WHOLE_BEAT`.

**`MotionPreview` is global, not route-local.** In `components/global/motion-preview/` because Phase
15's editor inspects scene items and will want exactly this card — the same promotion
`caption-preview` and `render-panel` already went through. It takes a scene, a canvas and a palette
id and knows nothing about the gallery.

**What is NOT verified, and the one check only a human can make.** The phase's first Done-when line
is "every primitive and layout renders in the gallery, in every palette, reviewed by a human" — the
gallery exists, covers every primitive, every layout and all eight named animations (each asserted
by a test, so an eleventh primitive cannot skip review), and runs `checkScene` live for the chosen
aspect, palette and safe zone with the errors printed on the card. **Nobody has looked at it yet.**
That review is the remaining half of 16b and it cannot be delegated to a test.

Also still untouched: nothing has been rendered to MP4 — the Remotion path is wired and
`next build` succeeds, but a motion document has never been composited, which needs Phase 02's R2
and Phase 04's AWS deploy like everything else. "Across 20 test videos", the 60-second timing
budget, the metering lines and the vision pass all belong to 16c/16d. `GAP_VH`, the 62/38 hero
split, the role size table and the new animation durations remain **unreviewed design numbers**,
which is exactly what the gallery is for.

### Phase 16c — 2026-10-31

Built: `src/lib/types/motion-style.ts` (the seven tokens, the scale tables, the proposal shape and
the rejection codes), `src/lib/motion-styles/` (`define.ts`, `library.ts` with eight styles,
`validate.ts`, the barrel), `src/lib/script/motion-style.ts` and `motion-style-prompt.ts` (the model
call), `src/trpc/routers/motion.ts` mounted as `motionStudio`, the `motionStudio` registry entry,
`style.motionStyleId` on the timeline document, and the gallery's style switcher plus a
`DesignStylePanel`. The tokens are wired through every primitive. 45 new tests; the suite is 1270
and green, `tsc --noEmit` and `eslint src` are clean. **No migration** — the one new document field
is optional and falls back, so every stored document is still valid.

**Tokens must change the picture, which is most of the work.** The phase file lists seven tokens and
the easy version of 16c is seven fields nothing reads. So each one has a consumer: `paletteId` on
every primitive, `fonts` through each text role's new `fontSlot`, `radius` on the graph nodes and the
meter and bar tracks, `strokeWeight` on the graph edges, the node borders, the meter track and the
callout rule, `motionPersonality` on the animation shell's durations AND its easing curve,
`captionTreatment` as an id from Phase 08's library, and `musicMood` as the durable half of a choice
Phase 11 cannot yet honour. Grep `TOKENS_MUST_CHANGE_THE_PICTURE`.

**A token is a choice, not a number.** `radius` is `square | soft | round`, not a pixel value;
`strokeWeight` is `hairline | regular | bold`, not a float. A model proposing `radius: 400`
type-checks and draws a flow-graph node as a circle with the label outside it — a closed union
cannot be out of range. The pixel value depends on the canvas and on what it is applied to, so it
lives in the scale tables and the arithmetic lives once in `util.ts`. Grep
`A_TOKEN_IS_A_CHOICE_NOT_A_NUMBER`.

**The style had to go in the document, and that is the finding worth reading.** It would have been
natural to keep it in `Project.settings` with the storyboard. That would have been a bug: Phase 04
decides a paid render can be REUSED by hashing the document, so a style stored outside the document
means switching from `Boardroom` to `Launch` produces an identical hash, the cache serves the old
video, and the customer's restyle silently does nothing. Anything that changes the picture has to be
inside the thing that gets hashed. `style.motionStyleId` is optional and unknown ids fall back, so
there is nothing to migrate. Grep `STYLE_BELONGS_IN_THE_DOCUMENT`.

**Applying a style writes the palette.** A motion style NAMES a palette, and the document already
has `style.paletteId` which every format and the backdrop read. Rather than leave two sources of
colour, applying a style copies its palette into that field — so `paletteId` stays the single answer
to "what colour is this video" and `motionStyleId` answers the narrower "which motion style", which
is what the renderer needs for radius, stroke, fonts and personality. Grep
`APPLYING_A_STYLE_WRITES_THE_PALETTE`.

**"Code validates" is five checks, and the phase file explains why one of them matters most.** The
model proposes, `motionStyleProposalSchema` proves the shape, and `checkMotionStyle` proves what a
schema cannot: the palette exists, the caption treatment is real, `minPlan` is a real plan, the
palette's text is legible on its own gradient, and **both fonts resolve to a bundled family**. That
last one is the only check whose absence produces no signal at all — the phase file's own words are
"renders as a fallback and silently ruins the video". No error, no failed render, no complaint, just
a finished video in the wrong typeface that somebody paid for. Grep
`FONT_NOT_BUNDLED_IS_THE_SILENT_ONE`.

The contrast measurement is `contrastRatio` against `CONTRAST_TEXT_MIN` — the same function and
threshold the caption library measures its thirty-eight styles with and `palettes.test.ts` uses. A
second luminance calculation would be a second answer to a question this codebase answered once.
Grep `ONE_CONTRAST_RULE`.

**One contrast check is new to this phase and found a real pairing failure.** A caption style is
measured against `REFERENCE_BACKGROUNDS` in its own library, never against the palette a motion
style happens to pair it with — that pairing did not exist before 16c. `bold-ink` is the one style
in the thirty-eight with a dark fill (`#101010`), and on `noir` it measures **1.04:1**. "An inky look
on a black background" is a plausible thing to ask a model for, and this is the refusal that stops
it shipping. A second test records that `bold-ink` is currently pairable with NO palette, because all
five are dark — a fact about the palette set rather than a bug, and the test is what will notice when
a light palette makes the pairing legal.

**The catalogue in the prompt is generated from the same constants the validator reads.** Every list
the model is shown — palettes, caption treatments, radii, strokes, personalities, moods — is built at
call time. A hand-written list is how a model ends up offered a palette that was renamed last month,
proposing it, and being refused by a validator reading the real list: a failure the customer sees
and nobody can explain, with the prompt and the validator both looking correct in isolation. Grep
`THE_CATALOGUE_IS_GENERATED`.

**The model is told it is choosing from a menu, and the schema makes that true.** No hex, no font
family, no pixel radius, no duration. It is the style-level form of
`THE_MODEL_NEVER_EMITS_COORDINATES`, and it is why "Impact" never becomes a `MotionStyle` — the
closed union refuses it one level before the validator. Grep `NO_COLOURS_NO_FONTS`.

**Three decisions beyond the phase file's wording.**

- **The id is minted by code, not proposed.** A model-chosen id could collide with a library style
  and silently replace it on a screen listing both. Every designed id carries a `designed-` prefix,
  and a name of only punctuation falls back to a fixed suffix rather than producing a bare prefix —
  which would itself collide with the next such style. Grep `ID_IS_MINTED_BY_CODE`.
- **`minPlan` is set by us, not proposed.** What a style costs is a commercial decision; a model
  choosing `free` would be inventing pricing.
- **`MotionPreview` takes a resolved style, not an id.** This was a bug I wrote and then caught: a
  designed style is not in the library, so `getMotionStyle` would fall back to the default for it
  and the preview would show the DEFAULT's radius, stroke and motion personality under the designed
  style's name. Every token would have been wrong and nothing would have said so. Grep
  `A_RESOLVED_STYLE_NOT_AN_ID`.

**`motionVideos` is deliberately absent from the registry.** The phase file specifies it alongside
`motionStudio`, but 16c ships a style library and a designer for a STYLE — neither produces a video,
and a limit that nothing decrements reads as a feature somebody forgot to wire. It arrives with 16d,
the first commit that can render one. The `motionStudio` FLAG is here, because `designStyle` spends
a model request and `GATE_IS_THE_WHOLE_ROUTER` is what stops a workspace without the feature
reaching it by calling the procedure directly. Grep `METERING_COMES_WITH_THE_DESIGNER`.

**The designer is tested without mocking a model, because nothing in this repo does.** The
convention every model-calling module follows is that its pure halves are what get tested, so
`mintStyleId` and `styleFromProposal` are exported for their test and the assertions are the ones
that decide whether the designer is safe: the minting cannot collide, a valid proposal passes
validation, and an invented palette or caption treatment FAILS it. The retry loop is four lines of
control flow over those facts. No new mocking pattern was introduced.

**What is NOT verified.** `designMotionStyle` has **never run against Claude** — no style has been
designed, so the prompt's quality, the one-retry repair and the `UNPROCESSABLE_CONTENT` path are
built and unexercised. Phase 06 proved this adapter works against the real provider, so the seam is
not the risk; the prompt is. Nothing has been applied to a project either, and that is by design:
`DESIGNED_IS_PREVIEWED_NOT_SAVED` until 16d, because the field it would write only matters once a
motion document exists.

**And the two gaps carried forward are the same two.** The gallery's **human review still has not
happened** — it now has a style switcher and a designed-style preview on top of what 16b shipped,
which makes it more worth doing, not less. And **only one font family is bundled**, so `fonts.display`
and `fonts.body` both resolve to Geist: the validation the phase asks for is real and runs, but it
currently has a single candidate to validate against, and no two styles in the library can differ
typographically. Licensing a second face is a woff2, a `FACES` entry, a key in `CAPTION_FONT_KEYS`
and its family mapping — in that order, so a weight can never be measurable but unrenderable. Grep
`TWO_FONTS_ONE_FAMILY`.
