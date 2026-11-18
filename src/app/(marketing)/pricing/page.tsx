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
import {
  PLANS,
  PLAN_ORDER,
  PLAN_PRICE_CURRENCY_SYMBOL,
} from "@/lib/config/plans";
import { getPlanFeatureRows } from "@/lib/resources";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    /* ONE MARKETING SURFACE. This page sat on the DASHBOARD's type scale —
       a 30px semibold h1 in the UI face — one nav click from a landing page
       whose headings are 48px Bricolage. A visitor crossed from a designed
       page to what looked like an internal settings screen at the exact
       moment they were deciding to pay. Same scale, same display face, same
       text-balance and same 72-character measure as every other heading on
       the marketing surface.

       max-w-6xl, up from max-w-5xl: four plan cards need the room, and the
       comparison table below was already scrolling horizontally inside it. */
    <div className="safe-x mx-auto flex max-w-6xl flex-col gap-14 py-16 md:py-24">
      <header className="flex flex-col gap-4 text-center">
        <h1 className="font-display text-3xl font-medium leading-tight tracking-tight text-balance text-foreground md:text-4xl lg:text-5xl">
          Pick your plan
        </h1>
        <p className="mx-auto max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">
          Every plan includes the whole pipeline — script, narration, captions
          and rendering. The plans differ in how much you can hold and how much
          you can make.
        </p>
      </header>

      {/* FOUR PLANS, FOUR COLUMNS. This was lg:grid-cols-3 against four sold
          tiers, so Enterprise wrapped onto a row of its own with two thirds
          of it empty — the most visible layout fault on the marketing
          surface, on the page where people decide to pay. The landing page
          already does 1 → 2 → 4 for the same four; this now matches it.

          items-stretch so the featured card's lift cannot shorten its
          neighbours. */}
      <ul className="grid items-stretch gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const definition = PLANS[plan];
          /* PRICING_IS_REGISTRY_DERIVED — the same read the gate uses. */
          const rows = getPlanFeatureRows(plan).filter((row) => row.isIncluded);
          const isFeatured = plan === "pro";

          return (
            <li
              key={plan}
              className={cn(
                "brutal-border brutal-shadow relative flex h-full flex-col gap-5 rounded-2xl bg-card p-6",
                isFeatured &&
                  "brutal-shadow-brand border-brand/60 xl:-translate-y-2",
              )}
            >
              {isFeatured ? (
                <span className="brutal-shadow-brand absolute left-1/2 -top-3.5 -translate-x-1/2 rounded-full bg-brand px-3.5 py-1 text-xs font-semibold text-brand-foreground">
                  Best value
                </span>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <h2 className="font-display text-lg font-extrabold tracking-tight text-foreground">
                  {definition.name}
                </h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {definition.description}
                </p>
              </div>

              {/* THE FIGURE, ON THE PRICING PAGE. The landing page's plan row
                  prints $19 / $49 / $149 and its CTA says "Compare every
                  plan" — and this, the page it points at, printed no amount
                  at all. Whichever way round that is read, one of the two
                  pages was wrong; the page called Pricing is not the one that
                  should be missing the price. Same registry read and the same
                  treatment as the landing row, including `free` showing the
                  WORD rather than "$0", which reads as a discount on
                  something rather than as free. */}
              <p className="font-display text-3xl font-extrabold tracking-tight text-foreground">
                {definition.monthlyAmount === 0 ? (
                  "Free"
                ) : (
                  <>
                    {`${PLAN_PRICE_CURRENCY_SYMBOL}${definition.monthlyAmount}`}
                    <span className="text-base font-semibold text-muted-foreground">
                      {" "}
                      /month
                    </span>
                  </>
                )}
              </p>

              <ul className="flex flex-col gap-1.5 text-sm">
                {rows.slice(0, 6).map((row) => (
                  <li key={row.resource} className="text-muted-foreground">
                    {row.label}
                  </li>
                ))}
              </ul>

              {definition.trialDays > 0 ? (
                <p className="brutal-border-thin w-fit rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">
                  {definition.trialDays}-day free trial
                </p>
              ) : null}

              <Link
                href={AUTH_ROUTES.signUp}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "brutal-border mt-auto h-11 w-full rounded-full font-semibold",
                  isFeatured
                    ? "bg-brand text-brand-foreground hover:bg-brand/90"
                    : "bg-card text-foreground hover:bg-muted",
                )}
              >
                Get started
              </Link>
            </li>
          );
        })}
      </ul>

      {/* No heading here. FeatureComparisonTable renders its own centred
          title, so the page's left-aligned "Everything compared" sat
          directly on top of it — two titles for one table, in two
          alignments and two sizes. The component's own title is the one that
          travels with it into the upgrade modal, so the page's is the one
          that goes. */}
      <section className="flex flex-col gap-4">
        {/* REUSES_THE_COMPARISON_TABLE — the authenticated upgrade modal and
            this public page render the SAME component over the same registry,
            so the two can never describe different products. */}
        <FeatureComparisonTable planKeys={plans} />
      </section>

      {/* The monthly figure is printed on the cards above; what is still
          settled at checkout is tax, currency and proration, and what the
          credits do is the part people actually ask about. The old line said
          "Prices are shown at checkout", which contradicts the cards now
          that they carry the amount. */}
      <p className="text-center text-xs text-muted-foreground">
        Billed monthly and cancellable any time. Taxes are settled at checkout.
        Credits are consumed by generating and rendering — see the{" "}
        <Link href="/legal/refunds" className="underline">
          refund policy
        </Link>{" "}
        for how unused credits are treated.
      </p>
    </div>
  );
}
