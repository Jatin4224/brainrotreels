/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: REQUIRED_ENV, RequiredEnvVar, EnvChecklistItem,
 *   getEnvChecklist, getMissingRequiredEnv, hasMissingRequiredEnv,
 *   OPTIONAL_ENV, OptionalEnvVar, OptionalEnvItem, getOptionalEnvChecklist
 *
 * WHAT:  Two lists: REQUIRED_ENV (the app CANNOT run without these) and
 *        OPTIONAL_ENV (fail-soft integrations like Stripe/Resend the app runs
 *        fine WITHOUT), plus helpers to check which are set.
 * WHY:   Drives the developer setup gate: the root layout renders a checklist
 *        instead of the app until every required var is present, so a fresh
 *        clone fails with clear instructions rather than a cryptic crash.
 *        Optional integrations NEVER block startup — they're surfaced on the
 *        same checklist purely as informational rows (purpose + how to enable)
 *        so a developer knows what's off and what turning it on unlocks.
 *        Only presence is checked and only labels/help/ok are exposed — secret
 *        VALUES are never read out, so nothing leaks to the client.
 * WHERE: Read by src/app/layout.tsx (the gate); rendered by
 *        src/components/global/setup-checklist.tsx.
 */

import { PLAN_ORDER, PLANS, isPaidPlan } from "./plans";
import { CREDIT_PACKS } from "@/lib/types/credits";
import { AUTH_PROVIDER } from "@/lib/adapters/provider";

export interface RequiredEnvVar {
  /** The process.env key that must be set. */
  key: string;
  /** Short human label for the checklist row. */
  label: string;
  /** One-line instruction telling the developer how to satisfy it. */
  help: string;
  /** Icon name resolved by the setup checklist (see its icon map). */
  icon: string;
  /**
   * Optional call-to-action link rendered under the help text — e.g. a
   * recommended provider to get the value from. `label` is the button text,
   * `url` opens in a new tab. Purely presentational (no secret), so it's safe
   * to expose to the client.
   */
  link?: { label: string; url: string };
  /**
   * Optional walkthrough video (e.g. a Loom) shown as a secondary CTA under the
   * help text. `label` overrides the default button text. Presentational only
   * (no secret), so it's safe to expose to the client.
   */
  video?: { url: string; label?: string };
  /**
   * Optional predicate that decides whether this var is required RIGHT NOW.
   * Omitted ⇒ always required. Returning false ⇒ the var is irrelevant given
   * the current config and is dropped from the checklist entirely (not shown,
   * not counted). This is how an opt-in feature (e.g. the portal) makes its
   * companion vars required only once the feature is turned on — so enabling
   * the feature without its config surfaces as an incomplete checklist item
   * instead of failing silently.
   */
  when?: () => boolean;
}

/* Edit this list to change what blocks startup. Keep it to the bare minimum —
 * anything that can fail soft belongs in its own config module, not here. A var
 * that only matters when a feature is enabled uses `when` so it's required
 * conditionally rather than always. */
export const REQUIRED_ENV: readonly RequiredEnvVar[] = [
  {
    key: "DATABASE_URL",
    label: "Database",
    help: "Set DATABASE_URL to your PostgreSQL connection URL, then run `npx prisma migrate dev` to create the tables.",
    icon: "Database",
    link: {
      label: "Get a free Postgres database at Neon",
      url: "https://neon.tech",
    },
  },
  {
    /* PROVIDER_ISOLATION: required only while Better Auth is the selected
     * provider. A provider that signs its own sessions has no use for this var,
     * so the predicate drops it from the checklist entirely rather than showing
     * it as an unmet requirement. */
    key: "BETTER_AUTH_SECRET",
    label: "Auth secret",
    help: "Set BETTER_AUTH_SECRET. Type this command in your mac terminal. It should give you a key: openssl rand -base64 32",
    icon: "KeyRound",
    when: () => AUTH_PROVIDER === "better-auth",
  },
  {
    /* Required only when the portal is turned on: without the owner email the
     * portal is on but no admin account is ever created, so no one can open
     * /portal — a silent, confusing dead end. */
    key: "PORTAL_INITIAL_OWNER_EMAIL",
    label: "Portal owner email",
    help: 'You turned the admin portal on (PORTAL_ENABLED="true"). Set PORTAL_INITIAL_OWNER_EMAIL to the email address you sign in with — that account becomes the portal admin. If you don\'t need the portal, set PORTAL_ENABLED="false" instead.',
    icon: "ShieldCheck",
    when: () => process.env["PORTAL_ENABLED"] === "true",
  },
];

