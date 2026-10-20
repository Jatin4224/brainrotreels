/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: inngestClient, INNGEST_APP_ID, Inngest client,
 *   PROVIDER_ISOLATION, assertJobsProviderActive
 *
 * WHAT:  The one Inngest client instance, shared by the send adapter and every
 *        workflow definition.
 * WHY:   Workflows and sends must share a client or they disagree about the
 *        app id and events land in a different app than the functions
 *        listening for them — which presents as "the job never ran".
 *        This is the only module besides ./index.ts and src/inngest/** allowed
 *        to import the Inngest SDK; eslint enforces that.
 *        `assertJobsProviderActive` at module scope is the runtime backstop:
 *        if a stray import pulls this in while JOBS_PROVIDER names something
 *        else, it dies at boot rather than quietly opening a second queue.
 * WHERE: Imported by ./index.ts (sending) and src/inngest/** (workflows).
 */

import { Inngest } from "inngest";

import { APP_NAME } from "@/lib/config/branding";
import { assertJobsProviderActive } from "../provider";

assertJobsProviderActive("inngest");

/* A stable id, not the display name: renaming the product must not orphan
 * in-flight runs. Slugified so it is URL-safe in the Inngest dashboard. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const configuredAppId = process.env["INNGEST_APP_ID"]?.trim();

export const INNGEST_APP_ID: string =
  configuredAppId !== undefined && configuredAppId.length > 0
    ? configuredAppId
    : /* An all-symbol app name would slugify to '' — fall back rather than
       * registering an app with an empty id. */
      slugify(APP_NAME) || "app";

/* Without a signing key the SDK assumes CLOUD mode and every request to
 * /api/inngest 500s with "In cloud mode but no signing key found". Deriving
 * dev mode from NODE_ENV means a fresh clone works with no Inngest env at all
 * — just `npx inngest-cli@latest dev` — while production still demands a real
 * key rather than silently running unsigned. INNGEST_DEV overrides for the
 * rare case of pointing a local app at a cloud environment. */
const devOverride = process.env["INNGEST_DEV"]?.trim();

export const inngestClient = new Inngest({
  id: INNGEST_APP_ID,
  isDev:
    devOverride !== undefined && devOverride.length > 0
      ? devOverride === "1" || devOverride === "true"
      : process.env.NODE_ENV !== "production",
});
