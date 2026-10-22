/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PricingPage, PRICING_IS_REGISTRY_DERIVED,
 *   PUBLIC_PAGE_NO_AUTH, REUSES_THE_COMPARISON_TABLE
 *
 * WHAT:  /pricing — the public pricing page.
 *
 * WHY:   PRICING_IS_REGISTRY_DERIVED, which is the phase's explicit
 *        instruction: every number on this page comes from
 *        `getPlanFeatureRows` and `PLANS`, never from a hand-typed list. The
 *        failure that prevents is the one every SaaS has had — a pricing page
 *        promising 50 GB while the gate enforces 25, discovered by a customer.
 *        Because the registry is also what the gate reads, the page cannot
 *        disagree with the product.
 *
 *        REUSES_THE_COMPARISON_TABLE rather than building a second one.
 *        `<FeatureComparisonTable>` already renders the registry's rows for a
 *        set of plans and takes nothing but plan keys — no org, no
 *        subscription, no trial state — so it works unchanged on a page with no
 *        signed-in user. Writing a public variant would have been a second
 *        thing to keep in step with the registry, which is the whole problem
 *        this page exists to avoid. `<PricingCard>` is deliberately NOT reused:
 *        it needs an `AvailablePlan`, a current plan and a trial state, and
 *        faking six props for an anonymous visitor would be worse than the
 *        simple cards below.
 *
 *        PUBLIC_PAGE_NO_AUTH — a Server Component with no tRPC call, so it
 *        renders for an anonymous visitor and can be cached. Nothing here reads
 *        a session; the call to action is a link to sign-up, and the authed
 *        upgrade flow remains the modal.
 *
 *        The PRICES themselves are the one thing not shown, and that is
 *        honest rather than an omission: this app's amounts live in Stripe
 *        (`PLANS[x].stripe` holds price IDs, not figures), so a number here
 *        would be a hardcoded duplicate of a value only Stripe knows. The
 *        cards name the plan and what it includes; the checkout states the
 *        price. Grep `AMOUNTS_LIVE_IN_STRIPE`.
 * WHERE: Linked from the marketing layout and the legal pages.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { FeatureComparisonTable } from "@/components/global/upgrade-modal";
import { AUTH_ROUTES } from "@/lib/config/auth-routes";
import { APP_NAME } from "@/lib/config/branding";
import { PLANS, PLAN_ORDER } from "@/lib/config/plans";
import { getPlanFeatureRows } from "@/lib/resources";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Plans and limits for ${APP_NAME}.`,
};

export default function PricingPage() {
  /* `showPlan` is the registry's own switch for a tier that exists but is not
   * sold (a hidden Enterprise, the platform tier). Honouring it here means a
   * plan can be withdrawn from the public page without a code change. */
  const plans = PLAN_ORDER.filter((plan) => PLANS[plan].showPlan);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-12">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Pricing</h1>
        <p className="mx-auto max-w-2xl text-sm text-muted-foreground">
          Every plan includes the whole pipeline — script, narration, captions
          and rendering. The plans differ in how much you can hold and how much
          you can make.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const definition = PLANS[plan];
          /* PRICING_IS_REGISTRY_DERIVED — the same read the gate uses. */
          const rows = getPlanFeatureRows(plan).filter((row) => row.isIncluded);

          return (
            <Card key={plan} className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-base">{definition.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {definition.description}
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-6">
                <ul className="flex flex-col gap-1.5 text-sm">
                  {rows.slice(0, 6).map((row) => (
                    <li key={row.resource} className="text-muted-foreground">
                      {row.label}
                    </li>
                  ))}
                </ul>

                <div className="flex flex-col gap-2">
                  {definition.trialDays > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {definition.trialDays}-day free trial
                    </p>
                  ) : null}
                  <Link
                    href={AUTH_ROUTES.signUp}
                    className={buttonVariants({
                      variant: plan === "pro" ? "default" : "outline",
                    })}
                  >
                    Get started
                  </Link>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight">
          Everything compared
        </h2>
        {/* REUSES_THE_COMPARISON_TABLE — the authenticated upgrade modal and
            this public page render the SAME component over the same registry,
            so the two can never describe different products. */}
        <FeatureComparisonTable planKeys={plans} />
      </section>

      {/* AMOUNTS_LIVE_IN_STRIPE — see the file header for why no figures are
          printed here. */}
      <p className="text-center text-xs text-muted-foreground">
        Prices are shown at checkout. Credits are consumed by generating and
        rendering — see the{" "}
        <Link href="/legal/refunds" className="underline">
          refund policy
        </Link>{" "}
        for how unused credits are treated.
      </p>
    </div>
  );
}
