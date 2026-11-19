/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: DashboardHomeScreen, HOME_IS_A_FORMAT_PICKER,
 * FORMATS, FORMAT_CATEGORIES, FEATURED_FORMAT_KIND, COMPOSER_ROUTE,
 * FeatureGate, GREETING_IS_LOCAL, FILTER_IS_CLIENT_STATE,
 * DASHBOARD_ASSEMBLES, FILTER_IS_A_TRANSITION
 *
 * WHAT: The dashboard home screen — a greeting and credit balance, the
 * "What are you making?" headline, category filter chips, the
 * featured format, and the remaining formats grouped by category.
 *
 * WHY: HOME_IS_A_FORMAT_PICKER. The old home was a placeholder card telling
 * the operator to declare features in the registry. The question a
 * creator actually arrives with is "what am I making today", and every
 * answer on this screen starts the same mutation with a different
 * format preselected.
 *
 * IT OFFERS WHAT THIS APP CAN BUILD, not what the design drew. The
 * mockup shows studios this product does not have (Director, Marketing
 * Studio, Italian Brainrot). Rendering them would be advertising
 * vapour from inside a paid product. Instead every card is driven by
 * `FORMATS`, which is keyed by `ProjectKind` — so the picker and the
 * pipeline cannot disagree, and the day a kind is added its card
 * appears here with no edit to this file.
 *
 * FILTER_IS_CLIENT_STATE and nothing more: the chips re-filter an
 * array already in memory. No query, no URL param — this is a four
 * item list, and a round trip to narrow it would be slower than not
 * filtering at all. (If the catalogue ever grows past a screenful,
 * the chip state is the thing to lift into the URL.)
 *
 * GREETING_IS_LOCAL: computed from the BROWSER's clock in an effect,
 * not during render. The server renders in its own timezone, so
 * greeting someone "good evening" server-side is wrong for most of
 * the world and also a hydration mismatch. It starts empty and fills
 * in, which is why it is the one thing on the screen allowed to
 * appear a frame late.
 *
 * DASHBOARD_ASSEMBLES and FILTER_IS_A_TRANSITION: the screen rises in
 * reading order on mount (`.app-enter`), and the format region
 * re-plays that entrance whenever the filter changes (`.dash-enter`
 * on a wrapper keyed by `filter`). Both reuse the marketing hero's
 * keyframes and curve on a faster schedule — one product, one way of
 * arriving, said quickly on a screen somebody opens every day. The
 * delay schedule and the reduced-motion fallback live with the CSS in
 * globals.css.
 *
 * STARTING IS STILL GATED. Every CTA routes through one
 * <FeatureGate resource="projects">-wrapped handler, so a workspace at
 * its plan cap gets the upgrade modal instead of a form the server
 * would refuse — the same contract <CreateProjectButton> already has.
 *
 * WHERE: Rendered by src/app/(dashboard)/dashboard/page.tsx. Format content
 * comes from src/lib/config/formats.ts, colours from ./format-tokens,
 * the cards from ./format-card, and the create flow is the sheet the
 * projects page already uses.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, ZapIcon } from "lucide-react";

import {
  FEATURED_FORMAT_KIND,
  FORMAT_CATEGORIES,
  FORMATS,
  formatsByCategory,
  isStartableFormat,
  type FormatCategoryKey,
} from "@/lib/config";
import { permissions } from "@/lib/permissions";
/* THE_REGISTRY_OWNS_THE_PATH — the credits pill links where the sidebar
 * links, from the same declaration. See THE_PILL_IS_THE_LINK below. */
import { RESOURCES } from "@/lib/resources";
import {
  PROJECT_KINDS,
  type ProjectKind,
} from "@/lib/types";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { trpc } from "@/trpc/react-provider";
import { FeatureGate } from "@/components/feature-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { HighlightHeading } from "@/components/global/highlight-heading";

import { FormatCard } from "./format-card";
import { CATEGORY_CLASSES } from "./format-tokens";

