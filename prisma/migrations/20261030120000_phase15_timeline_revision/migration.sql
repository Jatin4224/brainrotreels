-- Phase 15 — the timeline editor's recovery point.
--
-- SNAPSHOTS_NOT_AN_EVENT_LOG: one row per accepted save holding the WHOLE
-- document, rather than the ops that produced it. Replaying ops to recover
-- requires every op in the chain to still apply against a document whose
-- schema has since migrated, which is the exact situation somebody recovering
-- from a bad autosave is in.
--
-- The unique on (projectId, revision) is not decoration: it is the second half
-- of the optimistic-concurrency check. Two tabs that somehow passed the
-- revision compare collide on this index instead of both writing, so the loser
-- gets a conflict rather than a silently lost edit.

-- CreateTable
CREATE TABLE "timeline_revision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "doc" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "timeline_revision_projectId_revision_key" ON "timeline_revision"("projectId", "revision");

-- CreateIndex
CREATE INDEX "timeline_revision_projectId_createdAt_idx" ON "timeline_revision"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "timeline_revision" ADD CONSTRAINT "timeline_revision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
