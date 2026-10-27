-- CreateTable
CREATE TABLE "avatar" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetSet" JSONB NOT NULL,
    "minPlan" TEXT NOT NULL DEFAULT 'free',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avatar_minPlan_idx" ON "avatar"("minPlan");

-- CreateIndex
CREATE INDEX "avatar_isActive_idx" ON "avatar"("isActive");
