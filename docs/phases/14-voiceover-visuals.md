# Phase 14 — Voiceover visuals

**Depends on:** Phases 09, 11.

## Goal

The `voiceover` kind stops being a styled background and gets real visuals: each script block is
matched to a stock clip or a generated image. With both providers disabled, the video still
completes.

## Registry

```ts
aiImages: {
  name: 'AI images',
  description: 'Generated images per month',
  limit: {
    perPlan: { free: 0, starter: 50, pro: 500, enterprise: 'unlimited', portal: 'unlimited' },
    upgradeMessage: 'Upgrade to {nextPlan} to generate images',
    availableOnFreeTrial: false,
    unit: 'images',
  },
}
```

A `free` cap of `0` is a real value, not a disabled feature — the gate refuses with the upgrade
modal rather than the feature vanishing, which is the better upsell. Register `aiImages` as
periodic with the Phase 00 `usage.reset` cron.

## Data

No new models. `Asset.source` gains two values already allowed by the Phase 02 union: `stock` and
`ai_image`. `Asset.promptText` and `modelVersion` exist for auditing generated images.

## Build

1. **The stock adapter.** `src/lib/adapters/stock/` with `search(query, opts)`. Ship Pexels or
   Pixabay. Record the provider, the source id and the licence on every asset ingested — a stock
   clip whose provenance is unrecorded is unusable the moment anyone asks.
2. **The image-model adapter.** `src/lib/adapters/image/` with `generate(prompt, opts)`. Same
   isolation pattern, same eslint restriction.
3. **Visual queries from the script.** For each `ScriptBlock`, the LLM proposes a short visual
   search query and an image prompt. Both are derived from the narration text, which is user
   content — the Phase 06 delimiter discipline applies unchanged.
4. **The fallback chain, in order:** best matching stock clip → generated image → the styled
   background from Phase 09. Each step is allowed to fail. The chain is the point: with
   `STOCK_API_KEY` and the image model both unset, a video must still render end to end, just
   plainer.
5. **Everything goes through `asset.ingest`.** A chosen stock clip or generated image is ingested
   like an upload so it gets `vertical_1080`, `proxy_480` and `thumb` variants plus a licence
   record. Never reference a provider's hotlink from a timeline — the URL will rot and the render
   will fail months later for no visible reason.
6. **Update the `voiceover` generator** to place one `MediaClip` per block, timed to that block's
   word range, with Ken Burns motion on stills so a static image does not read as a frozen frame.
7. **Moderate generated image prompts** before the model call, per Phase 10 — trademarks and real
   people especially.
8. **Swap UI.** Before generating, the user can replace any block's visual: re-search stock,
   re-prompt the image, upload their own, or fall back to the background. Show the licence on each
   candidate.
9. **Cost on the button.** Image generation holds credits per Phase 05; the review step itemises
   "N images" in the breakdown.
10. **Cache by prompt.** An identical prompt in the same workspace reuses the existing asset rather
    than paying twice, the same discipline as `textHash` and `audioHash`.

## Contracts

```ts
export interface StockAdapter {
  search(query: string, opts: { orientation: 'portrait'; minDurationSec?: number }): Promise<StockResult[]>
}
export interface StockResult {
  providerId: string
  previewUrl: string
  downloadUrl: string
  license: string
  attribution?: string
  durationSec?: number
}

export interface ImageAdapter {
  generate(prompt: string, opts: { aspect: '9:16' }): Promise<{ image: Buffer; modelVersion: string }>
}

export async function resolveBlockVisual(ctx: VisualContext): Promise<{ assetId: string; source: 'stock' | 'ai_image' | 'background' }>
```

## Done when

- [ ] A five-block script produces five matching visuals, each timed to its own block.
- [ ] With both providers disabled, the video still completes on the styled background.
- [ ] Every stock and generated asset carries its provider, source id and licence.
- [ ] A generated image records its prompt and `modelVersion`.
- [ ] Re-running with an identical prompt makes no second model call.
- [ ] A free workspace is refused image generation with the upgrade modal, and the server refuses
      it too.
- [ ] Swapping one block's visual leaves the other blocks untouched.
- [ ] No timeline item references a provider URL directly.

## Not in this phase

Generated **video** footage (Phase 17) — this phase is stills and stock clips only.
