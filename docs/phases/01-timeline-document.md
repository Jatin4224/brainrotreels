# Phase 01 — Timeline document

**Depends on:** Phase 00.

## Goal

Build `src/lib/timeline/` — the single contract every generator, the editor, the player and the
renderer share. It is pure and isomorphic: the same `apply()` runs in the browser editor and on the
server. Two implementations would drift inside a month, which is the documented failure mode.

## Registry

```ts
projects: {
  name: 'Projects',
  description: 'Videos being made in this workspace',
  permissions: ['create', 'read', 'update', 'delete'],
  limit: {
    perPlan: { free: 3, starter: 30, pro: 300, enterprise: 'unlimited', portal: 'unlimited' },
    upgradeMessage: 'Upgrade to {nextPlan} for more projects',
    availableOnFreeTrial: true,
  },
  nav: {
    label: 'Projects',
    href: '/dashboard/projects',
    icon: 'Folder',
    section: 'main',
  },
  audit: {
    describe: {
      create: 'Created project {output.title}',
      update: 'Updated project {output.title}',
      delete: 'Deleted project {input.id}',
    },
  },
}
```

`Folder` is already in the `NAV_ICONS` map in `src/components/global/sidebar/nav-icons.tsx`, so no
icon work is needed.

## Data

```prisma
model Project {
  id             String    @id @default(cuid())
  organizationId String
  title          String
  kind           String    // reddit-story | voiceover | quiz | motion
  status         String    @default("draft") // draft | generating | ready | failed | cancelled
  aspect         String    @default("9:16")
  manualEdited   Boolean   @default(false)
  parentId       String?   // set when a regeneration branched off an edited project
  settings       Json?
  sourceRef      String?   // the Reddit URL, the topic, the uploaded doc key
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  parent       Project?     @relation("ProjectVersions", fields: [parentId], references: [id])
  versions     Project[]    @relation("ProjectVersions")
  timeline     Timeline?

  @@index([organizationId])
  @@index([organizationId, createdAt])
  @@index([parentId])
  @@map("project")
}

model Timeline {
  projectId  String   @id
  docVersion Int
  doc        Json
  revision   Int      @default(0)
  updatedAt  DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@map("timeline")
}
```

Add `projects Project[]` to `Organization`. `kind` and `status` are `String`, not Prisma enums —
the schema has zero enum blocks and this matches it. Validate them with Zod unions in
`src/lib/types/`.

## Build

1. **Schema.** `src/lib/timeline/schema.ts` — Zod for the v4 document exactly as in
   `architecture.md`: `canvas`, `style`, `words[]`, `tracks[]` of type
   `video | scene | audio | caption | overlay`, `speakers`, `assets`. Export the inferred
   `TimelineDoc`. Item types carry `render` ∈ `media | motion | quizCard | redditCard |
   characterOverlay | text`.
2. **Timing is two-formed.** Generated content uses word anchors (`{ wordIndex }` or `{ word }`);
   resolved documents carry absolute seconds. The schema accepts both; `validate` rejects a document
   that is supposed to be resolved and still holds anchors.
3. **`validate(doc)`** — `src/lib/timeline/validate.ts`. No negative or zero durations, items inside
   the video length, caption word ranges exist in `words`, every referenced `assetId` exists in
   `assets`, item ids unique, z-order unique among overlapping overlays, items inside canvas bounds.
   Returns field-level errors; never throws raw.
4. **`migrate(doc)`** — `src/lib/timeline/migrate.ts`. A version registry upgrading step by step.
   Called on every read, without exception.
5. **`apply(doc, ops)`** — `src/lib/timeline/ops.ts`. Pure functions: `trim`, `split`, `move`,
   `delete`, `reorder`, `setCaptionText`, `setItemProps`, `addItem`, `addOverlay`, each with an
   optional `ripple` flag. Returns a new document and never mutates. This is the module the editor
   imports in Phase 15.
6. **`resolveWordAnchors(doc)`** — turns anchors into seconds and frames using `words[]`.
7. **`hashDoc(doc)`** — stable hash over sorted keys. Phase 04 uses it for render reuse, so it must
   be insensitive to key order and to fields that do not affect output.
8. **Purity.** No Prisma import, no `server-only`, no Node built-ins anywhere under
   `src/lib/timeline/`. Add a lint rule or a test that fails if one appears.
9. **Fixtures.** `src/lib/timeline/fixtures/` — one document per kind, plus a v1 document for the
   migration test.
10. **Service and router.** `src/services/projects.service.ts` for reused queries;
    `src/trpc/routers/projects.ts` with `create`, `list` (`paginate: true`), `get`, `rename`,
    `delete`, `duplicate`. Mount in `src/trpc/routers/_app.ts`. Every input carries
    `organizationId: z.string().min(1)`.
11. **The branch policy.** Write down here, not later: regenerating a project whose
    `manualEdited` is true creates a new `Project` row with `parentId` set, and never overwrites the
    edited timeline. `architecture.md` flags this as decide-early-or-suffer. Phase 15 implements the
    UI; the data shape is settled now.

## Contracts

```ts
export type TimelineDoc = z.infer<typeof timelineDocSchema>
export function validate(doc: unknown): { ok: true; doc: TimelineDoc } | { ok: false; errors: ValidationError[] }
export function migrate(doc: unknown): TimelineDoc
export function apply(doc: TimelineDoc, ops: Op[]): { doc: TimelineDoc; errors: ValidationError[] }
export function resolveWordAnchors(doc: TimelineDoc): TimelineDoc
export function hashDoc(doc: TimelineDoc): string
```

## Done when

- [ ] Every operation is pure: same input, same output, and the input object is never mutated.
- [ ] An invalid document returns field-level errors rather than throwing.
- [ ] A v1 fixture migrates to v4 and then validates.
- [ ] `hashDoc` returns an identical hash for two documents that differ only in key order.
- [ ] Unit tests cover every operation including ripple and split edge cases, and every validation
      rule.
- [ ] `src/lib/timeline/` imports nothing from Prisma, `server-only`, or Node, proven by a test.
- [ ] A project can be created, listed, renamed and deleted from the UI, and the plan limit blocks
      creation at the cap with the upgrade modal.

## Not in this phase

Rendering, the editor UI, generators, assets.
