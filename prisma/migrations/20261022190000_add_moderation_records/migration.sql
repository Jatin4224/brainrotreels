-- CreateTable
CREATE TABLE "moderation_record" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "categories" JSONB,
    "reason" TEXT,
    "engine" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_record_organizationId_idx" ON "moderation_record"("organizationId");

-- CreateIndex
CREATE INDEX "moderation_record_subjectType_subjectId_idx" ON "moderation_record"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "moderation_record_status_createdAt_idx" ON "moderation_record"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "moderation_record" ADD CONSTRAINT "moderation_record_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
