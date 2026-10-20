-- CreateTable
CREATE TABLE "render" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "providerRenderId" TEXT,
    "docHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "resolution" TEXT NOT NULL DEFAULT '1080p',
    "watermark" BOOLEAN NOT NULL DEFAULT true,
    "outputAssetId" TEXT,
    "posterAssetId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "creditsCharged" INTEGER,
    "costBreakdown" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "render_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "render_providerRenderId_key" ON "render"("providerRenderId");

-- CreateIndex
CREATE INDEX "render_organizationId_idx" ON "render"("organizationId");

-- CreateIndex
CREATE INDEX "render_projectId_idx" ON "render"("projectId");

-- CreateIndex
CREATE INDEX "render_organizationId_createdAt_idx" ON "render"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "render_projectId_docHash_key" ON "render"("projectId", "docHash");

-- AddForeignKey
ALTER TABLE "render" ADD CONSTRAINT "render_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "render" ADD CONSTRAINT "render_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
