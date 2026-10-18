# Phase 11: Payments, moderation and limits (beta launch)

**Feature:** launch requirement
**Depends on:** phase 10

## Goal

The product can be opened to real users: they can pay, abuse is limited, and failures are visible.

## Build

- Stripe and Razorpay checkout for plans and credit packs; webhooks with signature verification and idempotent replay.
- Billing page: current plan, upgrade, invoices link.
- Moderation everywhere it is required: text before any paid step, uploads after ingest; store `moderation_status` on assets and projects.
- Rate limits in Redis: auth attempts (fail closed), daily generations and soft caps (fail open).
- Resend emails: render finished, payment receipt (non-blocking).
- Sentry and PostHog; `requestId` flowing from API call -> event -> steps -> render.
- Cron workflow `cleanup.tmp` for stale temp files and failed renders; R2 lifecycle rule for `tmp/`.
- Terms, privacy and takedown contact pages (placeholders the owner will fill).

## Data

- Payment/subscription tables as the providers require; ledger rows of kind `purchase`.

## Decision needed from the owner first

Create Stripe/Razorpay accounts and products, and supply the legal page text.

## Done when

- [ ] A test-mode purchase adds credits exactly once even if the webhook is delivered twice.
- [ ] Disallowed text is blocked before TTS is called.
- [ ] The daily generation limit is enforced per plan.
- [ ] A forced error shows up in Sentry with its requestId.

## Not in this phase

- Public API, new video formats.
