# Phase 11 — Backgrounds library

**Depends on:** Phases 02, 09.

## Decision needed from the owner first

**Settle the gameplay-footage licensing position before seeding anything.** `architecture.md` names
this the largest non-technical risk in the product, and it cannot be resolved in code.

Footage from commercial games is copyrighted, and redistributing it inside videos your users then
monetise is not covered by the fact that everyone on TikTok does it. The three defensible positions
are: footage recorded yourself under a specific game's content policy, commissioned original loops,
or licensed abstract and "satisfying" loops whose licence explicitly permits end-user publication
and monetisation.

**Until this is settled, seed only abstract or self-recorded loops.** Build everything else in this
phase — the gating, the picker, the licence column, the looping — and leave the catalogue thin. The
mechanism is not the risk; the content is.

## Goal

Users pick a library background or their own upload, and it reaches the timeline already vertical,
loop-ready and licence-tagged.

## Registry

```ts
backgroundLibrary: {
  name: 'Background library',
  description: 'The curated background catalogue',
  permissions: ['read'],
  limit: {
    perPlan: { free: 10, starter: 100, pro: 'unlimited', enterprise: 'unlimited', portal: 'unlimited' },
    upgradeMessage: 'Upgrade to {nextPlan} for the full background library',
    availableOnFreeTrial: true,
    unit: 'backgrounds',
  },
}
```

This limit gates **catalogue breadth**, not a counter — how many of the library a plan can see. It
has no `create` path, so nothing auto-increments; the picker filters by it at read time.

## Data

No new models. `Asset` already carries what this needs: `source: 'library'`, `minPlan`, `license`,
`durationSec`, and `organizationId: null` for shared rows.

Add to `Project.settings` (not a column): the last background chosen, so the next project in the
workspace can default to it.

## Build

1. **A seed manifest** — `src/lib/library/backgrounds.manifest.ts` listing each background with its
   source, `minPlan`, and **a real licence string**, not `"owned"` by default. Every row must be
   able to answer "where did this come from and what does its licence permit".
2. **An ingest path for library assets** reusing the Phase 02 `asset.ingest` workflow with
   `organizationId: null`. Library rows get the same variants as uploads — `vertical_1080`,
   `proxy_480`, `thumb` — so nothing downstream special-cases them.
3. **Serve library assets through the CDN**, not signed URLs. They are public by definition and
   signing them per request wastes the cache.
4. **`signAssetUrl` already handles the split** from Phase 02 — ownership check is "mine **or**
   library". Verify a library asset resolves for a workspace that does not own it, and that a
   *gated* library asset still refuses below its `minPlan`.
5. **The background picker.** `src/components/global/background-picker/` — a grid of library
   backgrounds plus the workspace's own uploads, with lock badges on rows above the plan, an upload
   tile, keyboard navigation and ARIA labels. Reuse the Phase 02 upload component rather than a
   second drop zone.
6. **Looping.** Generators set `loop: true, muted: true` and loop the background to the narration
   length using the stored `durationSec`. A background shorter than the narration must loop
   seamlessly — test with a deliberately short clip.
7. **Cropping happens at transcode time, not render time** (Phase 02 already does this). Confirm a
   16:9 library source reaches the renderer already 9:16 so no composition does geometry.
8. **Default sensibly.** A new project picks a reasonable default rather than forcing a choice, and
   remembers the workspace's last pick.
9. **Music and SFX** follow the same shape — `kind: 'audio_music' | 'sfx'`, `source: 'library'`,
   with the same licence discipline. The licence must explicitly permit end-user publication and
   monetisation; most stock music licences do not.

## Contracts

```ts
export async function listBackgrounds(args: {
  organizationId: string
  plan: PlanKey
  includeUploads?: boolean
}): Promise<{ items: Asset[]; lockedCount: number }>

export interface BackgroundManifestEntry {
  key: string
  title: string
  sourceUrl: string
  license: string        // the actual terms, not a placeholder
  minPlan: PlanKey
  attribution?: string
}
```

## Done when

- [ ] The licensing position is written down and the manifest reflects it.
- [ ] A library background renders in a generated video, cropped to 9:16 and looping to the
      narration length.
- [ ] A background shorter than the narration loops without a visible seam.
- [ ] A free workspace sees gated backgrounds locked, and the server refuses one if requested
      directly.
- [ ] Every library row carries a licence string that is not the default.
- [ ] Library assets are served from the CDN; private uploads are still signed and expiring.
- [ ] The picker is fully keyboard navigable.

## Not in this phase

AI-generated footage (Phase 17), stock clip search per script block (Phase 14).
