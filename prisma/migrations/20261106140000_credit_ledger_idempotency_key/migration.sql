-- Generalises `purchaseRef` into `idempotencyKey`.
--
-- The column was added one migration ago for REPLAY_SAFE_TOP_UP, when the only
-- thing needing a unique ledger key was a Stripe payment intent. Wiring the
-- plan allowances gave it a second user with exactly the same requirement --
-- AN_ALLOWANCE_IS_GRANTED_ONCE_PER_PERIOD -- and the alternative was a second
-- nullable unique column beside the first, which is two ways to say one thing.
--
-- One column serves both because the keys are namespaced and cannot collide:
-- a payment intent is `pi_...`, a welcome grant is `signup:<orgId>`, and an
-- allowance is `allowance:<YYYY-MM>:<orgId>`. Renamed rather than re-created
-- so the existing unique index and any rows carrying a payment intent survive.

ALTER TABLE "credit_ledger" RENAME COLUMN "purchaseRef" TO "idempotencyKey";

ALTER INDEX "credit_ledger_purchaseRef_key"
  RENAME TO "credit_ledger_idempotencyKey_key";
