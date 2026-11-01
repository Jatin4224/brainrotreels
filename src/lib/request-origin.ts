/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: originFromHeaders, resolveRequestOrigin,
 *   THE_ORIGIN_COMES_FROM_THE_SERVER, FORWARDED_BEATS_HOST,
 *   HTTPS_IS_THE_DEFAULT_PROTOCOL, A_COPIED_SNIPPET_NAMES_ITS_DEPLOYMENT
 *
 * WHAT:  The origin a page or route was actually requested on —
 *        `https://app.example.com` — with the configured `APP_URL` as the
 *        fallback.
 *
 * WHY:   A_COPIED_SNIPPET_NAMES_ITS_DEPLOYMENT is the whole reason this is not
 *        just `APP_URL`. Several screens render snippets a customer copies: a
 *        curl command, an MCP config block, an endpoint list. A snippet copied
 *        from a preview deployment that silently points at production is a
 *        mistake nobody spots inside a code block, and the reverse — a
 *        production screen handing out a preview URL — is worse.
 *
 *        FORWARDED_BEATS_HOST. Behind a proxy, `host` is the proxy's view of
 *        itself while `x-forwarded-host` is the name the client actually
 *        asked for. Reading `host` first would make every snippet on a
 *        proxied deployment name an internal hostname.
 *
 *        HTTPS_IS_THE_DEFAULT_PROTOCOL when `x-forwarded-proto` is absent.
 *        Every deployment that matters is served over TLS, and a copied
 *        snippet pointing at `http://` fails in a way that reads as our bug
 *        rather than as a missing header.
 *
 *        Two functions because the callers differ: a server COMPONENT awaits
 *        `headers()` and a route HANDLER already holds a `Request`. The pure
 *        one takes a `Headers` so a test can call it without a framework.
 *
 *        Globalized here rather than left inline in the developers page, where
 *        it started, because an origin-resolution rule — which header wins,
 *        what the protocol defaults to — is the kind of thing a second screen
 *        re-derives slightly differently. The public `/docs/api` page
 *        deliberately does NOT use it: that page is in the `(marketing)`
 *        group, whose contract is that nothing beneath it reads `headers()`,
 *        so it renders the configured `APP_URL` and stays static.
 * WHERE: /dashboard/settings/developers. Any further surface that renders a
 *        URL a customer copies should call this rather than rebuild it.
 */

import { APP_URL } from "@/lib/config/branding";

/**
 * SOURCE OF TRUTH KEYWORDS: originFromHeaders, FORWARDED_BEATS_HOST
 *
 * WHAT:  The origin these headers describe, or `APP_URL` when they describe
 *        none — a direct server render, a test, a synthetic request.
 * WHY:   Pure and synchronous, so the route-handler caller and the server
 *        component caller share one implementation. See the file header for
 *        the precedence.
 * WHERE: `resolveRequestOrigin`, and route handlers that hold a `Request`.
 */
export function originFromHeaders(requestHeaders: Headers): string {
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (host === null || host.length === 0) return APP_URL;

  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  return `${protocol}://${host}`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveRequestOrigin, THE_ORIGIN_COMES_FROM_THE_SERVER
 *
 * WHAT:  The same answer for a server component, which has to await
 *        `headers()` to get at them.
 * WHY:   `next/headers` is imported here rather than by each caller so a page
 *        asking this question does not also have to know how Next exposes it.
 * WHERE: Server components that render a copyable URL.
 */
export async function resolveRequestOrigin(): Promise<string> {
  const { headers } = await import("next/headers");
  return originFromHeaders(await headers());
}
