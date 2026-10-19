-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "aspect" TEXT NOT NULL DEFAULT '9:16',
    "manualEdited" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "settings" JSONB,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline" (
    "projectId" TEXT NOT NULL,
    "docVersion" INTEGER NOT NULL,
    "doc" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timeline_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE INDEX "project_organizationId_idx" ON "project"("organizationId");

-- CreateIndex
CREATE INDEX "project_organizationId_createdAt_idx" ON "project"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "project_parentId_idx" ON "project"("parentId");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline" ADD CONSTRAINT "timeline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
