# Phase 16 — Motion graphics studio

**Depends on:** Phases 08, 09.

## Goal

Animated explainers where the model designs every frame: no keyframing, no templates, nothing
overlapping or cut off. The largest phase in the plan.

**Land it in four reviewable commits** — 16a scene language and layout engine, 16b primitives,
16c style tokens, 16d the AI designer. Each is independently reviewable, and 16a–16c are usable and
testable with no model involved at all.

## Registry

```ts
motionStudio: {
  name: 'Motion studio',
  description: 'AI-designed animated explainer videos',
  flag: {
    perPlan: { free: false, starter: false, pro: true, enterprise: true, portal: true },
    availableOnFreeTrial: false,
  },
}

motionVideos: {
  name: 'Motion videos',
  description: 'Motion graphics videos per month',
  limit: {
    perPlan: { free: 0, starter: 0, pro: 50, enterprise: 'unlimited', portal: 'unlimited' },
    upgradeMessage: 'Upgrade to {nextPlan} for motion graphics videos',
    availableOnFreeTrial: false,
    unit: 'videos',
  },
}
```

Motion is **priced and metered separately** because cost per video is several times the rest of the
pipeline — per-beat LLM calls, still renders, and a vision pass.

## Data

None. Scenes live inside timeline `scene` items with `render: 'motion'`; the storyboard lives in
`Project.settings`.

## Build

### 16a — Scene language and layout engine

1. **`src/lib/scene/schema.ts`** — Zod for a scene: `layout` plus `elements[]`, each element timed
   by word anchor or scene-relative time, with entrance and exit animations.
2. **Named layouts only.** `stack-center`, `split-2`, `grid-3`, `hero-plus-caption`, `flow-graph`.
   **The model never emits coordinates.** It picks a layout and fills slots; the engine does the
   geometry. This single constraint is what prevents the overlapping-garbage failure mode that
   makes most AI layout systems unusable.
3. **Real text measurement** against the actual bundled fonts — not an estimate, not an average
   character width. Overflow detection is only as good as the measurement.
4. **Safe zones per aspect ratio**, shared with the Phase 08 caption placement rather than
   reimplemented.
5. **Auto-layout for graphs** via elkjs or Dagre. Ask before adding whichever one you pick — it is a
   dependency the architecture does not currently name.

### 16b — Primitives

6. **Eight to ten primitives**, typed props, entrance and exit animations, driven by style tokens:
   `Title`/`KineticText`, `Counter`, `Meter`, `BarChart`, `Compare`, `List`, `FlowGraph`, `Icon`,
   `Callout`. Register the `MotionScene` family into `src/remotion/registry.ts`.
7. **A gallery page of hand-written scenes** exercising every primitive in every layout and every
   palette, reviewed **before any AI is connected**. The weak point named in `architecture.md` is
   that motion quality depends on the primitive library, not the model — so the primitives get
   reviewed on their own merits, with a human looking at them, while there is still nothing else to
   blame.

### 16c — Styles

8. **Style tokens**: palette, two fonts, radius, stroke weight, motion personality, caption
   treatment, music mood. Ship 6–10 library styles.
9. **"Design one for me"** — three questions, the LLM proposes tokens, and **code validates**
   contrast ratios and that both fonts are actually bundled. A model-proposed font that is not
   bundled renders as a fallback and silently ruins the video.

### 16d — AI designer

10. **Storyboard.** Split the aligned transcript into beats of 1.5–6 seconds, snapped to word
    boundaries, each with an intent: `title | stat | meter | flow | compare | list | emphasis`.
    Validate full coverage with no gaps and no overlaps before designing anything.
11. **Beat design.** Per beat, the LLM receives the words, the intent, the style, the aspect and the
    primitive catalogue, and returns a scene in the scene language. Fan out in Inngest, cache the
    long system prompt, and throttle to stay inside the provider's rate limits.
12. **Deterministic checks first, vision second.** Schema valid, anchors exist, measured text fits,
    no overlaps, inside safe zones, element count within range. Only then render 2–3 stills and ask
    a vision model to flag clutter, cut-off text or off-topic visuals. Deterministic checks are free
    and catch most of it; the vision pass is expensive and catches what geometry cannot.
13. **Repair loop, bounded.** Send the specific errors back, at most two attempts, then fall back to
    a safe `emphasis` beat. **The pipeline always finishes.** A user seeing one plain beat is a
    minor disappointment; a stuck job is a support ticket and a refund.
14. **Beat strip** on the project page: each beat as a still, with "redesign this beat" re-running
    exactly one beat.

## Contracts

```ts
export const sceneSchema = z.object({
  layout: z.enum(['stack-center', 'split-2', 'grid-3', 'hero-plus-caption', 'flow-graph']),
  elements: z.array(elementSchema).max(6),
})
export type Scene = z.infer<typeof sceneSchema>

export interface Beat {
  index: number
  startWord: number
  endWord: number
  intent: BeatIntent
}

export function checkScene(scene: Scene, ctx: LayoutContext): SceneCheckResult
export interface SceneCheckResult { ok: boolean; errors: SceneError[] }
```

## Done when

- [ ] Every primitive and layout renders in the gallery, in every palette, reviewed by a human.
- [ ] The deterministic checks catch an overflowing text element and an overlap, in a test.
- [ ] A hand-written three-scene document renders to MP4 with no model involved.
- [ ] Across 20 test videos, no rendered beat has overlapping or cut-off content.
- [ ] Every number or diagram appears on the word that introduces it.
- [ ] A deliberately broken scene is repaired within two attempts or replaced by the fallback, and
      is never shown broken.
- [ ] Redesigning one beat leaves the others byte-identical.
- [ ] A 60-second motion video finishes in under 10 minutes.
- [ ] Motion videos are metered against `motionVideos`, separately from other formats.
- [ ] A proposed style naming an unbundled font is rejected by code, not by eye.

## Not in this phase

Generated animation code, 3D, presenter characters.
