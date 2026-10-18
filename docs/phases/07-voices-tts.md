# Phase 07 — Voices and TTS

**Depends on:** Phases 02, 06.

## Goal

Every script line has a speaker, every speaker has a voice, and every line has a cached audio file.
Re-synthesising unchanged text costs nothing.

## Registry

```ts
premiumVoices: {
  name: 'Premium voices',
  flag: {
    perPlan: { free: false, starter: true, pro: true, enterprise: true, portal: true },
    availableOnFreeTrial: false,
  },
}
```

Voice previews are deliberately **not** gated and cost no credits — hearing what you cannot yet use
is the upsell.

## Data

```prisma
model Voice {
  id              String  @id @default(cuid())
  name            String
  gender          String
  accent          String
  tone            String
  providerVoiceId String
  provider        String  @default("elevenlabs")
  minPlan         String  @default("free")
  previewAssetId  String?
  isActive        Boolean @default(true)

  @@index([minPlan])
  @@map("voice")
}

model Speaker {
  id             String  @id @default(cuid())
  organizationId String
  projectId      String
  tag            String  // "A", "OP", "narrator"
  voiceId        String?
  avatarId       String?
  state          String  @default("unassigned") // unassigned | ready

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  project      Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, tag])
  @@index([organizationId])
  @@map("speaker")
}

model NarrationLine {
  id             String   @id @default(cuid())
  organizationId String
  projectId      String
  position       Int
  speakerTag     String
  voiceId        String?
  text           String
  textHash       String
  audioAssetId   String?
  durationSec    Float?
  status         String   @default("pending") // pending | synthesizing | ready | failed
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  project      Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([projectId, position])
  @@index([textHash, voiceId])
  @@map("narration_line")
}
```

`Voice` has no `organizationId` — it is a shared catalogue, like library assets.

## Build

1. **The TTS adapter.** `src/lib/adapters/tts/` with `synthesize({ text, voiceId })` returning audio
   plus duration. Ship ElevenLabs, with a **backup model** inside the same adapter: on a model
   failure, fall back before failing the step. Add the eslint restriction.
2. **Seed the catalogue** with 40+ licensed library voices across gender, accent and tone, each with
   a `minPlan`. **No clones of real people or third-party characters, ever** — this is a legal
   position, not a preference. Seed through a migration-safe script the developer runs, not an
   agent-written seed file.
3. **Split blocks into lines.** A `ScriptBlock` becomes one or more `NarrationLine` rows, split by
   speaker and by sentence where a block is long. Position is stable across regeneration.
4. **Cache by content, not by line.** `textHash = hash(text + voiceId)`. Before synthesising, look
   for an existing ready line with the same hash in the same workspace and reuse its
   `audioAssetId`. Editing one line must invalidate only that line.
5. **Fan out.** TTS runs as an Inngest fan-out, one step per line, with per-organization
   concurrency so one workspace cannot saturate the provider. Each line's audio is stored through
   the Phase 02 asset pipeline as `kind: 'audio_tts'` under
   `orgs/{organizationId}/projects/{projectId}/audio/{lineId}.mp3`.
6. **Normalise loudness** with FFmpeg after synthesis and store the measured duration — the timeline
   needs real durations, not the provider's estimate.
7. **`line.resynth`** — `src/inngest/functions/line-resynth.ts`, triggered by `line/changed`:
   synthesise one line, re-align it (Phase 08), patch the timeline document. Phase 15's editor is
   its main caller.
8. **`validateAssignments(projectId)`** returns `{ ok, unassigned: string[] }` and **blocks
   generation** while any speaker is unassigned. Surface it as a disabled Next button with the
   unassigned speakers named, not a generic error.
9. **Preview endpoint.** A short cached sample per voice, no credit cost, served from a pre-rendered
   asset rather than synthesised on demand.
10. **Voice picker UI.** A searchable, filterable grid — gender, accent, tone, plan badge — with
    play buttons, ARIA labels and keyboard navigation. Premium voices show a lock badge for free
    workspaces rather than disappearing. Speaker assignment panel shows unassigned speakers clearly.

## Contracts

```ts
export interface TtsAdapter {
  synthesize(args: { text: string; voiceId: string }): Promise<{ audio: Buffer; durationSec: number; contentType: string }>
}

export async function validateAssignments(projectId: string): Promise<{ ok: boolean; unassigned: string[] }>
export async function assembleNarration(db: DbClient, projectId: string): Promise<{ assetId: string; durationSec: number }>
```

## Done when

- [ ] A two-speaker script produces one audio asset per line with the correct voice on each.
- [ ] Re-running generation with unchanged text makes zero provider calls (cache hit by `textHash`).
- [ ] Editing one line re-synthesises that line only.
- [ ] Generation is blocked, with the speakers named, while any speaker is unassigned.
- [ ] A free workspace sees premium voices locked with an upgrade affordance, and the server refuses
      them too.
- [ ] Voice previews play without spending credits.
- [ ] A primary TTS model failure falls back to the backup and still produces audio.

## Not in this phase

Word timings (Phase 08), avatars and character pairing (Phase 12), voice cloning (never).
