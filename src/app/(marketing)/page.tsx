/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: LandingPage, HOME_IS_PUBLIC,
 *   AUTH_IS_A_CLICK_NOT_A_REDIRECT, COPY_IS_REGISTRY_DERIVED,
 *   PROJECT_FLOW_STEPS, RESOURCES, LANDING_FEATURE_KEYS, LANDING_FORMATS,
 *   LANDING_FAQ, HANDLED_FOR_YOU, PUBLIC_PAGE_NO_AUTH, SOFT_BRUTALISM,
 *   HERO_COPY, THE_LEAD_IS_NOT_THE_TAGLINE, AUTH_ROUTES,
 *   METADATA_IS_INHERITED, SCROLL_MT_20
 *
 * WHAT:  `/` — the public landing page. Hero and proof strip, the four
 *        formats, the walkthrough beside what the pipeline handles, the
 *        registry-derived feature grid, a plan teaser, the FAQ and a closing
 *        call to action.
 *
 * WHY:   HOME_IS_PUBLIC and AUTH_IS_A_CLICK_NOT_A_REDIRECT, which is the fix
 *        this page was rebuilt around. `/` is a landing page, not an auth
 *        probe: it renders for somebody with no account and it NEVER sends
 *        them anywhere. Every route to an auth screen on this page is a CTA
 *        the visitor presses — "Get started" and its siblings — and the global
 *        redirect that used to fire here regardless is excused for this path
 *        now (see PUBLIC_MARKETING_SURFACE in src/lib/config/public-routes.ts;
 *        the cause was <UpgradeModalProvider> in the ROOT layout asking an
 *        authProcedure for the active organization).
 *
 *        COPY_IS_REGISTRY_DERIVED, the same discipline the pricing page keeps
 *        (PRICING_IS_REGISTRY_DERIVED). The steps are `PROJECT_FLOW_STEPS` —
 *        the identical list the per-project nav renders — the feature names and
 *        blurbs are read out of `RESOURCES`, and the plan teaser reads `PLANS`.
 *        The failure that prevents is a landing page advertising a step, a
 *        feature or a tier the product renamed or retired, which nothing in a
 *        build would catch if the words were typed here. The persuasive prose
 *        that no registry can own — the formats, the FAQ, the proof strip —
 *        lives in ./_components/landing-content.ts, typed so a retired format
 *        or resource fails the typecheck (PAGE_OWNED_COPY).
 *
 *        SOFT_BRUTALISM is the look, from design.md: hairline borders with an
 *        inset top highlight, deep soft shadows, a 1px lift on hover, big
 *        low-contrast display headings, and two brand colors against a
 *        near-black page. It is expressed entirely through the tokens and
 *        utilities in globals.css (`bg-brand`, `text-brand-accent`,
 *        `brutal-*`, `halo-brand`) — no hex values and no `text-white` here,
 *        so re-skinning is one edit in that file (MARKETING_DESIGN_LANGUAGE).
 *
 *        PUBLIC_PAGE_NO_AUTH — a Server Component with no tRPC call, no
 *        `headers()` and no cookie read, so it is cacheable and renders for
 *        somebody with no account. See NO_AUTH_IN_THIS_GROUP in the group
 *        layout; a single session read here would opt the whole group out. The
 *        FAQ is the only client component on the page, and it receives its
 *        content as data.
 *
 *        SCROLL_MT_20 on every anchored section, because the header is sticky:
 *        without it the header covers the heading a visitor just jumped to.
 *
 *        METADATA_IS_INHERITED: no `metadata` export on purpose. The root
 *        layout's default title IS `BRANDING.appName` and its description IS
 *        `APP_DESCRIPTION`, which is exactly what this page wants — exporting
 *        them again would be a second copy of branding to keep in step.
 * WHERE: Rendered inside src/app/(marketing)/layout.tsx. Steps come from
 *        src/components/global/project-steps/steps.ts; features from
 *        src/lib/resources.ts; plans from src/lib/config/plans.ts; content from
 *        ./_components/landing-content.ts; CTAs target AUTH_ROUTES.
 */

import Link from "next/link";
import { ArrowRightIcon, CheckIcon, PlayIcon } from "lucide-react";

