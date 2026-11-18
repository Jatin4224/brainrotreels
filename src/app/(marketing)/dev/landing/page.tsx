/**
 * SOURCE OF TRUTH KEYWORDS: LandingFixtureRoute, resolveLandingData,
 *   LandingDataToggle, DEV_ONLY_FIXTURE, PROD_RETURNS_404
 *
 * WHAT:  /dev/landing — the landing page rendered against a chosen fixture,
 *        with a segmented control to flip between them.
 *
 * WHY:   The worst case has to enter through the SAME boundary the real data
 *        does, which is LandingPage's `data` prop — so this route renders the
 *        real page component, not a copy of it. A copy would drift, and then
 *        the thing under test would no longer be the thing that ships.
 *
 *        PROD_RETURNS_404. The guard is the first statement: a deployment
 *        must not expose a page that advertises "CHF 1299" and a plan called
 *        "Professional (Team)". It is also why `/` itself takes no
 *        searchParams — reading them there would opt the real landing page
 *        into dynamic rendering, trading its prerender for a dev affordance.
 * WHERE: src/app/(marketing)/page.tsx (the component), ../_components/
 *        landing-fixtures.ts (the data).
 */

import { notFound } from "next/navigation";

import LandingPage from "../../page";
import { LandingDataToggle } from "../../_components/landing-data-toggle";
import { resolveLandingData } from "../../_components/landing-fixtures";

export default async function LandingFixtureRoute({
  searchParams,
}: {
  searchParams: Promise<{ data?: string | string[] }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const requested = Array.isArray(params.data) ? params.data[0] : params.data;
  const { variant, data } = resolveLandingData(requested);

  return (
    <>
      <LandingPage data={data} />
      <LandingDataToggle active={variant} />
    </>
  );
}
