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

import Image from "next/image";
import Link from "next/link";
import { ArrowRightIcon, PlayIcon } from "lucide-react";

/* Leaf import, not the barrel: `@/components/global/project-steps` also
 * exports the ProjectSteps client component, and this page needs only the
 * plain step data — the same reason proxy.ts imports request-id directly. */
import { PROJECT_FLOW_STEPS } from "@/components/global/project-steps/steps";
import { FaqAccordion } from "@/components/global/faq-accordion";
import { buttonVariants } from "@/components/ui/button";
import { AUTH_ROUTES } from "@/lib/config/auth-routes";
import { APP_NAME } from "@/lib/config/branding";
import {
  PLANS,
  PLAN_ORDER,
  PLAN_PRICE_CURRENCY_SYMBOL,
} from "@/lib/config/plans";
import { RESOURCES, getEntryPlanForResource } from "@/lib/resources";
import { cn } from "@/lib/utils";
import { HighlightHeading } from "@/components/global/highlight-heading";

import {
  HANDLED_FOR_YOU,
  HERO_COPY,
  HeroPromptCard,
  LANDING_FAQ,
  LANDING_FEATURE_KEYS,
  FORMAT_CARD_ART,
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
  "brutal-shadow-brand group h-12 rounded-xl bg-brand px-6 text-base font-bold text-brand-foreground hover:bg-brand/90";

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
        <div className="safe-x mx-auto max-w-[1240px] pb-20 pt-16 md:pt-24">
          {/* 1.05fr / 1fr at 900px and up — the text column is given the extra
              fraction because it carries the headline, the field and the
              proof line, while the stage is a fixed-size object that does not
              benefit from more room. Below 900px the phones stack under the
              words: there is no width at which two columns of this fit. */}
          {/* The column gap widens once there is room for it: at 1240px and
              up the words and the phone are two separate objects and 40px
              reads as a seam between them, not a gap. Below that the stage is
              already overflowing its column and extra gap only squeezes the
              headline. */}
          <div className="grid items-center gap-10 min-[900px]:grid-cols-[1.05fr_1fr] min-[1240px]:gap-16">
            {/* hero-enter owns the one page-load sequence: its children rise
                and fade in reading order, delays set by nth-child in
                globals.css so this markup stays a plain column. */}
            <div className="hero-enter flex flex-col items-start text-left">
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
              className="hero-stage-enter"
            />
          </div>

          {/* proof-enter is the TAIL of the hero sequence, not a second one —
              see the class in globals.css. It lands on the <ul>, whose
              children are the five cards the delays step through. */}
          <ProofStrip
            clips={LANDING_PROOF_CLIPS}
            className="proof-enter mt-20"
          />
        </div>
      </section>

      {/* ── Formats ──────────────────────────────────────────────────────── */}
      <section
        id="formats"
        className="scroll-mt-20 border-t-2 border-border py-16 md:py-24"
      >
        <div className="safe-x mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-3xl font-medium leading-tight tracking-tight text-balance text-foreground md:text-4xl lg:text-5xl">
              Four ways to start, one finished video
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">
              Pick the format that fits what you already have. Each one has its
              own writer, so the script is built for the shape of the video —
              not pasted into a template.
            </p>
          </div>

          <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {LANDING_FORMATS.map((format) => {
              /* FORMAT_CARD_ART, not the proof strip's posters: the strip
                 shows what the product HAS MADE, these show what each
                 format IS. Absent art renders the card text-only. */
              const poster = FORMAT_CARD_ART[format.kind];

              return (
                <li
                  key={format.kind}
                  className="brutal-border brutal-shadow brutal-hover flex flex-col overflow-hidden rounded-2xl bg-card"
                >
                  {/* 16:10 AND TOP-ANCHORED. These stills are purpose-made
                      at 1215x762, so the box matches the file and nothing is
                      cropped by accident; object-top is the insurance, since
                      every one of them carries its headline in the upper
                      half and a nudge to the aspect must eat the bottom.

                      Landscape on purpose, against a product that makes
                      9:16: the proof strip above is already a row of whole
                      verticals, and a second row of them here would read as
                      the same row twice. A wide still of the same work is a
                      different object on the page. */}
                  {poster === undefined ? null : (
                    <div className="relative aspect-[16/10] overflow-hidden border-b border-border bg-secondary">
                      {/* next/image here and a plain <img> in ProofStrip, and
                          the difference is ownership: a proof clip poster is
                          OPERATOR-supplied and may be off-domain, which
                          next/image refuses without a per-deployment
                          `remotePatterns` entry. These four ship in this repo,
                          so there is nothing to configure and no reason to
                          decline the resizing and the modern formats.

                          `sizes` is measured, not guessed: the grid is 4-up
                          from lg (~288px), 2-up from sm, one card wide below
                          that. Without it Next hands a phone the 1215px source
                          for a 342px box.

                          alt="" — the heading beside it names the format, so a
                          screen reader announcing the still as well is noise.
                          No `priority`: this sits below the fold. */}
                      <Image
                        src={poster}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 288px, (min-width: 640px) 50vw, 100vw"
                        className="object-cover object-top"
                      />
                    </div>
                  )}

                  <div className="flex flex-1 flex-col gap-3 p-5">
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
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section
        id="how-it-works"
        className="scroll-mt-20 border-t-2 border-border py-20 md:py-28"
      >
        <div className="safe-x mx-auto max-w-7xl">
          {/* Lifted OUT of the left grid column. Every other section opens
              with a centred intro above its content, and a heading centred
              inside one half of a two-column grid is centred on nothing a
              reader can see — it just looks misplaced. Above the grid it
              centres on the section, like the rest of the page. */}
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-3xl font-medium leading-tight tracking-tight text-balance text-foreground md:text-4xl lg:text-5xl">
              From what you have to a finished video
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">
              Every project moves through the same steps, in this order — each
              one picks up where the last finished, and you can change anything
              before the next one runs.
            </p>
          </div>

          <div className="mt-12 grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              {/* THE_FLOW_IS_AN_ORDER: rendered straight off PROJECT_FLOW_STEPS,
                  the same list the in-app project nav renders, so the walkthrough
                  sold here is the walkthrough shipped. */}
              {/* No top margin. The aside beside this list starts at the
                  grid's top edge, so an mt-10 here put the first step 40px
                  below the card it is paired with — two columns that read as
                  a pair, misaligned by exactly the margin. */}
              <ol className="flex flex-col gap-8">
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

            {/* THE_CARD_FILLS_ITS_COLUMN. This was `self-start`, so a
                460px card sat beside a 600px list and left most of the
                section's bottom-right quadrant as empty black — the one
                place on the page that read as unfinished rather than quiet.
                Stretching it is not enough on its own (a tall card with its
                content bunched at the top is worse), so the rows below grow
                with it: each one takes an equal share of the extra height
                and centres its text in that share, which keeps the hairline
                dividers evenly spaced instead of crowding the text.
                lg-only — in the single-column stack there is no second
                column to match. */}
            <aside className="brutal-border brutal-shadow rounded-2xl bg-card p-7 lg:flex lg:flex-col">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-accent">
                Handled for you
              </p>
              <ul className="mt-5 divide-y divide-border lg:flex lg:flex-1 lg:flex-col">
                {HANDLED_FOR_YOU.map((row) => (
                  <li
                    key={row.label}
                    className="flex gap-4 py-3.5 lg:flex-1 lg:items-center"
                  >
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
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      {/* ONE_BAND_BREAKS_THE_SLABS. Formats, this section and Plans were
          three consecutive repeats of ONE shape — centred heading, muted
          subhead, grid of bordered rounded cards — sixteen near-identical
          cards between the hero and the FAQ. No single card was wrong; the
          REPETITION was, and that is what makes a page read as generated
          rather than designed.

          So this one is the page's band: it runs edge to edge on `bg-card`
          (the section is full-width, only its contents are held at
          max-w-7xl), its heading is LEFT-aligned and sticks beside the list
          instead of sitting centred above it, and the eight features are
          rows on hairlines rather than eight boxes. Same eight facts, a
          shape the reader has not already seen twice.

          border-y-2 and the neighbouring Plans section drops its border-t:
          two adjacent 2px borders would stack into a 4px line. */}
      <section
        id="features"
        className="scroll-mt-20 border-y-2 border-border bg-card py-20 md:py-28"
      >
        <div className="safe-x mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-16">
            {/* Sticky, so the claim stays on screen while the list of what
                backs it scrolls past. top-24 clears the 56px sticky header
                with room to spare. */}
            <div className="lg:sticky lg:top-24 lg:self-start">
              <h2 className="font-display text-3xl font-medium leading-tight tracking-tight text-balance text-foreground md:text-4xl lg:text-5xl">
                The tools that make it look deliberate
              </h2>
              <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">
                {`The formats and tools ${APP_NAME} ships with. Which of them your workspace can reach depends on your plan.`}
              </p>
            </div>

            <ul className="divide-y divide-border border-t border-border">
              {LANDING_FEATURE_KEYS.map((key) => {
                /* COPY_IS_REGISTRY_DERIVED — the gate's own words, not ours. */
                const definition = RESOURCES[key];
                /* A_GATE_IS_NOT_A_TICK. Every card used to wear the same brand
                 tick directly under a sentence saying reach depends on the
                 plan — a tick reads as INCLUDED, so the grid promised eight
                 things the pricing section then took back. Three of these
                 eight are not plan-gated at all, three need Starter and two
                 need Pro, and the badge is the only thing that says so.
                 null means the entry plan already reaches it, so an absent
                 badge is itself the claim "everyone gets this". */
                const entryPlan = getEntryPlanForResource(key);

                return (
                  /* A row, not a card. The name column is fixed so eight names
                   form a readable left edge; the badge is pushed to the far
                   right where the eye can scan which rows carry a condition
                   without reading any of them. */
                  <li
                    key={key}
                    className="grid gap-x-6 gap-y-1.5 py-5 sm:grid-cols-[minmax(0,11rem)_1fr_auto] sm:items-baseline"
                  >
                    <h3 className="font-display text-base font-extrabold tracking-tight text-foreground">
                      {definition.name}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {definition.description}
                    </p>
                    {/* A_GATE_IS_NOT_A_TICK, unchanged: quiet rather than
                      brand-filled, because it is a condition on the feature
                      and not an action to take. An absent badge is itself
                      the claim "everyone gets this". */}
                    {entryPlan === null ? null : (
                      <span className="w-fit whitespace-nowrap rounded-full border border-border bg-surface-raised px-2.5 py-1 text-xs font-semibold text-muted-foreground sm:justify-self-end">
                        {`${PLANS[entryPlan].name} and up`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Plans ────────────────────────────────────────────────────────── */}
      {/* No border-t: the features band above closes with border-y-2, and two
          2px borders meeting would read as one 4px line. */}
      <section className="py-16 md:py-24">
        <div className="safe-x mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-3xl font-medium leading-tight tracking-tight text-balance text-foreground md:text-4xl lg:text-5xl">
              Pick your plan
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">
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

                  {/* A NUMBER, not "see checkout". Four plans with no figure
                      on them asked a visitor to start a signup to learn the
                      price, which is where most of them stopped. `free` shows
                      the word rather than "$0" — zero priced like a product
                      reads as a discount on something, not as free. */}
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
            Billed monthly. Cancel any time.{" "}
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
        <div className="safe-x mx-auto max-w-3xl">
          <div className="text-center">
            {/* lg:text-5xl like every other section heading. At 36px against
              their 48px it read as an oversight rather than as deliberate
              de-emphasis — too close to be a different size on purpose. */}
            <h2 className="font-display text-3xl font-medium leading-tight tracking-tight text-balance text-foreground md:text-4xl lg:text-5xl">
              Got questions?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">
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
        <div className="safe-x mx-auto flex max-w-4xl flex-col items-center gap-6 text-center">
          <h2 className="font-display text-4xl font-medium leading-[0.95] tracking-tight text-balance text-foreground md:text-5xl lg:text-6xl">
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
              <ArrowRightIcon
                /* pointer-fine: see the proof strip's note — group-hover
                   carries (hover: hover) but not (pointer: fine). */
                className="size-4 transition-transform duration-150 ease-[var(--ease-settle)] pointer-fine:group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                aria-hidden="true"
              />
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
