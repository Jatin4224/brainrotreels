-- CreateTable
CREATE TABLE "script_block" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sectionType" TEXT NOT NULL,
    "narrationText" TEXT NOT NULL,
    "durationEstimate" DOUBLE PRECISION NOT NULL,
    "speakerTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "script_block_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "script_block_organizationId_idx" ON "script_block"("organizationId");

-- CreateIndex
CREATE INDEX "script_block_projectId_position_idx" ON "script_block"("projectId", "position");

-- AddForeignKey
ALTER TABLE "script_block" ADD CONSTRAINT "script_block_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "script_block" ADD CONSTRAINT "script_block_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