export interface EnvChecklistItem extends RequiredEnvVar {
  ok: boolean;
}

/**
 * SOURCE OF TRUTH KEYWORDS: OptionalEnvVar, OptionalEnvKey, OPTIONAL_ENV
 *
 * WHAT:  An integration the app runs fine WITHOUT (fail-soft). Shown on the
 *        setup checklist as an informational row — never blocks startup.
 * WHY:   A developer should be able to see, at a glance, what's turned off,
 *        WHAT it would do if enabled, and HOW to enable it — so an unwired
 *        integration (e.g. Stripe) is a clearly-explained choice, not a
 *        mystery. An integration is a GROUP of env vars (`keys`), not one flag:
 *        showing each key's status means a half-configured integration (e.g.
 *        secret key set but no price IDs) reads as exactly that, instead of a
 *        misleading "Configured". `purpose` carries the reasoning + the current
 *        fallback behaviour; `help` carries the enable-it instructions.
 * WHERE: Rendered by src/components/global/setup-checklist.tsx.
 */
export interface OptionalEnvKey {
  /** The process.env key. */
  key: string;
  /** Short human label (name the thing, e.g. "Secret key"). */
  label: string;
  /** true ⇒ helpful but doesn't gate the "Configured" badge (e.g. per-plan price ids). */
  optional?: boolean;
}

export interface OptionalEnvVar {
  /** Stable id for the row (not tied to any single env var). */
  id: string;
  /** When set, the row is shown only for these providers. */
  whenProvider?: readonly string[];
  /** Short human label for the row (name the integration, not a key). */
  label: string;
  /** What it does + what the app does WITHOUT it (the fail-soft fallback). */
  purpose: string;
  /** How to turn it on if they want it. */
  help: string;
  /** Icon name resolved by the setup checklist (see its icon map). */
  icon: string;
  /** Every env var this integration reads, with per-key status shown. */
  keys: OptionalEnvKey[];
  /** Optional provider/sign-up link (same shape as RequiredEnvVar.link). */
  link?: { label: string; url: string };
  /** Optional walkthrough video (same shape as RequiredEnvVar.video). */
  video?: { url: string; label?: string };
}

/* Per-plan Stripe price-id keys, DERIVED from the plan source of truth so the
 * labels follow the (env-driven) plan names and the key list never duplicates
 * PLAN_ORDER. `free` has no price; the env-var name follows plans.ts' fixed
 * `NEXT_PUBLIC_<PLANKEY>_PRICE_<INTERVAL>` convention. Marked optional: you only
 * need a price for the plans you actually sell. */
const STRIPE_PRICE_KEYS: OptionalEnvKey[] = PLAN_ORDER.filter(
  isPaidPlan,
).flatMap((plan) =>
  (["monthly", "yearly"] as const).map((interval) => ({
    key: `NEXT_PUBLIC_${plan.toUpperCase()}_PRICE_${interval.toUpperCase()}`,
    label: `${PLANS[plan].name} price (${interval})`,
    optional: true,
  })),
);

/* Credit-pack price ids, DERIVED from the pack table so the checklist can
 * never list a pack that does not exist or miss one that does. Marked optional
 * for the same reason the plan prices are: you only need a price for the packs
 * you actually sell, and a pack with no price is simply not purchasable (see
 * PACK_PRICE_IS_ENV_DRIVEN in src/lib/types/credits.ts). */
const CREDIT_PACK_PRICE_KEYS: OptionalEnvKey[] = (
  Object.keys(CREDIT_PACKS) as (keyof typeof CREDIT_PACKS)[]
).map((pack) => ({
  key: CREDIT_PACKS[pack].priceEnvKey,
  label: `${CREDIT_PACKS[pack].label} price (${CREDIT_PACKS[pack].credits.toLocaleString("en-US")} credits)`,
  optional: true,
}));

/* Fail-soft integrations. Adding one here surfaces it on the setup checklist as
 * an informational row; it NEVER affects hasMissingRequiredEnv (never blocks).
 *
 * PROVIDER_ISOLATION: rows are filtered by `whenProvider` so an operator only
 * ever sees integrations that apply to the provider they selected — Stripe keys
 * would be noise under a provider that owns checkout itself, and that
 * provider's own webhook would be noise under Better Auth. */
