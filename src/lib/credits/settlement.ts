/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: settlementRows, SettlementRow,
 *   RELEASE_REVERSES_THE_WHOLE_HOLD, NET_IS_THE_ACTUAL_COST, SETTLEMENT_IS_PURE
 *
 * WHAT:  The rows that settle a hold, as pure arithmetic.
 *
 * WHY:   SETTLEMENT_IS_PURE, and this module exists because of a bug that
 *        shipped and was caught by a probe against a real database rather than
 *        by review.
 *
 *        The phase brief says commit "writes `commit` for the real amount and
 *        a compensating `release` for the difference". Followed literally that
 *        DOUBLE-CHARGES every job, because the hold has already deducted the
 *        estimate: a 12-credit hold settled at 9 gives `−12 − 9 + 3 = −18` for
 *        work that cost 9. The release has to reverse the hold IN FULL.
 *
 *        That arithmetic used to live inside `credits.service.ts`, where it
 *        needed a database to exercise and so was never unit tested. Pulling
 *        it out makes the one calculation in this system that moves real money
 *        testable with no Prisma, no network and no fixtures — which is what
 *        keeps the fix from being undone by somebody reading the brief and
 *        "correcting" the code back.
 *
 *        NET_IS_THE_ACTUAL_COST is the property to check against, and the only
 *        one worth remembering: whatever the estimate was, the ledger's net
 *        movement across hold + settlement must equal what the work actually
 *        cost.
 * WHERE: `commit` in src/services/credits.service.ts.
 */

import type { CreditLedgerKind } from "@/lib/types/credits";

/**
 * SOURCE OF TRUTH KEYWORDS: SettlementRow
 *
 * WHAT:  One row to append, as a kind and a POSITIVE amount.
 * WHY:   Positive, with the direction carried by the kind (SIGN_BY_KIND), so
 *        this function cannot express a refund where a charge was meant — the
 *        sign is applied once, by the service, for every kind.
 * WHERE: Returned by settlementRows.
 */
export interface SettlementRow {
  kind: Extract<CreditLedgerKind, "commit" | "release">;
  amount: number;
}

/**
 * SOURCE OF TRUTH KEYWORDS: settlementRows, RELEASE_REVERSES_THE_WHOLE_HOLD
 *
 * WHAT:  How to settle a hold of `held` for work that cost `actual`.
 * WHY:   See the file header. Three cases, all netting to `−actual`:
 *
 *          cheaper   hold −12, commit −9,  release +12  →  −9
 *          exact     hold −12, commit −12, release +12  →  −12
 *          dearer    hold −12, commit −20, release +12  →  −20
 *
 *        A zero `actual` writes no commit row at all — a zero-delta row is a
 *        row that says nothing, and the release alone already reads as "held,
 *        then settled at nothing".
 * WHERE: `commit`.
 */
export function settlementRows(held: number, actual: number): SettlementRow[] {
  const reserved = Math.max(0, Math.round(held));
  const charged = Math.max(0, Math.round(actual));

  const rows: SettlementRow[] = [];

  if (charged > 0) rows.push({ kind: "commit", amount: charged });
  if (reserved > 0) rows.push({ kind: "release", amount: reserved });

  return rows;
}

/**
 * SOURCE OF TRUTH KEYWORDS: settlementNet, NET_IS_THE_ACTUAL_COST
 *
 * WHAT:  What a hold plus its settlement moves the balance by, in total.
 * WHY:   The invariant stated as code, so a test can assert the PROPERTY
 *        rather than the row shapes — the rows are an implementation detail
 *        and the net is the thing a customer is charged.
 * WHERE: settlement.test.ts.
 */
export function settlementNet(held: number, actual: number): number {
  const reserved = Math.max(0, Math.round(held));
  return settlementRows(held, actual).reduce(
    (total, row) => total + (row.kind === "commit" ? -row.amount : row.amount),
    -reserved,
  );
}
