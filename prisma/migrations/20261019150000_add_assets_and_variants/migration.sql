-- CreateTable
CREATE TABLE "asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "license" TEXT NOT NULL DEFAULT 'owned',
    "minPlan" TEXT,
    "moderationStatus" TEXT NOT NULL DEFAULT 'pending',
    "status" TEXT NOT NULL DEFAULT 'processing',
    "error" TEXT,
    "promptText" TEXT,
    "modelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_variant" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER NOT NULL,

    CONSTRAINT "asset_variant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_organizationId_idx" ON "asset"("organizationId");

-- CreateIndex
CREATE INDEX "asset_organizationId_kind_idx" ON "asset"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "asset_kind_source_idx" ON "asset"("kind", "source");

-- CreateIndex
CREATE INDEX "asset_variant_assetId_idx" ON "asset_variant"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_variant_assetId_variant_key" ON "asset_variant"("assetId", "variant");

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_variant" ADD CONSTRAINT "asset_variant_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