export const OPTIONAL_ENV: readonly OptionalEnvVar[] = [
  {
    id: "stripe",
    whenProvider: ["better-auth"],
    label: "Payments (Stripe)",
    purpose:
      "Optional. Stripe isn’t connected yet, so checkout is skipped — people are let straight into the app and no card is ever charged. Add your Stripe keys to turn on real paid plans, subscriptions, and the billing screen.",
    help: "Create a Stripe account, add the three keys below, then a price ID for each paid plan you want to sell (create the prices in the Stripe dashboard). A plan with no price ID can’t be checked out.",
    icon: "CreditCard",
    link: {
      label: "Create a Stripe account",
      url: "https://dashboard.stripe.com/register",
    },
    keys: [
      { key: "STRIPE_SECRET_KEY", label: "Secret key" },
      { key: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", label: "Publishable key" },
      { key: "STRIPE_WEBHOOK_SECRET", label: "Webhook signing secret" },
      ...STRIPE_PRICE_KEYS,
      ...CREDIT_PACK_PRICE_KEYS,
    ],
  },
  /* Media. Two rows rather than one, because they fail at different points and
   * an operator fixing the wrong one learns nothing: without R2 an upload
   * cannot START, and without ffmpeg it lands in the bucket and is then marked
   * `failed`. Neither is provider-specific (no `whenProvider`) — object storage
   * and transcoding are app concerns, not auth ones. */
  {
    id: "storage",
    label: "Media storage (Cloudflare R2)",
    purpose:
      "Needed before anyone can upload. Uploaded video, generated audio and finished renders all live in the bucket — the database only ever stores the key. Without it the media library loads but every upload is refused.",
    help: "Create an R2 bucket, then an API token with object read/write on it. Add a lifecycle rule deleting the `tmp/` prefix after 24 hours — the key convention assumes it and nothing in code enforces it. R2_PUBLIC_URL is only for the public library assets served over the CDN.",
    icon: "HardDrive",
    link: {
      label: "Open the Cloudflare R2 dashboard",
      url: "https://dash.cloudflare.com/?to=/:account/r2",
    },
    keys: [
      { key: "R2_ACCOUNT_ID", label: "Account ID" },
      { key: "R2_ACCESS_KEY_ID", label: "Access key ID" },
      { key: "R2_SECRET_ACCESS_KEY", label: "Secret access key" },
      { key: "R2_BUCKET", label: "Bucket name" },
      { key: "R2_PUBLIC_URL", label: "Public CDN origin", optional: true },
    ],
  },
  {
    id: "media",
    label: "Media processing (ffmpeg)",
    purpose:
      "Needed before an upload can be USED. Each file is probed, converted to a 9:16 master and given a small preview version, a poster frame and a waveform. Without ffmpeg the bytes upload fine and the asset is then marked failed, so nothing can be put in a video.",
    help: "Install ffmpeg in whatever runs the background workflows — that process has to be a long-lived container, not a serverless function (an ffmpeg build is larger than a serverless bundle and a transcode outlasts its time budget). Leave both paths blank to resolve the binaries on PATH.",
    icon: "Film",
    link: { label: "Download ffmpeg", url: "https://ffmpeg.org/download.html" },
    /* BOTH optional, and that is the honest shape rather than a convenience.
     * Leaving these blank is a WORKING configuration — the binaries resolve on
     * PATH, which is what a container image with ffmpeg installed gives you —
     * so a red row for an empty value would be wrong. This checklist can only
     * report whether a variable is SET (see the note on isSet below); whether
     * ffmpeg is actually installed can only be answered by running it, which
     * is not something a page load should do. */
    keys: [
      {
        key: "FFMPEG_PATH",
        label: "ffmpeg path (blank ⇒ found on PATH)",
        optional: true,
      },
      {
        key: "FFPROBE_PATH",
        label: "ffprobe path (blank ⇒ found on PATH)",
        optional: true,
      },
    ],
  },
  /* Script generation. A third kind of "media" dependency again, failing at
   * a different point: without R2 nothing uploads, without ffmpeg nothing is
   * prepared, without Remotion nothing exports — and without this, nothing can
   * be WRITTEN in the first place. It is the earliest step in the product and
   * the only one a customer cannot work around by supplying their own file. */
  {
    id: "llm",
    label: "Script generation (Claude)",
    purpose:
      "Needed before anyone can generate a script. Everything downstream — voices, captions, the timeline — is built from the script, so without this a project stays empty. Editing an existing script by hand still works; only the Generate and Rewrite buttons refuse.",
    help:
      "Create an API key at console.anthropic.com and set ANTHROPIC_API_KEY. ANTHROPIC_MODEL and ANTHROPIC_EFFORT are optional overrides for trading cost against quality without a deploy — leave them blank for the defaults (Claude Opus 5.5 at high effort). Note that generation SPENDS CREDITS on the customer's ledger, so a key with a low spend limit will surface as generations that fail after the credits were held.",
    icon: "Sparkles",
    link: {
      label: "Create an Anthropic API key",
      url: "https://console.anthropic.com/settings/keys",
    },
    keys: [
      { key: "ANTHROPIC_API_KEY", label: "API key" },
      {
        key: "ANTHROPIC_MODEL",
        label: "Model override (blank ⇒ Claude Opus 5.5)",
        optional: true,
      },
      {
        key: "ANTHROPIC_EFFORT",
        label: "Effort override (blank ⇒ high)",
        optional: true,
      },
    ],
  },
  /* Narration. The fourth media dependency, failing at yet another point:
   * without this a project can be written and previewed but never SPOKEN, and
   * everything downstream of narration — captions, the timeline, the render —
   * has nothing to sit against. */
  {
    id: "tts",
    label: "Narration and caption timing (ElevenLabs)",
    purpose:
      "Needed before a script can be turned into speech, and before captions can be timed against it — both use this one key. Scripts can still be written and edited without it; the Narrate button refuses, and captions cannot be timed. Voice previews also come from this catalogue, so the voice picker will be empty until the catalogue has been synced from the portal.",
    help:
      "Create an API key at elevenlabs.io, then sync the catalogue once from the portal (Voices → Sync from provider) — there is no seed file, and the voice ids only exist in a real account. ELEVENLABS_MODEL and ELEVENLABS_BACKUP_MODEL are optional overrides; the backup is used automatically when the primary model fails, and it deliberately defaults to a DIFFERENT family so it does not share the primary failure mode. Narration SPENDS CREDITS per line, and caption timing spends them per second of narration — re-running either with nothing changed costs nothing.",
    icon: "Mic",
    link: {
      label: "Create an ElevenLabs API key",
      url: "https://elevenlabs.io/app/settings/api-keys",
    },
    keys: [
      { key: "ELEVENLABS_API_KEY", label: "API key" },
      {
        key: "ELEVENLABS_MODEL",
        label: "Primary model (blank means the quality default)",
        optional: true,
      },
      {
        key: "ELEVENLABS_BACKUP_MODEL",
        label: "Backup model (blank means the turbo default)",
        optional: true,
      },
      /* CAPTION ALIGNMENT SHARES THIS CREDENTIAL, so it is listed here rather
       * than as a row of its own — a checklist row a customer can never
       * satisfy separately is a row that makes the list look longer and the
       * setup look harder. The optional model override belongs with it. */
      {
        key: "ELEVENLABS_STT_MODEL",
        label: "Caption timing model (blank means the default aligner)",
        optional: true,
      },
    ],
  },
  /* Reddit (Phase 12). A row of its own because it gates ONE FORMAT rather
   * than a capability: without it every other kind of video still generates
   * end to end, and only the Reddit input panel refuses. It is also the one
   * credential here that belongs to a third party's TERMS rather than just
   * their API — hence the help text, which is the only place an operator is
   * told that the format has a kill switch in the registry. */
  {
    id: "reddit",
    label: "Reddit stories (official API)",
    purpose:
      "Needed before a Reddit thread can be turned into a video. Only the Reddit format depends on it — every other kind of project generates without it, and the paste-your-own-text fallback works even when it is missing. Without it the thread field refuses and tells the customer to paste the text instead.",
    help:
      "Create a 'script' app at reddit.com/prefs/apps and set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET. REDDIT_USER_AGENT is an optional override; leave it blank and one is built from the app name and client id, which is the shape Reddit's guidance asks for — requests with a generic User-Agent are rate-limited far harder. The API budget is shared by EVERY workspace on this deployment, which is why the format carries its own tight rate limits. If Reddit's terms change or the app is suspended, turn the format off for everybody by flipping the `redditStories` flag in src/lib/resources.ts — see A_FLAG_NOT_A_LIMIT.",
    icon: "MessageSquare",
    link: {
      label: "Create a Reddit app",
      url: "https://www.reddit.com/prefs/apps",
    },
    keys: [
      { key: "REDDIT_CLIENT_ID", label: "Client ID" },
      { key: "REDDIT_CLIENT_SECRET", label: "Client secret" },
      {
        key: "REDDIT_USER_AGENT",
        label: "User-Agent override (blank builds one from the app name)",
        optional: true,
      },
    ],
  },
  /* Cloud rendering. A third media row rather than part of the other two,
   * because it fails at a different point again and the fix is in a different
   * cloud: without R2 nothing can be uploaded, without ffmpeg nothing can be
   * prepared, and without this nothing can be EXPORTED. Everything else in the
   * product works meanwhile — a customer can generate, preview and edit, and
   * only the render button refuses. */
  {
    id: "render",
    label: "Cloud rendering (Remotion Lambda)",
    purpose:
      "Needed before anyone can export a finished video. The browser preview and the editor work without it — they render in the page — but the Render button will refuse, because producing the actual MP4 happens in the cloud, split across many functions so a long video does not take as long to make as it does to watch.",
    help:
      "Install the Remotion CLI, then deploy the function and the site: `npx remotion lambda functions deploy` and `npx remotion lambda sites create src/remotion/index.ts --site-name=<name>`. " +
      "Put the function name, the bucket it created and the region below. REMOTION_SITE_VERSION is the version suffix of the site you deployed — bump it on each deploy and renders already in flight keep working against the version they started on, which is also how you roll back. " +
      "REMOTION_WEBHOOK_SECRET is any long random string; the renderer signs its callback with it and the webhook refuses a call it cannot verify, so a render cannot finish without it. " +
      "Note for local development: the renderer calls back to NEXT_PUBLIC_APP_URL, and AWS cannot reach localhost — point a tunnel at your dev server and set that variable to the tunnel URL, or renders will start and then time out.",
    icon: "Clapperboard",
    link: {
      label: "Remotion Lambda setup guide",
      url: "https://www.remotion.dev/docs/lambda/setup",
    },
    keys: [
      { key: "REMOTION_AWS_REGION", label: "AWS region" },
      { key: "REMOTION_FUNCTION_NAME", label: "Deployed function name" },
      { key: "REMOTION_SITE_NAME", label: "Deployed site name" },
      { key: "REMOTION_SITE_VERSION", label: "Site version (bump per deploy)" },
      { key: "REMOTION_BUCKET_NAME", label: "Remotion S3 bucket" },
      { key: "REMOTION_WEBHOOK_SECRET", label: "Webhook signing secret" },
    ],
  },
  /* Phase 10's launch integrations. All three are fail-soft and all three are
   * worth seeing on the checklist for different reasons: an operator needs to
   * know that error reports are going nowhere, that the funnel is not being
   * recorded, and — most importantly — that the spend tripwire is armed. */
  {
    id: "observability",
    label: "Error reporting (Sentry)",
    purpose:
      "Optional, and strongly recommended before opening sign-ups. Without a DSN the SDK is never even loaded: failures still produce a structured JSON log line carrying the request id, but nothing groups them, nothing keeps the stack trace and nothing tells you an error is new. With it, every unexpected failure arrives tagged with the request id that caused it — so a customer saying 'my video failed' is one search rather than a trawl through four workflows' logs.",
    help:
      "Create a Sentry project and put its DSN below. The DSN is a write-only ingest key and is meant to be public, which is why it carries the NEXT_PUBLIC_ prefix — the browser SDK ships it. " +
      "SENTRY_TRACES_SAMPLE_RATE is the share of requests traced for performance; it defaults to 0.1, and traces are the part of Sentry that gets expensive quietly, so raise it deliberately.",
    icon: "ShieldAlert",
    link: {
      label: "Create a Sentry project",
      url: "https://sentry.io/signup/",
    },
    keys: [
      { key: "NEXT_PUBLIC_SENTRY_DSN", label: "DSN" },
      {
        key: "SENTRY_TRACES_SAMPLE_RATE",
        label: "Trace sample rate (defaults to 0.1)",
        optional: true,
      },
    ],
  },
  {
    id: "analytics",
    label: "Product analytics (PostHog)",
    purpose:
      "Optional. Without a key no analytics SDK is loaded and no cookie banner is shown, because there is nothing to ask permission for. With it, the signup → script → generation → render → purchase funnel is recorded SERVER-side (so the counts survive ad blockers) and page views are recorded in the browser — but only after a visitor accepts analytics cookies. Automatic click capture and session recording are deliberately switched off, so the contents of a customer's script editor are never sent.",
    help:
      "Create a PostHog project and put its project API key below. Like the Sentry DSN it is a write-only ingest key and is public by design. " +
      "Set NEXT_PUBLIC_POSTHOG_HOST only if you are self-hosting or using the EU region; it defaults to the US cloud.",
    icon: "ChartBar",
    link: {
      label: "Create a PostHog project",
      url: "https://posthog.com/signup",
    },
    keys: [
      { key: "NEXT_PUBLIC_POSTHOG_KEY", label: "Project API key" },
      {
        key: "NEXT_PUBLIC_POSTHOG_HOST",
        label: "Host (defaults to US cloud)",
        optional: true,
      },
    ],
  },
  {
    id: "cost-alert",
    label: "Daily spend alert",
    purpose:
      "Optional, with a working default. A daily job totals the previous day's estimated provider spend and raises an alert when it crosses a threshold — generative work can run up a bill faster than anybody checks a dashboard. The figures are OUR OWN usage records priced at list, not a provider invoice, so set the threshold well below the number that would actually hurt. The alert goes to the log stream and, when Sentry is configured, to Sentry.",
    help:
      "COST_ALERT_THRESHOLD_USD is the daily figure in US dollars that fires the alert; it defaults to 50. The job runs whether or not this is set — the only thing the variable changes is the threshold.",
    icon: "CircleDollarSign",
    keys: [
      {
        key: "COST_ALERT_THRESHOLD_USD",
        label: "Daily threshold in USD (defaults to 50)",
        optional: true,
      },
    ],
  },
];

export interface OptionalEnvKeyStatus extends OptionalEnvKey {
  ok: boolean;
}

export interface OptionalEnvItem extends Omit<OptionalEnvVar, "keys"> {
  keys: OptionalEnvKeyStatus[];
  /** True when every NON-optional key is set. */
  ok: boolean;
}

/* A var counts as set only when it's a non-empty, trimmed string.
 *
 * SERVER_ONLY_READ: the computed `process.env[key]` below is correct here and
 * only here. Next inlines `NEXT_PUBLIC_*` into the CLIENT bundle for literal
 * accesses only, so a computed read returns undefined in a browser — which
 * would report every configured key as missing. This module is reached solely
 * from the root layout and SetupChecklist, both server components, where
 * process.env is the real object. Render any of it on the client and this
 * silently inverts; read a value for display through env.public.ts instead. */
function isSet(key: string): boolean {
  const value = process.env[key];
  return typeof value === "string" && value.trim().length > 0;
}

/* A var is in scope unless its `when` predicate says it's irrelevant now. */
function isRequiredNow(item: RequiredEnvVar): boolean {
  return item.when === undefined || item.when();
}

/**
 * SOURCE OF TRUTH KEYWORDS: getEnvChecklist
 *
 * WHAT:  The currently-required vars annotated with whether each is set.
 *        Vars whose `when` predicate is false are excluded entirely.
 * WHERE: Passed to <SetupChecklist /> by the root layout.
 */
export function getEnvChecklist(): EnvChecklistItem[] {
  return REQUIRED_ENV.filter(isRequiredNow).map((item) => ({
    ...item,
    ok: isSet(item.key),
  }));
}

/**
 * SOURCE OF TRUTH KEYWORDS: getOptionalEnvChecklist
 *
 * WHAT:  The optional integrations annotated with whether each is configured.
 * WHY:   Presentational only — these never gate startup; the checklist shows
 *        them so a developer knows what's off and how to switch it on.
 * WHERE: Passed to <SetupChecklist /> by the root layout.
 */
export function getOptionalEnvChecklist(): OptionalEnvItem[] {
  return OPTIONAL_ENV.filter(
    (item) =>
      item.whenProvider === undefined ||
      item.whenProvider.includes(AUTH_PROVIDER),
  ).map((item) => {
    const keys = item.keys.map((k) => ({ ...k, ok: isSet(k.key) }));
    /* "Configured" = every non-optional key is set; optional (per-plan price)
     * keys are shown but don't gate the badge. */
    const ok = keys.filter((k) => !k.optional).every((k) => k.ok);
    return { ...item, keys, ok };
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: getMissingRequiredEnv
 *
 * WHAT:  Only the required vars that are NOT set.
 * WHERE: Used by the gate to decide whether to show the checklist.
 */
export function getMissingRequiredEnv(): EnvChecklistItem[] {
  return getEnvChecklist().filter((item) => !item.ok);
}

/**
 * SOURCE OF TRUTH KEYWORDS: hasMissingRequiredEnv
 *
 * WHAT:  True when at least one required var is missing.
 * WHERE: The root layout's branch condition.
 */
export function hasMissingRequiredEnv(): boolean {
  return REQUIRED_ENV.filter(isRequiredNow).some((item) => !isSet(item.key));
}
