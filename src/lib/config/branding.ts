/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: APP_NAME, APP_DESCRIPTION, APP_URL,
 *   APP_METADATA_BASE, APP_DOMAIN, BRANDING
 *
 * WHAT:  Public app identity strings + URL primitives plus the consolidated
 *        BRANDING object (upgrade-modal copy, metadata base).
 * WHY:   One file resolves env-driven branding so the rest of the app reads
 *        constants, not `process.env`, keeping client/server output stable.
 *        BRANDING holds visual / textual identity ONLY — no routes or
 *        redirect targets. Sign-in route lives in AUTH_ROUTES
 *        (src/lib/config/auth-routes.ts); product nav routes live on the
 *        corresponding RESOURCES entry's `nav.href`.
 * WHERE: Re-exported from src/lib/config/index.ts; consumed by metadata,
 *        layouts, auth.ts, and the upgrade-modal UI.
 */

export const APP_NAME = process.env["NEXT_PUBLIC_APP_NAME"] ?? "My App";

export const APP_DESCRIPTION =
  process.env["NEXT_PUBLIC_APP_DESCRIPTION"] ??
  `${APP_NAME} — multi-tenant SaaS.`;

export const APP_URL =
  process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";

export const APP_METADATA_BASE = (() => {
  try {
    return new URL(APP_URL);
  } catch {
    return new URL("http://localhost:3000");
  }
})();

export const APP_DOMAIN = APP_METADATA_BASE.hostname;

/**
 * SOURCE OF TRUTH KEYWORDS: BRANDING
 *
 * WHAT:  Aggregated branding object exposing the resolved names, URLs, and
 *        every string the upgrade modal renders — per-scenario headers, step
 *        titles, success copy, and the templates getUpgradeMessage falls back
 *        to.
 * WHY:   One frozen record so UI surfaces never reach into env or duplicate
 *        copy strings; {resourceName} placeholder is interpolated from
 *        RESOURCES[x].name at render time. Intentionally has NO `routes`
 *        field — routes are not branding (see file header).
 * WHERE: Consumed by upgrade modal copy and layout metadata.
 */
export const BRANDING = {
  appName: APP_NAME,
  appDescription: APP_DESCRIPTION,
  appUrl: APP_URL,
  appDomain: APP_DOMAIN,
  metadataBase: APP_METADATA_BASE,
  upgradeModal: {
    /* {resourceName} is interpolated from RESOURCES[x].name, {nextPlan} from
     * PLANS[getNextPlan(currentPlan)].name — see getUpgradeMessage in
     * src/lib/resources.ts, which is the only place these are resolved. */
    bodyTemplate:
      "You've hit your plan limit for {resourceName}. Upgrade your workspace to keep going.",
    genericBody:
      "You've hit your plan limit for this feature. Upgrade your workspace to keep going.",
    /* Fallback for a FLAG resource that doesn't write its own upgradeMessage. */
    flagMessageTemplate: "Upgrade to {nextPlan} to unlock {resourceName}",
    /* Used when the organization is already on the top plan, where naming a
     * next plan would be a lie. */
    topOfLadderBody:
      "You're on our highest plan. Contact us and we'll raise this limit for you.",
    primaryCtaLabel: "View plans",
    secondaryCtaLabel: "Maybe later",
    /* SOURCE OF TRUTH KEYWORDS: UPGRADE_SCENARIO_COPY, UserScenario
     * Header copy per situation the user is actually in. Keyed by the
     * UserScenario the modal derives from the current tier + trial state, so
     * the same component greets a free user, a trialing user and a paying user
     * differently without any of them reading a sentence written for someone
     * else. */
    scenarios: {
      free_to_trial: {
        title: "Start your free trial",
        description:
          "Choose a plan and start your free trial. No charges until it ends.",
        ctaLabel: "Start free trial",
      },
      free_to_paid: {
        title: "Upgrade your plan",
        description:
          "Unlock higher limits and the features your team is asking for.",
        ctaLabel: "Upgrade now",
      },
      trial_to_paid: {
        title: "Complete your subscription",
        description:
          "Keep everything you have been using after your trial ends.",
        ctaLabel: "Complete subscription",
      },
      paid_upgrade: {
        title: "Upgrade your plan",
        description: "More room, more features — effective immediately.",
        ctaLabel: "Upgrade plan",
      },
      paid_downgrade: {
        title: "Change your plan",
        description:
          "Move to a smaller plan. Proration is handled automatically.",
        ctaLabel: "Change plan",
      },
      paid_same: {
        title: "Change billing interval",
        description: "Switch between monthly and yearly billing.",
        ctaLabel: "Update billing",
      },
    },
    /* Step + state copy that isn't scenario-dependent. */
    comparisonTitle: "Compare plans & features",
    paymentTitle: "Payment details",
    successTitle: "Welcome to {planName}",
    successBody:
      "Your upgrade is complete. Everything is unlocked — let's get going.",
    successDowngradeBody:
      "Your plan has been updated. The change is reflected on your next invoice.",
    successTrialBody:
      "Your subscription is active. Nothing changes for you except the invoice.",
    /* Shown instead of the CTA to a member who cannot buy — billing permissions
     * are the server's call, so the UI states the fact rather than failing. */
    noBillingPermissionBody:
      "Ask an owner or an admin with billing access to upgrade this workspace.",
  },
  /**
   * SOURCE OF TRUTH KEYWORDS: UPGRADE_NUDGE_COPY, useUpgradeNudge,
   *   SidebarUpgradeNudge
   *
   * WHAT:  The one-line nudge that sits above the profile in the sidebar.
   * WHY:   Two shapes, because two situations deserve different volume. Someone
   *        who has never paid — free plan, or mid-trial — gets a CARD: the
   *        product they are being sold is the thing they have not decided on
   *        yet, so it earns a section with a button. Someone who already pays
   *        gets one muted LINE: they have decided, and a permanent advert aimed
   *        at an existing customer is the fastest way to teach them to ignore
   *        that corner of the screen.
   *        Kept here rather than in the component so the tone is an operator
   *        decision: this is the app's most persistent piece of sales copy, and
   *        the right pitch differs by product.
   *        {targetPlan} and {amount} are interpolated from the plan ladder and
   *        the provider's own prices, never written into the string. Note
   *        targetPlan is the plan being SOLD, which is the next tier up from a
   *        free plan but the SAME plan during its trial — a Pro trial converts
   *        to Pro, it does not jump to Enterprise.
   */
  upgradeNudge: {
    /* CARD variant — a free plan or a running trial, where the user has not
     * bought anything yet and the whole product is still on the other side of a
     * decision. Worth a section with a button. */
    currentPlanLabel: "Current plan:",
    /* Appended to the plan name while trialing — "Pro trial". */
    trialPlanSuffix: "trial",
    cardBody:
      "Upgrade to {targetPlan} to get the latest and exclusive features",
    cardCtaLabel: "Upgrade to {targetPlan}",
    /* INLINE variant — the customer already pays; this is a nudge between
     * plans or between billing periods, so it stays a single muted line. */
    tierBody: "More room on {targetPlan}",
    yearlyBody: "Save {amount} a year on yearly",
    ariaLabel: "View plans and upgrade",
  },
} as const;