/* Leaf import, not the barrel: `@/components/global/project-steps` also
 * exports the ProjectSteps client component, and this page needs only the
 * plain step data — the same reason proxy.ts imports request-id directly. */
import { PROJECT_FLOW_STEPS } from "@/components/global/project-steps/steps";
import { FaqAccordion } from "@/components/global/faq-accordion";
import { buttonVariants } from "@/components/ui/button";
import { AUTH_ROUTES } from "@/lib/config/auth-routes";
import { APP_NAME } from "@/lib/config/branding";
import { PLANS, PLAN_ORDER } from "@/lib/config/plans";
import { RESOURCES } from "@/lib/resources";
import { cn } from "@/lib/utils";
import { HighlightHeading } from "@/components/global/highlight-heading";

import {
  HANDLED_FOR_YOU,
  HERO_COPY,
  HeroPromptCard,
  LANDING_FAQ,
  LANDING_FEATURE_KEYS,
  LANDING_FORMATS,
  LANDING_PROOF_CLIPS,
  LANDING_REELS,
  ProofStrip,
  ReelStage,
  STEP_BLURBS,
} from "./_components";

/* The primary CTA skin, written once and shared with the hero card's submit
 * button so the page has ONE loud orange action. It is a LINK here — see
 * AUTH_IS_A_CLICK_NOT_A_REDIRECT. */
const PRIMARY_CTA =
  "brutal-shadow-brand h-12 rounded-xl bg-brand px-6 text-base font-bold text-brand-foreground hover:bg-brand/90";

