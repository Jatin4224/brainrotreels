# Phase 08 — Alignment and captions

**Depends on:** Phases 03, 07.

## Goal

Word-level timings for all narration, and a library of 30+ caption styles that render identically in
the browser preview and the final video. A caption lands on the word being spoken.

## Registry

```ts
captionStyles: {
  name: 'Caption styles',
  description: 'The caption style library',
  permissions: ['read'],
}

premiumCaptionStyles: {
  name: 'Premium caption styles',
  flag: {
    perPlan: { free: false, starter: true, pro: true, enterprise: true, portal: true },
    availableOnFreeTrial: true,
  },
}
```

## Data

```prisma
model Alignment {
  projectId   String   @id
  words       Json     // Word[]
  audioHash   String
  engine      String
  degraded    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([audioHash])
  @@map("alignment")
}
```

Caption styles are **data, not rows** — they ship as config in `src/lib/captions/styles/`. A style
is the same for everyone; only which ones you may use varies by plan.

## Build

1. **The STT adapter.** `src/lib/adapters/stt/` with `align({ audioUrl, scriptText })` returning
   `Word[]`. Ship ElevenLabs Scribe. Keep the interface genuinely provider-shaped — alignment is a
   single point of failure for captions *and* motion timing, and a second provider must be
   droppable in without touching a caller.
2. **Align back to the script.** The transcript is matched against the original script text so
   punctuation, casing and spelling are what the user wrote, not what the model heard. The user
   typed "AITA"; the model hears "ay eye tee ay".
3. **Cache by `audioHash`.** Alignment is paid work and audio rarely changes — a cache hit must skip
   the provider entirely.
4. **Degrade, never fail.** If STT fails twice, distribute words evenly across the known audio
   duration, mark the alignment `degraded`, and continue. A degraded video with a visible warning
   beats a failed pipeline; the user can still see and re-run it.
5. **Caption styles as declarative data.** `src/lib/captions/styles/` — font, weight, case, size,
   stroke, shadow, fill, highlight colour, animation (`pop | bounce | fade | slide`), max words per
   chunk, position. Ship 30+. They are config so a new style is a data change, not a deploy of new
   components.
6. **Contrast-check every style** against light and dark backgrounds, with the check in a test
   rather than a reviewer's eye. The app has a `--success` token and a strict token system; caption
   colours are content, not chrome, so they are allowed literal values — but they must pass WCAG.
7. **`buildCaptionTrack(words, styleId)`** in `src/lib/captions/` returns caption items that
   reference **word ranges only**. Grouping rules: 2–4 words per chunk, break on punctuation, never
   split a hyphenated word. Restyling must never change timing.
8. **The `Captions` component family** registers into the Phase 03 `src/remotion/registry.ts`. One
   component reads `doc.words` plus style tokens and highlights the active word. Respect the
   safe-zone offset per platform — TikTok, Reels and Shorts each cover a different part of the
   frame.
9. **Style gallery UI.** Live preview over the user's chosen background, position slider,
   words-per-line control, on/off switch, keyboard navigable with ARIA labels. Premium styles show a
   lock badge.
10. **Overflow is a bug, not a cosmetic issue.** Long words and rapid speech must wrap inside the
    safe zone. Test with a deliberately hostile line.

## Contracts

```ts
export interface SttAdapter {
  align(args: { audioUrl: string; scriptText: string }): Promise<Word[]>
}
export interface Word { i: number; w: string; s: number; e: number; speaker?: string }

export function buildCaptionTrack(words: Word[], styleId: string): CaptionTrack
export function getCaptionStyle(styleId: string): CaptionStyle
export const CAPTION_STYLES: Record<string, CaptionStyle>
```

## Done when

- [ ] Captions on a 60-second sample land within about 50ms of the spoken word.
- [ ] Changing the style changes the look and provably not the timing.
- [ ] A forced STT failure still produces a renderable video, flagged degraded, with a visible
      warning in the UI.
- [ ] Re-aligning unchanged audio makes zero provider calls.
- [ ] Every shipped style passes the contrast test on both light and dark backgrounds.
- [ ] A hostile line — very long words, very fast speech — wraps inside the safe zone and never
      overflows the frame.
- [ ] The same document produces identical captions in the Remotion Player and in a cloud render.

## Not in this phase

Translation, manual timing edits (Phase 15), per-speaker caption colouring (Phase 12).
