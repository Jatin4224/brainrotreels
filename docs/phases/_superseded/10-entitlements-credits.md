# Phase 10: Entitlements and credits

**Feature:** launch requirement
**Depends on:** phase 06

## Goal

One function decides every plan gate, and paid work is always preceded by a credit hold.

## Build

- `packages/entitlements`: `can(user, feature)` covering background catalog size, voice and avatar tiers, resolution, watermark, API/MCP access, concurrent jobs, daily generations. The UI calls the same function for locks and upgrade prompts.
- `packages/credits`: `estimate(doc)`, `hold()`, `commit()`, `release()`; record cost breakdown per render.
- Wire into workflows: estimate check at the end of generate; hold before render; commit on success; `onFailure` releases the hold.
- Watermark applied in the renderer by entitlement, not by generators.
- Cron workflow `reconcile.credits` comparing cached balance to ledger sum.
- Credits page showing balance and ledger history.

## Data

- `credit_ledger` (id, user_id, delta, kind, ref_id, metadata jsonb); `users.credit_balance` is a cache of the ledger sum.

## Done when

- [ ] A free user gets a watermark and locked premium voices; a paid plan does not.
- [ ] A failed render leaves the balance unchanged.
- [ ] Rendering with too few credits is refused before any provider is called.
- [ ] Unit tests cover hold/commit/release and double-commit protection.

## Not in this phase

- Taking payments (phase 11).