export default function LandingPage() {
  /* `showPlan` is the registry's own switch for a tier that exists but is not
   * sold. Honouring it means a plan can be withdrawn from the public page
   * without a code change. */
  const teaserPlans = PLAN_ORDER.filter((plan) => PLANS[plan].showPlan);

  return (
    <div className="flex flex-col">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden">
        <div
          aria-hidden="true"
          className="halo-brand pointer-events-none absolute left-1/2 top-24 -z-10 h-160 w-250 max-w-full -translate-x-1/2 opacity-40 blur-[60px]"
        />

        {/* HERO_IS_A_SPLIT: the pitch on the left, the output on the right.
            Centred text with the proof below it made a visitor scroll before
            seeing a single frame of what the product makes; side by side, the
            claim and the evidence land in the same glance. One column below
            `lg`, where there is no room for two and the showcase follows the
            words rather than fighting them. */}
        <div className="mx-auto max-w-[1240px] px-6 pb-20 pt-16 md:pt-24">
          {/* 1.05fr / 1fr at 900px and up — the text column is given the extra
              fraction because it carries the headline, the field and the
              proof line, while the stage is a fixed-size object that does not
              benefit from more room. Below 900px the phones stack under the
              words: there is no width at which two columns of this fit. */}
          <div className="grid items-center gap-10 min-[900px]:grid-cols-[1.05fr_1fr]">
            <div className="flex flex-col items-start text-left">
              <span className="brutal-border brutal-shadow-sm mb-8 inline-flex items-center gap-2 rounded-full bg-brand-accent px-4 py-1.5 text-sm font-bold tracking-tight text-brand-accent-foreground">
                <PlayIcon
                  className="size-3.5 fill-current"
                  aria-hidden="true"
                />
                {HERO_COPY.eyebrow}
              </span>

              {/* Extrabold, not the light display weight the rest of the page
                  uses. This is the one place the headline has to out-shout a
                  full-colour illustration beside it, and a 400-weight face at
                  this size loses that fight. */}
              {/* HIGHLIGHT_IS_A_BLOCK — see the component for why the block
                  is sized from the word and hidden from assistive tech. */}
              <HighlightHeading
                before={HERO_COPY.headlineBefore}
                highlight={HERO_COPY.headlineHighlight}
                after={HERO_COPY.headlineAfter}
                className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-foreground md:text-6xl"
              />

              {/* THE_LEAD_IS_NOT_THE_TAGLINE — page-owned prose, because this
                  sentence names the four inputs and the six jobs, which is
                  more than APP_DESCRIPTION can carry as a <meta> description
                  too. Metadata still inherits APP_DESCRIPTION. */}
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                {HERO_COPY.lead}
              </p>

              {/* THE_FIELD_IS_THE_PITCH — the hero's action is the control
                  itself. ONE_ACTION_PER_SCREENFUL: no competing button row;
                  the sticky header carries a permanent "Get started". */}
              <HeroPromptCard className="mt-8" />

              <div className="mt-6 flex items-center gap-3">
                {/* Three stacked discs in the brand colours — a crowd, drawn
                    rather than photographed, because stock headshots of people
                    who are not customers are the oldest lie on a landing
                    page. */}
                <span aria-hidden="true" className="flex items-center">
                  <span className="size-7 rounded-full border-2 border-background bg-brand-accent" />
                  <span className="-ml-2.5 size-7 rounded-full border-2 border-background bg-brand" />
                  <span className="-ml-2.5 size-7 rounded-full border-2 border-background bg-foreground" />
                </span>
                <p className="text-sm font-semibold text-muted-foreground">
                  {HERO_COPY.socialProof}
                </p>
              </div>
            </div>

            <ReelStage
              items={LANDING_REELS}
              badge={HERO_COPY.renderedBadge}
              footnote={HERO_COPY.showcaseFootnote}
            />
          </div>

          <ProofStrip clips={LANDING_PROOF_CLIPS} className="mt-20" />
        </div>
      </section>

      {/* ── Formats ──────────────────────────────────────────────────────── */}
      <section
        id="formats"
        className="scroll-mt-20 border-t-2 border-border py-20 md:py-28"
      >
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-accent">
              The formats
            </p>
            <h2 className="mt-3 font-display text-3xl font-medium leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
              Four ways to start, one finished video
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Pick the format that fits what you already have. Each one has its
              own writer, so the script is built for the shape of the video —
              not pasted into a template.
            </p>
          </div>

          <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {LANDING_FORMATS.map((format) => (
              <li
                key={format.kind}
                className="brutal-border brutal-shadow brutal-hover flex flex-col gap-3 rounded-2xl bg-card p-5"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-lg font-extrabold tracking-tight text-foreground">
                    {format.label}
                  </h3>
                  {/* Shown rather than hidden, and labelled honestly — see
                      CREATABLE_PROJECT_KINDS. */}
                  {"comingSoon" in format && format.comingSoon ? (
                    <span className="brutal-border-thin rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">
                      Soon
                    </span>
                  ) : null}
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {format.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section
        id="how-it-works"
        className="scroll-mt-20 border-t-2 border-border py-20 md:py-28"
      >
        <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-accent">
              How it works
            </p>
            <h2 className="mt-3 font-display text-3xl font-medium leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
              From what you have to a finished video
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Every project moves through the same steps, in this order — each
              one picks up where the last finished, and you can change anything
              before the next one runs.
            </p>

            {/* THE_FLOW_IS_AN_ORDER: rendered straight off PROJECT_FLOW_STEPS,
                the same list the in-app project nav renders, so the walkthrough
                sold here is the walkthrough shipped. */}
            <ol className="mt-10 flex flex-col gap-8">
              {PROJECT_FLOW_STEPS.map((step, index) => {
                const Icon = step.icon;

                return (
                  <li key={step.key} className="flex gap-5">
                    <span className="brutal-border flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-accent font-display text-lg font-black text-brand-accent-foreground">
                      {index + 1}
                    </span>
                    <div className="flex flex-col gap-1">
                      <h3 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-foreground">
                        <Icon
                          className="size-4 text-brand"
                          aria-hidden="true"
                        />
                        {step.label}
                      </h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {STEP_BLURBS[step.key] ?? ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <aside className="brutal-border brutal-shadow self-start rounded-2xl bg-card p-7">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-accent">
              Handled for you
            </p>
            <ul className="mt-5 divide-y divide-border">
              {HANDLED_FOR_YOU.map((row) => (
                <li key={row.label} className="flex gap-4 py-3.5">
                  <span className="w-24 shrink-0 text-sm font-extrabold text-foreground">
                    {row.label}
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {row.detail}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section
        id="features"
        className="scroll-mt-20 border-t-2 border-border py-20 md:py-28"
      >
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-accent">
              What you get
            </p>
            <h2 className="mt-3 font-display text-3xl font-medium leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
              The tools that make it look deliberate
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {`The formats and tools ${APP_NAME} ships with. Which of them your workspace can reach depends on your plan.`}
            </p>
          </div>

          <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {LANDING_FEATURE_KEYS.map((key) => {
              /* COPY_IS_REGISTRY_DERIVED — the gate's own words, not ours. */
              const definition = RESOURCES[key];

              return (
                <li
                  key={key}
                  className="brutal-border brutal-shadow brutal-hover flex flex-col gap-2.5 rounded-2xl bg-card p-5"
                >
                  <span className="brutal-border flex size-5 items-center justify-center rounded-md bg-brand">
                    <CheckIcon
                      className="size-3 text-brand-foreground"
                      strokeWidth={3}
                      aria-hidden="true"
                    />
                  </span>
                  <h3 className="font-display text-base font-extrabold tracking-tight text-foreground">
                    {definition.name}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {definition.description}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ── Plans ────────────────────────────────────────────────────────── */}
      <section className="border-t-2 border-border py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-accent">
              Simple pricing
            </p>
            <h2 className="mt-3 font-display text-3xl font-medium leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
              Pick your plan
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Every plan includes the whole pipeline. They differ in how much
              you can hold and how much you can make.
            </p>
          </div>

          {/* PRICING_IS_REGISTRY_DERIVED. Amounts are deliberately absent —
              AMOUNTS_LIVE_IN_STRIPE, so the figure is stated at checkout and
              the full comparison lives on /pricing. */}
          {/* Four sold tiers today, so the grid goes 1 → 2 → 4 rather than
              stopping at 3 and stranding the last plan alone on its own row.
              `items-stretch` keeps the featured card's lift from shortening
              its neighbours. */}
          <ul className="mt-12 grid items-stretch gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {teaserPlans.map((plan) => {
              const definition = PLANS[plan];
              const isFeatured = plan === "pro";

              return (
                <li
                  key={plan}
                  className={cn(
                    "brutal-border brutal-shadow relative flex h-full flex-col gap-5 rounded-2xl bg-card p-6",
                    isFeatured &&
                      "brutal-shadow-brand border-brand/60 lg:-translate-y-2",
                  )}
                >
                  {isFeatured ? (
                    <span className="brutal-shadow-brand absolute left-1/2 -top-3.5 -translate-x-1/2 rounded-full bg-brand px-3.5 py-1 text-xs font-semibold text-brand-foreground">
                      Best value
                    </span>
                  ) : null}

                  <div className="flex flex-col gap-1.5">
                    <h3 className="font-display text-lg font-extrabold tracking-tight text-foreground">
                      {definition.name}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {definition.description}
                    </p>
                  </div>

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

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Prices are shown at checkout.{" "}
            <Link
              href="/pricing"
              className="font-semibold underline underline-offset-4 hover:text-foreground"
            >
              Compare every plan
            </Link>
            .
          </p>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section
        id="faq"
        className="scroll-mt-20 border-t-2 border-border bg-card py-20 md:py-28"
      >
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center">
            <h2 className="font-display text-3xl font-medium leading-tight tracking-tight text-foreground md:text-4xl">
              Got questions?
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              The ones people ask before they sign up, answered the way the
              product actually behaves.
            </p>
          </div>

          <FaqAccordion
            items={LANDING_FAQ}
            defaultOpenId={LANDING_FAQ[0]?.id}
            className="mt-12"
          />
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section className="border-t-2 border-border bg-card py-24 md:py-28">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 text-center">
          <h2 className="font-display text-4xl font-medium leading-[0.95] tracking-tight text-foreground md:text-5xl lg:text-6xl">
            Your next video starts with one sentence
          </h2>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
            Start a workspace, paste a link or a topic, and let the pipeline
            write, narrate, caption and render it.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href={AUTH_ROUTES.signUp}
              className={cn(buttonVariants({ size: "lg" }), PRIMARY_CTA)}
            >
              Get started
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href={AUTH_ROUTES.signIn}
              className={cn(
                buttonVariants({ variant: "ghost", size: "lg" }),
                "h-12 rounded-xl px-6 text-base font-bold",
              )}
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
