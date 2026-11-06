/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: LandingPage, HOME_IS_PUBLIC, COPY_IS_REGISTRY_DERIVED,
 *   PROJECT_FLOW_STEPS, RESOURCES, LANDING_FEATURE_KEYS, PUBLIC_PAGE_NO_AUTH,
 *   APP_DESCRIPTION, AUTH_ROUTES, METADATA_IS_INHERITED
 *
 * WHAT:  `/` — the public landing page. A hero, the pipeline a customer walks
 *        through, a short feature grid, and a closing call to action.
 *
 * WHY:   HOME_IS_PUBLIC. `/` used to be an auth probe that bounced an anonymous
 *        visitor to sign-in, because there was no landing page to show them.
 *        There is one now, so the root route belongs to the `(marketing)` group
 *        with pricing and legal: same shell, same header, same footer, and the
 *        signed-in path is a LINK to the dashboard rather than a redirect.
 *
 *        COPY_IS_REGISTRY_DERIVED, the same discipline the pricing page keeps
 *        (PRICING_IS_REGISTRY_DERIVED). The steps are `PROJECT_FLOW_STEPS` —
 *        the identical list the per-project nav renders — and the feature names
 *        and blurbs are read out of `RESOURCES`. The failure that prevents is a
 *        landing page advertising a step or a feature the product renamed or
 *        retired, which nothing in a build would catch if the words were typed
 *        here. `LANDING_FEATURE_KEYS` is typed `readonly ResourceKey[]`, so a
 *        retired resource fails the typecheck instead of shipping a promise the
 *        app no longer keeps. Only the hero headline is page-owned copy, and
 *        even its subhead is `APP_DESCRIPTION` — the operator's own tagline.
 *
 *        PUBLIC_PAGE_NO_AUTH — a Server Component with no tRPC call, no
 *        `headers()` and no cookie read, so it is cacheable and renders for
 *        somebody with no account. See NO_AUTH_IN_THIS_GROUP in the group
 *        layout; a single session read here would opt the whole group out.
 *
 *        METADATA_IS_INHERITED: no `metadata` export on purpose. The root
 *        layout's default title IS `BRANDING.appName` and its description IS
 *        `APP_DESCRIPTION`, which is exactly what this page wants — exporting
 *        them again would be a second copy of branding to keep in step.
 * WHERE: Rendered inside src/app/(marketing)/layout.tsx. Steps come from
 *        src/components/global/project-steps/steps.ts; features from
 *        src/lib/resources.ts; CTAs target AUTH_ROUTES.
 */

import Link from "next/link";

/* Leaf import, not the barrel: `@/components/global/project-steps` also
 * exports the ProjectSteps client component, and this page needs only the
 * plain step data — the same reason proxy.ts imports request-id directly. */
import { PROJECT_FLOW_STEPS } from "@/components/global/project-steps/steps";
import { SectionHeader } from "@/components/global/section-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AUTH_ROUTES } from "@/lib/config/auth-routes";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/config/branding";
import { RESOURCES, type ResourceKey } from "@/lib/resources";

/**
 * SOURCE OF TRUTH KEYWORDS: LANDING_FEATURE_KEYS, ResourceKey, RESOURCES,
 *   COPY_IS_REGISTRY_DERIVED
 *
 * WHAT:  Which registry entries the landing page puts in front of a visitor,
 *        in the order they appear.
 * WHY:   A CURATION, not a second definition — the names and the one-line
 *        descriptions still come from `RESOURCES`, so this list can only choose
 *        between things the product actually gates. Typed as `ResourceKey`, so
 *        renaming or retiring a resource breaks the build here rather than
 *        leaving an advert for a feature nobody can reach. Entries whose
 *        registry description is quota-phrased ("… per month") are left out:
 *        that sentence is written for a usage meter, not for somebody deciding.
 * WHERE: The feature grid below.
 */
const LANDING_FEATURE_KEYS: readonly ResourceKey[] = [
  "redditStories",
  "quizzes",
  "motionStudio",
  "premiumVoices",
  "captionStyles",
  "timelineEditor",
];

export default function LandingPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-20 px-4 py-16">
      <section className="flex flex-col items-center gap-6 text-center">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Short-form video, generated end to end.
        </h1>
        {/* The operator's own tagline — see METADATA_IS_INHERITED. */}
        <p className="max-w-xl text-base text-muted-foreground">
          {APP_DESCRIPTION}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href={AUTH_ROUTES.signUp}
            className={buttonVariants({ size: "lg" })}
          >
            Get started
          </Link>
          <Link
            href="/pricing"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            See pricing
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader
          title="How it works"
          description="Every project moves through the same steps, in this order — each one picks up where the last finished."
        />
        {/* THE_FLOW_IS_AN_ORDER: rendered straight off PROJECT_FLOW_STEPS, the
            same list the in-app project nav renders, so the walkthrough sold
            here is the walkthrough shipped. */}
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROJECT_FLOW_STEPS.map((step, index) => {
            const Icon = step.icon;

            return (
              <li
                key={step.key}
                className="flex items-start gap-3 rounded-lg border p-4"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">
                    Step {index + 1}
                  </span>
                  <span className="text-sm font-medium">{step.label}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader
          title="What you get"
          description={`The formats and tools ${APP_NAME} ships with. Which of them your workspace can reach depends on your plan.`}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LANDING_FEATURE_KEYS.map((key) => {
            /* COPY_IS_REGISTRY_DERIVED — the gate's own words, not ours. */
            const definition = RESOURCES[key];

            return (
              <Card key={key}>
                <CardHeader>
                  <CardTitle className="text-base">{definition.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {definition.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col items-center gap-4 rounded-lg border bg-card px-6 py-10 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Make your first video
        </h2>
        <p className="max-w-lg text-sm text-muted-foreground">
          Start a workspace, paste a link or a topic, and let the pipeline write,
          narrate, caption and render it.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href={AUTH_ROUTES.signUp} className={buttonVariants()}>
            Create an account
          </Link>
          <Link
            href={AUTH_ROUTES.signIn}
            className={buttonVariants({ variant: "ghost" })}
          >
            Sign in
          </Link>
        </div>
      </section>
    </div>
  );
}
