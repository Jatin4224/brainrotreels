# Build progress

Tick a phase and add a dated note — what was built, and anything deferred — when its "Done when"
checks pass. If a check was deferred rather than met, say so explicitly; a tick that is not true is
worse than an empty box.

- [x] Phase 00: Foundations and seams — 2026-10-18
- [x] Phase 01: Timeline document — all checks met; verified end to end 2026-10-19.
- [ ] Phase 02: Media assets and storage — built; **blocked on R2 credentials** for the ingest
      round-trip. See the note below for exactly which checks are met and which are untested.
- [ ] Phase 03: Render core
- [ ] Phase 04: Cloud rendering
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
