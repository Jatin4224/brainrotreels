-- CreditLedger idempotency: THE_DATABASE_IS_THE_GUARANTEE.
--
-- REPLAY_SAFE_TOP_UP and DOUBLE_COMMIT_REFUSED were asserted in comments and
-- implemented as a read followed by a write in separate transactions. Both
-- races are real: `credits.purchase` writes inside the procedure's transaction
-- while the Stripe webhook writes on its own connection (granting one pack
-- twice), and a timeout racing a late success can give one hold both a commit
-- and a release (refunding a render the customer received).
--
-- `purchaseRef` is a nullable unique column rather than a unique index on
-- (refId, kind): a hold's refId is `tts:<projectId>` and re-running a project
-- legitimately takes a second hold under that same ref, so constraining
-- (refId, kind) would refuse every re-run. Postgres treats NULLs in a unique
-- index as distinct, so a nullable unique column IS a partial unique index --
-- and one Prisma can express, so `migrate dev` will not later diff it away.

ALTER TABLE "credit_ledger" ADD COLUMN "purchaseRef" TEXT;

-- Backfill from the existing purchase rows so historical top-ups are covered
-- by the constraint too. Written before the index so a pre-existing duplicate
-- surfaces here, as a failed migration inside a transaction, rather than as a
-- double grant later.
UPDATE "credit_ledger" SET "purchaseRef" = "refId"
WHERE "kind" = 'purchase' AND "refId" IS NOT NULL;

CREATE UNIQUE INDEX "credit_ledger_purchaseRef_key"
  ON "credit_ledger"("purchaseRef");

-- One settlement row per kind per hold. A hold that has already been settled
-- has a release row, and THE_RELEASE_GOES_FIRST in settlementRows means a
-- duplicate settlement collides on its FIRST insert, with nothing written.
CREATE UNIQUE INDEX "credit_ledger_holdId_kind_key"
  ON "credit_ledger"("holdId", "kind");
