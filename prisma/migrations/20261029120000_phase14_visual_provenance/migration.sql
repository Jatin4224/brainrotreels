-- Phase 14 — voiceover visuals.
--
-- PROVENANCE_IS_NOT_OPTIONAL: a stock clip or a generated image carries where
-- it came from, so the question "who owns this footage" is answerable from the
-- row rather than from somebody's memory of which provider was configured.
--
-- PROMPT_IS_THE_CACHE_KEY: `promptHash` is the indexed lookup that makes an
-- identical prompt in the same workspace reuse its asset instead of paying the
-- model twice.
--
-- Every column is nullable and no default is written: an upload, a render
-- output and every row created before this phase legitimately have no
-- third-party provenance, and a backfilled default would be a claim nobody
-- checked.

-- AlterTable
ALTER TABLE "asset" ADD COLUMN     "attribution" TEXT,
ADD COLUMN     "promptHash" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceProvider" TEXT;

-- CreateIndex
CREATE INDEX "asset_organizationId_promptHash_idx" ON "asset"("organizationId", "promptHash");

-- CreateIndex
CREATE INDEX "asset_sourceProvider_sourceId_idx" ON "asset"("sourceProvider", "sourceId");

-- LINE_REMEMBERS_ITS_BLOCK: a per-block visual has to be timed to the words of
-- that block, and one block becomes one or more narration lines. Nullable, with
-- no foreign key: a block may be deleted while its recorded audio is still
-- good, and a cascade would delete narration the customer paid to synthesise.
-- AlterTable
ALTER TABLE "narration_line" ADD COLUMN     "blockId" TEXT;
