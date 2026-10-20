-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "creditBalance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "holdId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_ledger_organizationId_idx" ON "credit_ledger"("organizationId");

-- CreateIndex
CREATE INDEX "credit_ledger_organizationId_createdAt_idx" ON "credit_ledger"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "credit_ledger_holdId_idx" ON "credit_ledger"("holdId");

-- CreateIndex
CREATE INDEX "credit_ledger_refId_idx" ON "credit_ledger"("refId");

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