/** The chip row: "All formats" plus every category, in registry order. */
const CATEGORY_ORDER = Object.keys(FORMAT_CATEGORIES) as FormatCategoryKey[];

type Filter = "all" | FormatCategoryKey;

/**
 * SOURCE OF TRUTH KEYWORDS: localGreeting, serverGreeting, subscribeToNothing,
 * GREETING_IS_LOCAL
 *
 * WHAT: The three arguments `useSyncExternalStore` needs to read the
 * viewer's local time of day without a hydration mismatch.
 * WHY: The "store" never changes during a session, so `subscribe` returns
 * an unsubscribe and does nothing — the hook is being used for its
 * SERVER SNAPSHOT, not for its subscription. `localGreeting` returns
 * one of three interned strings, so successive calls compare equal
 * under Object.is and React does not loop.
 * Module scope, not inline: a `subscribe` identity that changes every
 * render makes the hook resubscribe on every render.
 * WHERE: DashboardHomeScreen above.
 */
function subscribeToNothing(): () => void {
  return () => {};
}

function localGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function serverGreeting(): string | null {
  return null;
}

export function DashboardHomeScreen() {
  const [filter, setFilter] = React.useState<Filter>("all");
  const router = useRouter();
  const { hasPermission } = useActiveOrganization();
  const canCreate = hasPermission(permissions.PROJECTS_CREATE);

  const { data: profile } = trpc.user.getProfile.useQuery();

  /* GREETING_IS_LOCAL — see the header. `useSyncExternalStore` rather than an
   * effect that calls setState: this is exactly the "value that differs
   * between server and client" case the hook exists for. The server snapshot
   * is null so the server HTML and the first client paint agree, and React
   * swaps in the real greeting during hydration without a cascading render.
   * A setState-in-effect would do the same thing a frame later and is what
   * react-hooks/set-state-in-effect flags. */
  const greeting = React.useSyncExternalStore(
    subscribeToNothing,
    localGreeting,
    serverGreeting,
  );

  /* THE PICKER NAVIGATES, it does not open a form in place. Describing a
   * video is the start of real work, so it gets its own URL
   * (COMPOSER_ROUTE) that can be linked, bookmarked and backed out of — none
   * of which a sheet over this screen could offer. The format rides along in
   * the query, where /dashboard/new validates it. */
  function handleStart(kind: ProjectKind) {
    if (!isStartableFormat(kind)) return;
    router.push(`/dashboard/new?kind=${kind}`);
  }

  const visibleKinds = PROJECT_KINDS.filter(
    (kind) => filter === "all" || FORMATS[kind].category === filter,
  );
  const featuredVisible = visibleKinds.includes(FEATURED_FORMAT_KIND);
  const gridKinds = visibleKinds.filter(
    (kind) => kind !== FEATURED_FORMAT_KIND,
  );

  return (
    <div className="flex flex-col gap-7">
      {/* DASHBOARD_ASSEMBLES — the screen's first half steps down in reading
          order (greeting, headline, chips). `.app-enter` wants the animated
          blocks as its DIRECT children, which is why this group is its own
          element rather than the class living on the root: the root also holds
          the format region below, and a region that animates itself while its
          children animate too is two entrances where there should be one. */}
      <div className="app-enter flex flex-col gap-7">
        <HomeHeader greeting={greeting} name={profile?.name ?? null} />

        <div>
          <HighlightHeading
            before="What are you"
            highlight="making"
            trailing="?"
            radius="xl"
            className="font-display text-[2.75rem] font-extrabold leading-none tracking-tight text-foreground lg:text-[3.25rem]"
          />
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Pick by what you&apos;re starting from. Every format writes its own
            script, casts a voice and captions itself.
          </p>
        </div>

        <CategoryChips value={filter} onChange={setFilter} />
      </div>

      {/* FILTER_IS_A_TRANSITION — `key={filter}` is the whole mechanism. The
          formats this region shows change the instant a chip is pressed, and
          they used to change in ONE FRAME: cards vanished and others appeared
          in their place with nothing in between, which is the jarring swap an
          animation actually exists to soften. Re-keying on the filter makes
          React remount the region, which replays `.dash-enter` from the top —
          no transition state to track, no AnimatePresence, and it stays on the
          compositor, which matters on a screen that animates while it is still
          hydrating.

          The remount is free here: everything below is derived from `filter`
          and the format registry, so there is no local state, no focus and no
          scroll position inside it for a remount to throw away. The pressed
          chip lives ABOVE this boundary and keeps its focus ring. */}
      <div key={filter} className="dash-enter flex flex-col gap-7">
        {featuredVisible ? (
          <FeaturedFormat
            kind={FEATURED_FORMAT_KIND}
            canCreate={canCreate}
            onStart={handleStart}
          />
        ) : null}

        {CATEGORY_ORDER.map((category) => {
          const kinds = formatsByCategory(category).filter((kind) =>
            gridKinds.includes(kind),
          );
          if (kinds.length === 0) return null;
          const classes = CATEGORY_CLASSES[category];

          return (
            <section key={category} className="flex flex-col gap-3.5">
              <h2 className="mt-2 flex items-center gap-2.5 text-lg font-bold text-foreground">
                <span
                  aria-hidden="true"
                  className={cn("size-2.5 rounded-[3px]", classes.dot)}
                />
                {FORMAT_CATEGORIES[category].label}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {kinds.map((kind) => (
                  <FormatCard key={kind} kind={kind} onStart={handleStart} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: HomeHeader, CREDITS_PILL, PERMISSION_GATED_READ,
 * THE_PILL_IS_THE_LINK, THE_CHROME_OUTLIVES_THE_NUMBER, TABULAR_FIGURES
 *
 * WHAT: The thin row above the headline — who is being greeted, and what
 * they have left to spend.
 * WHY: PERMISSION_GATED_READ: the balance query needs `credits:read`, so a
 * member without it sees the greeting alone rather than a pill that
 * can only ever render an error. The pill is a LINK to the credits
 * screen — a number a creator watches go down is one they will want to
 * act on, and making them hunt for the page is the whole friction.
 * WHERE: The top of the home screen.
 */
function HomeHeader({
  greeting,
  name,
}: {
  greeting: string | null;
  name: string | null;
}) {
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const canReadCredits = hasPermission(permissions.CREDITS_READ);

  const { data: credits } = trpc.credits.getBalance.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled: organizationId !== undefined && canReadCredits,
      staleTime: 60 * 1000,
    },
  );

  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      {/* min-h holds the row's height while the greeting resolves, so the
          headline below does not shift down a frame after mount. */}
      <p className="min-h-6 text-sm text-muted-foreground">
        {greeting ? (
          <>
            {greeting}
            {name ? (
              <>
                , <span className="font-medium text-foreground">{name}</span>
              </>
            ) : null}
          </>
        ) : null}
      </p>

      {/* THE_PILL_IS_THE_LINK — it was a <span>, while the comment above this
          component had already promised a link to the credits screen. It wears
          `tactile-raised`, a border and a 44px height, so it READS as
          pressable; a surface that looks like a control and does nothing is
          worse than no control at all. `brutal-hover` supplies the pair the
          rest of the app uses — a 1px lift on a real pointer, a 1px press —
          and does it for an <a> by its own selector.

          The href comes from the RESOURCES registry, not a literal: the same
          declaration that puts Credits in the sidebar and gates it behind
          `credits:read` is the one that says where it lives, so the pill
          cannot drift from the nav the day that path changes.

          THE_CHROME_OUTLIVES_THE_NUMBER. The loading state used to be a
          Skeleton standing in for the WHOLE pill — a 128px rounded block
          replaced in one frame by a ~150px pill, so the row jumped twice,
          once in content and once in geometry, and `justify-between` passed
          the shift along to the greeting. Only the BALANCE is unknown on
          first paint; the border, the icon and the word "credits" are known
          immediately. So the pill renders whole and the skeleton shrinks to
          the width of the digits inside it. Nothing moves when the number
          lands, which is why no crossfade is needed here.

          TABULAR_FIGURES — the balance is the one number on this screen a
          creator watches go DOWN, and proportional digits change width as it
          does (1,200 → 980 is narrower). `tabular-nums` fixes the advance
          width so a spend cannot nudge the layout. */}
      {canReadCredits ? (
        <Link
          href={RESOURCES.credits.nav.href}
          className="tactile-raised brutal-hover inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-foreground outline-none focus-ring"
        >
          <ZapIcon className="size-4 text-brand-accent" aria-hidden="true" />
          {credits ? (
            <span>
              <span className="tabular-nums">
                {credits.balance.toLocaleString()}
              </span>{" "}
              credits
            </span>
          ) : (
            <>
              <Skeleton className="h-3.5 w-10 rounded-sm" />
              <span className="sr-only">Loading credit balance</span>
              <span aria-hidden="true">credits</span>
            </>
          )}
        </Link>
      ) : null}
    </header>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: CategoryChips, FILTER_IS_CLIENT_STATE, radiogroup
 *
 * WHAT: The "All formats / Explain / Entertain / …" filter row.
 * WHY: A `radiogroup` of buttons, not a tablist: these select the MEANING
 * of one list rather than swapping panels, and nothing appears in
 * place when one is pressed. Same call, and the same reasoning, as the
 * landing page's hero mode tabs.
 * Categories with no format in them are not rendered at all — a chip
 * that can only ever produce an empty screen is a dead control, and
 * this app has no Market or Music formats today.
 * WHERE: Between the headline and the featured panel.
 */
function CategoryChips({
  value,
  onChange,
}: {
  value: Filter;
  onChange: (next: Filter) => void;
}) {
  const populated = CATEGORY_ORDER.filter(
    (category) => formatsByCategory(category).length > 0,
  );

  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: "All formats" },
    ...populated.map((category) => ({
      id: category,
      label: FORMAT_CATEGORIES[category].label,
    })),
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Filter formats"
      className="flex flex-wrap gap-2"
    >
      {chips.map((chip) => {
        const active = chip.id === value;
        const dot = chip.id === "all" ? null : CATEGORY_CLASSES[chip.id].dot;

        return (
          <button
            key={chip.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(chip.id)}
            className={cn(
              "tactile-control inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium outline-none transition-colors focus-ring motion-reduce:transition-none",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border-strong bg-transparent text-foreground-2 hover:text-foreground",
            )}
          >
            {dot ? (
              <span
                aria-hidden="true"
                className={cn("size-2 rounded-[2px]", dot)}
              />
            ) : null}
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: FeaturedFormat, FEATURED_FORMAT_KIND,
 * CTA_IS_LARGE_TEXT, FeatureGate, PRESS_IS_THE_APP_LANGUAGE
 *
 * WHAT: The large panel for the one format the product is pushing.
 * WHY: CTA_IS_LARGE_TEXT — the button is 18px/700, which is what keeps
 * white on the brand orange inside WCAG's large-text allowance (see
 * CONTRAST_DEBT in globals.css). Shrinking this label is the one
 * change here that would break accessibility rather than just looks.
 * The CTA is wrapped in <FeatureGate> so a workspace at its project
 * cap meets the upgrade modal instead of the create form.
 * WHERE: Between the chips and the category sections.
 */
function FeaturedFormat({
  kind,
  canCreate,
  onStart,
}: {
  kind: ProjectKind;
  canCreate: boolean;
  onStart: (kind: ProjectKind) => void;
}) {
  const format = FORMATS[kind];
  const classes = CATEGORY_CLASSES[format.category];

  return (
    <section
      aria-labelledby="featured-format"
      className="tactile-raised flex flex-wrap items-center gap-8 rounded-[26px] border border-border bg-card p-8"
    >
      <div className="flex min-w-0 flex-1 basis-[360px] flex-col gap-3.5">
        <div className="flex flex-wrap gap-2">
          <span
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-xs font-bold tracking-[0.08em]",
              classes.media,
            )}
          >
            {format.eyebrow}
          </span>
        </div>

        <h2
          id="featured-format"
          className="mt-1 font-display text-[2.5rem] font-extrabold leading-none tracking-tight text-foreground"
        >
          {format.label}
        </h2>

        <p className="max-w-md text-base leading-relaxed text-foreground-2">
          {format.description}
        </p>

        <div className="flex flex-wrap gap-2 text-[13px] text-foreground-2">
          <span className="rounded-full border border-border-strong px-3 py-1.5">
            9:16 or 16:9
          </span>
          <span className="rounded-full border border-border-strong px-3 py-1.5">
            Voice + captions
          </span>
          <span className="rounded-full border border-border-strong px-3 py-1.5">
            {format.from}
          </span>
        </div>

        {canCreate ? (
          <div className="mt-2">
            <FeatureGate resource="projects">
              {/* PRESS_IS_THE_APP_LANGUAGE. This is the highest-intent
                  control on the screen and it was the one that answered
                  nothing: no `:active`, and `hover:bg-brand/90` with no
                  transition declared, so the brand orange snapped.

                  The transition list, the 160ms, the curve and the 1px press
                  are copied from <Button>'s base class rather than chosen
                  again here. This button is hand-rolled because of
                  CTA_IS_LARGE_TEXT — 18px/700 is what keeps white on the
                  brand orange inside WCAG's large-text allowance, which the
                  `lg` variant does not give — but being hand-rolled is a
                  reason to restate the app's press language verbatim, not a
                  licence to invent a second one. A creator who presses this
                  and presses a <Button> should feel the same button.

                  `box-shadow` is in the list for `brutal-shadow-brand`'s
                  brand glow, which is the thing that should settle the day
                  this button gains a hover shadow. */}
              <button
                type="button"
                onClick={() => onStart(kind)}
                className="brutal-shadow-brand inline-flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-2xl bg-brand px-[22px] text-lg font-bold text-brand-foreground outline-none transition-[transform,background-color,box-shadow] duration-[160ms] ease-[var(--ease-settle)] hover:bg-brand/90 active:translate-y-px focus-ring motion-reduce:transition-none"
              >
                {format.cta}
                <ArrowRightIcon className="size-[18px]" aria-hidden="true" />
              </button>
            </FeatureGate>
          </div>
        ) : null}
      </div>

      {/* The two tilted preview cards. Decoration — they are a picture of the
          output, and everything they say is already in the copy beside
          them. */}
      <div
        aria-hidden="true"
        className="hidden shrink-0 items-end gap-3.5 lg:flex"
      >
        <div className="tactile-raised flex h-[266px] w-[150px] -rotate-6 translate-y-2.5 flex-col justify-between rounded-[20px] border border-border-strong bg-secondary p-4">
          <div className="flex flex-col gap-1.5">
            <span className="h-2 w-[70%] rounded-sm bg-border-strong" />
            <span className="h-2 w-[45%] rounded-sm bg-border-strong" />
          </div>
          <div className="flex h-[90px] items-end gap-1.5">
            <span className="h-[35%] flex-1 rounded-md bg-cat-explain" />
            <span className="h-[60%] flex-1 rounded-md bg-cat-entertain" />
            <span className="h-full flex-1 rounded-md bg-brand-accent" />
          </div>
          <span className="font-display text-xl font-extrabold leading-none text-foreground">
            Growth, explained
          </span>
        </div>

        <div className="brutal-shadow-lg flex h-[312px] w-44 flex-col justify-between rounded-[22px] bg-foreground p-[18px]">
          <span className="self-start rounded-full border-[1.5px] border-background px-2.5 py-0.5 text-[11px] font-bold tracking-[0.08em] text-background">
            PART 2
          </span>
          <div>
            <div className="font-display text-3xl font-extrabold leading-[0.95] tracking-tight text-background">
              COMPRESSION
            </div>
            <div className="mt-2.5 h-[3px] w-16 bg-brand" />
          </div>
          <span className="self-center rounded-md bg-background px-2.5 py-1 text-xs font-bold text-foreground">
            difference <span className="text-brand-accent">between</span>
          </span>
        </div>
      </div>
    </section>
  );
}
