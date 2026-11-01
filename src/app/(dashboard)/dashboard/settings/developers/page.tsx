/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: DevelopersSettingsPage, THE_SCREEN_IS_NOT_GATED,
 *   SERVER_PAGE_CLIENT_PANEL, THE_ORIGIN_COMES_FROM_THE_SERVER
 *
 * WHAT:  /dashboard/settings/developers — API keys, the REST reference, and
 *        the MCP endpoint with its copy-paste config.
 *
 * WHY:   THE_SCREEN_IS_NOT_GATED (`requireFlag: false` on the registry entry).
 *        A workspace without API access still reaches this page and is told
 *        what the feature does and what upgrading would buy, because hiding it
 *        means the only people who ever discover the API are the ones already
 *        paying for it.
 *
 *        SERVER_PAGE_CLIENT_PANEL, the same split as every other settings
 *        screen: the page costs no JavaScript of its own and the panel is a
 *        client child because it holds a dialog, a clipboard action and the
 *        one-time reveal of a minted key.
 *
 *        THE_ORIGIN_COMES_FROM_THE_SERVER. The page resolves the request's own
 *        origin and passes it down, so the curl command and the MCP config
 *        name the deployment the customer is actually on. Reading
 *        `window.location` in the panel would mean either an effect that only
 *        sets state or markup that differs between the server and the client;
 *        the host is in the request headers and this is the one place that can
 *        see them.
 * WHERE: RESOURCES.apiKeys.nav.href.
 */

import type { Metadata } from "next";
import { headers } from "next/headers";

import { ContentLayout } from "@/components/global/page-header";
import { MCP_TOOL_NAMES } from "@/lib/api/mcp-tools";
import { APP_URL } from "@/lib/config/branding";
import { ApiKeysPanel } from "./_components/api-keys-panel";

export const metadata: Metadata = {
  title: "Developers",
};

export default async function DevelopersSettingsPage() {
  return (
    <ContentLayout title="Developers">
      {/* The tool count is read from the table rather than written in the
          panel's copy, so adding a tool cannot leave the screen claiming the
          wrong number. The panel is a client component and the table is
          `server-only`, which is why it arrives as a prop. */}
      <ApiKeysPanel
        origin={await resolveOrigin()}
        toolCount={MCP_TOOL_NAMES.length}
      />
    </ContentLayout>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveOrigin, THE_ORIGIN_COMES_FROM_THE_SERVER
 *
 * WHAT:  The origin this page was requested on.
 * WHY:   `x-forwarded-*` first, because behind a proxy the `host` header is
 *        the proxy's view and the forwarded pair is the client's. Falls back
 *        to the configured `APP_URL` when neither is present, which is the
 *        case in a test or a direct server render — better a configured URL
 *        than a broken one.
 *
 *        The protocol defaults to https rather than http: every deployment
 *        that matters is served over TLS, and a copied snippet pointing at
 *        http would fail in a way that looks like our bug.
 * WHERE: This page.
 */
async function resolveOrigin(): Promise<string> {
  const requestHeaders = await headers();

  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (host === null || host.length === 0) return APP_URL;

  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  return `${protocol}://${host}`;
}
