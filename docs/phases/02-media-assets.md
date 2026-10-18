# Phase 02 — Media assets and storage

**Depends on:** Phases 00, 01.

## Goal

One asset system for everything: library backgrounds, user uploads, generated audio, generated
footage and render outputs. This is also where the `storage` registry limit — declared in
`src/lib/resources.ts` since the boilerplate shipped, with nothing ever writing it — finally gets a
producer.

There is **zero prior art** to copy. The codebase today has no `<input type="file">`, no `FormData`,
no `<video>`, no `<img>`, and never imports `next/image`.

## Registry

`storage` already exists; leave its shape alone and start writing its counter. Add:

```ts
assets: {
  name: 'Media',
  description: 'Uploaded and generated media in this workspace',
  permissions: ['create', 'read', 'delete'],
  nav: {
    label: 'Media',
    href: '/dashboard/media',
    icon: 'Folder',
    section: 'main',
  },
  audit: {
    describe: {
      create: 'Uploaded {output.filename}',
      delete: 'Deleted asset {input.id}',
    },
  },
}
```

`assets` has no `limit` of its own — the quota is bytes, metered on `storage`. A resource declares
`limit` or `flag`, never both, and never a second resource's quota. Because `assets.create` is not
a `limit` path, the counter bump is **not** automatic: the handler calls `incrementUsage` itself
with the byte count, the same documented pattern `invitation.create` uses for seats.

## Data

```prisma
model Asset {
  id               String   @id @default(cuid())
  organizationId   String?  // null for library assets
  kind             String   // background | upload | ai_footage | image | audio_tts | audio_music | sfx | render_output | avatar
  source           String   // library | upload | generated | stock
  filename         String
  storageKey       String
  contentType      String
  bytes            Int
  durationSec      Float?
  width            Int?
  height           Int?
  license          String   @default("owned")
  minPlan          String?  // library gating only
  moderationStatus String   @default("pending") // pending | approved | rejected | skipped
  status           String   @default("processing") // processing | ready | failed
  error            String?
  promptText       String?  // ai_footage auditing
  modelVersion     String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  organization Organization?  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  variants     AssetVariant[]

  @@index([organizationId])
  @@index([organizationId, kind])
  @@index([kind, source])
  @@map("asset")
}

model AssetVariant {
  id         String @id @default(cuid())
  assetId    String
  variant    String // vertical_1080 | proxy_480 | thumb | waveform
  storageKey String
  width      Int?
  height     Int?
  bytes      Int

  asset Asset @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@unique([assetId, variant])
  @@index([assetId])
  @@map("asset_variant")
}
```

`organizationId` is nullable purely so library rows can be shared. Every ownership check must
therefore be "mine **or** library", never "not null".

## Build

1. **Signed upload.** `assets.createUploadUrl` returns a presigned PUT from the storage adapter with
   a content-type allowlist (MP4, MOV, WebM, JPEG, PNG, WebP, MP3, WAV) and a per-plan size cap.
   Check the `storage` gate with `checkFeatureGate` before issuing the URL — refusing after the
   bytes have landed is too late.
2. **Upload UI.** `src/components/global/media-upload/` — a drop zone with per-file progress,
   client-side type and size validation mirroring the server's, and clear rejection messages. This
   is new ground; keep it generic enough that Phases 11 and 14 reuse it.
3. **Completion.** `assets.completeUpload` creates the `Asset` row as `processing`, bumps the
   `storage` counter by the byte count, and sends `asset/uploaded`.
4. **The `asset.ingest` workflow** — `src/inngest/functions/asset-ingest.ts`. Steps: probe with
   ffprobe → reject unsupported codecs → transcode to `vertical_1080` (centre-crop or pad to 9:16) →
   derive `proxy_480`, `thumb`, and `waveform` for audio → moderate → mark `ready`. Each step writes
   its own result so a retry resumes.
5. **FFmpeg.** Decide where it runs — a container or a Lambda — and call it from the workflow, never
   from a route. Record the decision in the file header.
6. **Looping metadata.** Store `durationSec` so Phase 11 can loop a background shorter than the
   narration.
7. **`signAssetUrl(assetId, organizationId)`** in `src/services/assets.service.ts` — enforces
   ownership or library status, returns a short-lived URL. This is a security boundary: a signed URL
   must never be issuable for another workspace's asset.
8. **Deletion** removes the row, every variant, and the R2 objects, and decrements the `storage`
   counter by the recorded byte total.
9. **`/dashboard/media`** — a server page rendering `<ContentLayout title="Media">` around a client
   component built on the Phase 00 `<DataTable>`, with tabs (All, Uploads, Backgrounds, Audio),
   status chips, an upload tile and rename/delete row actions.
10. **`next.config.ts`** has no `images.remotePatterns`. Add the R2 public host before rendering any
    remote image.

## Contracts

```ts
export async function signAssetUrl(assetId: string, organizationId: string, ttlSeconds?: number): Promise<string>
export async function getAssetVariants(assetId: string): Promise<Record<VariantName, AssetVariant | null>>
export type VariantName = 'vertical_1080' | 'proxy_480' | 'thumb' | 'waveform'
```

## Done when

- [ ] A 16:9 MP4 upload becomes a `vertical_1080` variant plus a `proxy_480` and a thumbnail.
- [ ] An oversized or wrong-codec file is rejected with a specific message, before upload where the
      client can tell and after where it cannot.
- [ ] The `storage` usage bar moves on upload and moves back on delete.
- [ ] A free workspace at its storage cap is refused a presigned URL, with the upgrade modal.
- [ ] Asset URLs expire, and requesting another workspace's asset returns not-found rather than
      forbidden.
- [ ] Deleting an asset removes every R2 object it owns.
- [ ] A corrupt file marks the asset `failed` with a readable error and never reaches a render.

## Not in this phase

The curated background library and its tier gating (Phase 11). AI footage (Phase 17). Moderation is
stubbed here and made real in Phase 10.
