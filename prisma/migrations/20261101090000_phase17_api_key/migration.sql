-- Phase 17b — the public API's credential.
--
-- APP_OWNED_NOT_A_PLUGIN: keys are scoped to an ORGANIZATION, not a user, which
-- is not the Better Auth apiKey plugin's model — and per-tenant concerns stay
-- app-owned so a provider switch cannot take them hostage.
--
-- THE_SECRET_IS_NEVER_STORED. `hash` holds a SHA-256 of the whole key and
-- `prefix` holds the first few characters, which is all the UI ever shows
-- again. The unique index on `hash` is what makes verification one indexed read
-- rather than a scan over a tenant's keys, and it is also why a leaked database
-- leaks no usable credential.
--
-- REVOKED_NOT_DELETED: revoking sets `revokedAt` and keeps the row, so the
-- audit trail can still name the key that did something months later. The
-- (organizationId) index serves the settings screen; (prefix) serves the log.

-- CreateTable
CREATE TABLE "api_key" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "dailyQuota" INTEGER NOT NULL DEFAULT 1000,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_key_hash_key" ON "api_key"("hash");

-- CreateIndex
CREATE INDEX "api_key_organizationId_idx" ON "api_key"("organizationId");

-- CreateIndex
CREATE INDEX "api_key_prefix_idx" ON "api_key"("prefix");

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
