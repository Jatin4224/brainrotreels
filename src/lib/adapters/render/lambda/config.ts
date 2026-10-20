/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: lambdaRenderConfig, isLambdaRenderConfigured,
 *   REMOTION_SITE_VERSION, VERSIONED_SITE_URL, serveUrl, LAZY_CONFIG,
 *   REMOTION_AWS_REGION, REMOTION_FUNCTION_NAME, REMOTION_SITE_NAME,
 *   REMOTION_WEBHOOK_SECRET
 *
 * WHAT:  Everything the Lambda renderer needs from the environment, read once
 *        and validated at the point of use.
 *
 * WHY:   VERSIONED_SITE_URL is the reason `REMOTION_SITE_VERSION` exists as a
 *        variable at all, and it is the phase's step 2 — "a deploy is
 *        reversible and renders already in flight keep working against the
 *        version they started on". Remotion renders from a SITE: a bundle of
 *        the composition uploaded to S3 and addressed by URL. If every deploy
 *        overwrote one URL, then deploying mid-render would swap the bundle
 *        under a render that has already started some of its chunks — and
 *        because Lambda renders chunks in PARALLEL, the result is not a failed
 *        render but a video whose first half came from one build and whose
 *        second half came from another. That is the worst possible failure
 *        here: it succeeds, it is paid for, and nothing in the logs says why
 *        the output changes halfway through.
 *
 *        So the version is part of the URL, a new deploy writes a NEW site,
 *        and a render resolves its serve URL exactly once — at start, from
 *        this value — and carries it for its whole life. Rolling back is
 *        putting the old version string back in the environment, which needs
 *        no redeploy of the renderer and no code change.
 *
 *        LAZY_CONFIG, matching src/lib/adapters/storage/r2/client.ts: nothing
 *        throws at import. These variables are optional until someone actually
 *        renders, and a module-scope throw would crash the setup checklist —
 *        the one screen whose job is to report which variables are missing.
 *
 *        `REMOTION_WEBHOOK_SECRET` is shared with the webhook route, which is
 *        the only other module allowed to read it. It is deliberately NOT
 *        defaulted: an unsigned webhook is an endpoint anyone can use to tell
 *        us a render finished, and the route refuses an unsigned call (the
 *        phase's last "done when" check). A default of `''` here would make
 *        Remotion send the literal string `NO_SECRET_PROVIDED` as the
 *        signature, every render would stall, and the cause would be two
 *        modules away from the symptom.
 * WHERE: ./index.ts, and `REMOTION_WEBHOOK_SECRET` also from
 *        src/app/api/webhooks/remotion/route.ts via getRemotionWebhookSecret.
 */

import { assertRenderProviderActive } from "../provider";

assertRenderProviderActive("lambda");

const region = process.env["REMOTION_AWS_REGION"]?.trim();
const functionName = process.env["REMOTION_FUNCTION_NAME"]?.trim();
const siteName = process.env["REMOTION_SITE_NAME"]?.trim();
const siteVersion = process.env["REMOTION_SITE_VERSION"]?.trim();
const bucketName = process.env["REMOTION_BUCKET_NAME"]?.trim();

/**
 * SOURCE OF TRUTH KEYWORDS: LambdaRenderConfig
 *
 * WHAT:  The resolved, non-empty configuration.
 * WHY:   A separate type from the raw reads so every field is a `string` by
 *        the time it leaves this module. The alternative — handing out
 *        `string | undefined` and checking at each call — is how one of five
 *        variables ends up unchecked, and the symptom is a render started
 *        against the URL `undefined`.
 * WHERE: Returned by lambdaRenderConfig().
 */
export interface LambdaRenderConfig {
  region: string;
  functionName: string;
  /** The versioned site URL the render bundle is served from. */
  serveUrl: string;
  /** The Remotion S3 bucket; outputs land here before being copied into R2. */
  bucketName: string;
}

export function isLambdaRenderConfigured(): boolean {
  return Boolean(
    region && functionName && siteName && siteVersion && bucketName,
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: lambdaRenderConfig, serveUrl, VERSIONED_SITE_URL
 *
 * WHAT:  The configuration, or a readable failure naming what is missing.
 * WHY:   The serve URL is COMPOSED from the bucket, the site name and the
 *        version rather than taken as one variable, so the version cannot be
 *        changed without the rest of the URL following it — a hand-written
 *        `REMOTION_SERVE_URL` plus a separate `REMOTION_SITE_VERSION` is two
 *        sources of truth for one address, and they drift silently.
 *
 *        The `/index.html` suffix and the `sites/` prefix are Remotion's own
 *        layout for a deployed site, not a choice.
 * WHERE: ./index.ts, on every start and every progress check.
 */
export function lambdaRenderConfig(): LambdaRenderConfig {
  const missing = [
    ["REMOTION_AWS_REGION", region],
    ["REMOTION_FUNCTION_NAME", functionName],
    ["REMOTION_SITE_NAME", siteName],
    ["REMOTION_SITE_VERSION", siteVersion],
    ["REMOTION_BUCKET_NAME", bucketName],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (
    missing.length > 0 ||
    !region ||
    !functionName ||
    !siteName ||
    !siteVersion ||
    !bucketName
  ) {
    throw new Error(
      `[render/lambda] Cloud rendering is not configured. Missing: ${missing.join(", ")}. ` +
        "Deploy the Remotion function and site, then set these in .env — see .env.example.",
    );
  }

  return {
    region,
    functionName,
    bucketName,
    serveUrl: `https://${bucketName}.s3.${region}.amazonaws.com/sites/${siteName}-${siteVersion}/index.html`,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: getRemotionWebhookSecret, REMOTION_WEBHOOK_SECRET
 *
 * WHAT:  The shared secret the provider signs its callback with.
 * WHY:   Read through a function so BOTH readers — the adapter that tells the
 *        provider which secret to sign with, and the route that verifies the
 *        signature — get the identical value from one place. Two
 *        `process.env` reads of the same name is how a trailing space on one
 *        side becomes "signatures do not match" on the other.
 * WHERE: ./index.ts and src/app/api/webhooks/remotion/route.ts.
 */
export function getRemotionWebhookSecret(): string | null {
  const secret = process.env["REMOTION_WEBHOOK_SECRET"]?.trim();
  return secret !== undefined && secret.length > 0 ? secret : null;
}
