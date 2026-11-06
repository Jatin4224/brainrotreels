/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: creditsAllowanceFunction, credits.allowance,
 *   AN_ALLOWANCE_IS_GRANTED_ONCE_PER_PERIOD, HOURLY_NOT_MONTHLY,
 *   ALLOWANCE_IS_CAPPED_PER_RUN, monthlyAllowanceFor
 *
 * WHAT:  Grants each workspace its plan's monthly credit allowance, once per
 *        calendar month.
 *
 * WHY:   This is the recurring half of closing the gap that made `grant`
 *        dead code: with no caller anywhere, the ONLY way credits could reach
 *        a workspace was a real Stripe payment, so a paid plan conferred
 *        features and no spending power. `createOrganizationWithOwner` grants
 *        the welcome balance; this grants every month after.
 *
 *        HOURLY_NOT_MONTHLY, deliberately the same choice and the same cron as
 *        `usageResetFunction`, for the reason recorded there: a once-a-month
 *        schedule has exactly one chance to fire, and a deploy or an outage in
 *        that hour costs every customer a month of credits. Hourly plus a
 *        "not yet granted this period" filter means the first run after the
 *        boundary does the work and the next twenty-three match no rows.
 *
 *        AN_ALLOWANCE_IS_GRANTED_ONCE_PER_PERIOD is enforced by the unique
 *        index on `CreditLedger.idempotencyKey`, NOT by that filter. The
 *        filter is a performance fast path; two overlapping runs would both
 *        pass it. The database is what refuses the second grant, which matters
 *        here more than in most places because a duplicated allowance is
 *        credits given away with nothing to attribute them to.
 *
 *        ALLOWANCE_IS_CAPPED_PER_RUN. One batch per run rather than every
 *        workspace in one transaction: the first run of a month has to touch
 *        the whole customer base, and an unbounded loop inside a step that is
 *        bounded by `maxDuration` is a job that gets slower every month until
 *        it times out and grants nobody. Hourly runs drain the remainder, and
 *        the boundary gives twenty-three spare attempts before anyone notices.
 *
 *        The tier is resolved per workspace through `getOrganizationTier`
 *        (PROVIDER_NEUTRAL_ENTITLEMENT), so a lapsed or cancelled subscription
 *        falls back to its real tier and gets that tier's allowance rather
 *        than the one it used to pay for.
 * WHERE: Registered in src/inngest/functions/index.ts.
 */

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import { prisma } from "@/lib/config/prisma";
import {
  allowanceIdempotencyKey,
  allowancePeriodRef,
  monthlyAllowanceFor,
} from "@/lib/credits/allowance";
import { getOrganizationTier } from "@/lib/feature-gate";
import { currentPeriodStart } from "@/lib/usage-period";
import {
  grant,
  organizationsAwaitingAllowance,
} from "@/services/credits.service";

/**
 * How many workspaces one run will grant. Sized so the step stays well inside
 * the serve route's `maxDuration` even when every workspace needs a tier
 * lookup — see ALLOWANCE_IS_CAPPED_PER_RUN.
 */
const ALLOWANCE_BATCH = 200;

export const creditsAllowanceFunction = inngestClient.createFunction(
  {
    id: "credits-allowance",
    name: "Grant monthly credit allowances",
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    const periodStart = currentPeriodStart();

    const pending = await step.run("collect-workspaces", () =>
      organizationsAwaitingAllowance(prisma, periodStart, ALLOWANCE_BATCH),
    );

    if (pending.length === 0) {
      return { granted: 0, skipped: 0, remaining: 0 };
    }

    const result = await step.run("grant-allowances", async () => {
      let granted = 0;
      let skipped = 0;

      for (const organization of pending) {
        const tier = await getOrganizationTier(organization.id);
        const amount = monthlyAllowanceFor(tier.tier);

        /* A plan with no allowance still has to be RECORDED as handled, or the
         * query above returns it every hour forever. A zero-amount grant is
         * that record: it carries this period's refId, so the workspace drops
         * out of the filter, and it reads honestly in the ledger as "this
         * month's allowance was nothing" rather than as a missing row. */
        const row = await grant(
          prisma,
          organization.id,
          amount,
          amount > 0
            ? `Monthly ${tier.tier} allowance`
            : `No monthly allowance on ${tier.tier}`,
          /* The SHARED period ref, and it is load-bearing rather than
           * decorative: `organizationsAwaitingAllowance` filters on exactly
           * this value. Omit it and the query matches every workspace every
           * hour forever — the idempotency key would still refuse the second
           * grant, so nothing would be double-granted, but the batch would
           * never drain and the job would do full work hourly for no effect. */
          allowancePeriodRef(periodStart),
          allowanceIdempotencyKey(organization.id, periodStart),
        );

        if (row === null) {
          /* Another run won the race. Not an error: the allowance exists. */
          skipped += 1;
          continue;
        }
        granted += 1;
      }

      return { granted, skipped };
    });

    return {
      ...result,
      /* A full batch means there is probably more to do; the next hourly run
       * picks it up. Reported so an operator can see a backlog draining. */
      remaining: pending.length === ALLOWANCE_BATCH ? "batch-full" : 0,
      periodStart: periodStart.toISOString(),
    };
  },
);
