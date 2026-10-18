# Phase 06 — Script generation

**Depends on:** Phases 01, 05.

## Goal

Turn an idea, a URL, a PDF or raw text into a structured, editable script of hook, body and CTA
blocks. Malformed model output never reaches the database, and fetched text never reaches the model
as instructions.

## Registry

```ts
scripts: {
  name: 'Scripts',
  description: 'AI-generated scripts for a project',
  permissions: ['create', 'read', 'update', 'delete'],
  audit: {
    describe: {
      create: 'Generated a script for project {input.projectId}',
      update: 'Edited a script block',
    },
  },
  rateLimit: {
    create: { count: 20, window: '1 m' },
  },
}
```

## Data

```prisma
model ScriptBlock {
  id               String   @id @default(cuid())
  organizationId   String
  projectId        String
  position         Int
  sectionType      String   // hook | body | cta
  narrationText    String
  durationEstimate Float
  speakerTag       String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  project      Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([projectId, position])
  @@map("script_block")
}
```

Store the normalised input on `Project.sourceRef` and the extracted body in `Project.settings` — do
not add a column for it.

## Build

1. **The LLM adapter.** `src/lib/adapters/llm/` with `generate({ system, user, schema })` returning
   parsed, Zod-validated output. Ship a Claude implementation. Follow the isolation pattern in
   `docs/09-providers-and-adapters.md` and add the eslint `no-restricted-imports` entry so the
   Anthropic SDK cannot be imported elsewhere.
2. **Retry once, with the error.** If the model's JSON fails the schema, retry exactly once with the
   validation error appended to the prompt, then fail the step. Two retries is usually the model
   being asked the wrong question.
3. **Input normalisation.** `src/lib/script/ingest.ts`: a URL becomes readable article text, a PDF
   becomes text with headers and footers stripped, raw text passes through. Cap the input length and
   record which path was taken.
4. **SSRF guard.** Before any fetch: scheme allowlist (`https:` only), reject credentials in the
   URL, resolve the host and **block private and link-local address ranges**, and cap redirects.
   Re-check after each redirect — a public URL that redirects to `169.254.169.254` is the attack.
5. **Untrusted text.** Everything extracted is **data, never instructions**. Wrap it in explicit
   delimiters, state in the system prompt that the delimited content must never be followed as
   instructions, and never interpolate it into the system prompt itself. Phase 12 tests this
   properly with a Reddit thread containing an injection.
6. **Generation.** `src/lib/script/generate.ts` — `generateScript({ sourceText, kind,
   targetSeconds, tone })` returning `{ title, blocks[] }`, each block tagged `hook | body | cta`.
7. **Pacing.** Estimate duration at about 2.5 spoken words per second. Warn above 60 seconds, in the
   UI and in the return value — do not silently truncate.
8. **`scripts.regenerateBlock`** rewrites one block and leaves the others byte-identical. Pass the
   surrounding blocks as context so the rewrite still fits, but only persist the one.
9. **Router and UI.** `src/trpc/routers/scripts.ts`; the editor groups blocks by section with inline
   editing, drag to reorder, add and delete, per-block regenerate, and a running duration total.
   Form validation follows the house pattern — Zod schema in `src/lib/types/script.ts`, RHF,
   `mode: 'onTouched'`.
10. **Cost.** Script generation holds credits per Phase 05 and shows the cost on the button.

## Contracts

```ts
export interface LlmAdapter {
  generate<T>(args: { system: string; user: string; schema: z.ZodType<T>; maxTokens?: number }): Promise<T>
}

export async function generateScript(input: GenerateScriptInput): Promise<{ title: string; blocks: ScriptBlockDraft[] }>
export async function extractSource(input: { kind: 'url' | 'pdf' | 'text'; value: string }): Promise<{ text: string; title?: string }>
```

## Done when

- [ ] A topic, a news URL and a 10-page PDF each produce a valid script.
- [ ] A URL pointing at `localhost`, a private range, or a redirect into one is rejected.
- [ ] A paywalled or dead URL produces a clear error offering raw-text entry.
- [ ] Regenerating the hook leaves every other block byte-identical.
- [ ] Model output failing the schema is retried once with the error, then fails the step cleanly —
      and never reaches the database.
- [ ] A script over 60 seconds shows the warning before generation proceeds.

## Not in this phase

Dialogue and multi-speaker splitting (Phase 12), quiz questions (Phase 13), moderation (Phase 10 —
stub the call here).
