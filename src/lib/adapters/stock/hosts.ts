/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: STOCK_DOWNLOAD_HOSTS, isStockDownloadHost,
 *   assertStockDownloadUrl, StockUrlRefusal, HOST_ALLOWLIST_IS_THE_CHECK,
 *   PURE_HALF_IS_EXPORTED, NO_SSRF_THROUGH_A_STORED_URL
 *
 * WHAT:  Which hosts a stock clip may be downloaded from, and the refusal when
 *        a URL is not one of them.
 *
 * WHY:   NO_SSRF_THROUGH_A_STORED_URL, and this file is the whole reason the
 *        stock seam has a pure half at all. A `stock` choice is STORED on the
 *        project (CHOICE_IS_STORED_NOT_THE_BYTES) and read back by a workflow
 *        that then fetches it server-side with our own network position. That
 *        makes `downloadUrl` the single most dangerous field this phase adds:
 *        anything that can write a project's settings and get that URL fetched
 *        has a request forgery primitive pointed at our internal network.
 *
 *        HOST_ALLOWLIST_IS_THE_CHECK. The defence is an ALLOWLIST of the
 *        provider's own delivery hosts rather than a blocklist of private
 *        ranges, because a blocklist has to be right about DNS rebinding,
 *        redirects, IPv6 mapping and every cloud metadata endpoint, and an
 *        allowlist only has to be right about where the bytes legitimately
 *        come from. `assertFetchableUrl` in src/lib/script/url-guard.ts is the
 *        general-purpose version for URLs a customer genuinely chooses; it is
 *        not what is wanted here, because here the set of valid hosts is known
 *        in advance and tiny.
 *
 *        PURE_HALF_IS_EXPORTED, the same split as the Reddit seam's `url.ts`:
 *        this module has no network, no credential and no `server-only`, so the
 *        check with security consequences is importable by the router that
 *        validates a swap, by the workflow that fetches, and by a test — none
 *        of which should have to drag the API key's module into their graph to
 *        find out whether a host is allowed.
 *
 *        Subdomain matching is on a DOT BOUNDARY, never `endsWith`:
 *        `videos.pexels.com.attacker.example` ends with nothing in this list,
 *        but `pexels.com.attacker.example` would pass a naive suffix test. That
 *        one line is the difference between an allowlist and a decoration.
 * WHERE: `assertStockDownloadUrl` is called by the ingest workflow before it
 *        fetches, and by `visuals.setBlockVisual` before it stores a choice.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: STOCK_DOWNLOAD_HOSTS
 *
 * WHAT:  The registered delivery hosts, per provider id.
 * WHY:   Keyed by provider so adding a second stock library is one entry here
 *        rather than a widened flat list nobody can attribute — and so a key
 *        issued for one provider cannot be used to pull bytes from another's
 *        CDN. The hosts are the provider's DELIVERY domains, which are not the
 *        same as its API domain: Pexels answers at `api.pexels.com` and serves
 *        files from `*.pexels.com` CDN hosts.
 * WHERE: `isStockDownloadHost`.
 */
export const STOCK_DOWNLOAD_HOSTS: Readonly<Record<string, readonly string[]>> =
  {
    pexels: ["pexels.com"],
  };

/**
 * SOURCE OF TRUTH KEYWORDS: StockUrlRefusal, REFUSAL_NAMES_THE_REASON
 *
 * WHAT:  Why a download URL was refused.
 * WHY:   A closed union so the caller chooses the copy, and so a count of each
 *        reason in the logs means something: `not_https` and `bad_host` are
 *        ordinary malformed input, while `unknown_provider` means a choice was
 *        stored naming a provider this build does not have — which is either an
 *        older release's data or somebody probing.
 * WHERE: `assertStockDownloadUrl`'s thrown message.
 */
export type StockUrlRefusal = "not_https" | "bad_host" | "unknown_provider";

/**
 * SOURCE OF TRUTH KEYWORDS: isStockDownloadHost, HOST_ALLOWLIST_IS_THE_CHECK
 *
 * WHAT:  Whether this URL may be fetched for this provider.
 * WHY:   HTTPS only — a plaintext fetch of somebody else's media is an
 *        on-path rewrite of the bytes we are about to store and serve. The
 *        DOT BOUNDARY comparison is explained in the file header.
 * WHERE: `assertStockDownloadUrl`; the router's validation.
 */
export function isStockDownloadHost(provider: string, url: string): boolean {
  const allowed = STOCK_DOWNLOAD_HOSTS[provider];
  if (allowed === undefined) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  return allowed.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: assertStockDownloadUrl, NO_SSRF_THROUGH_A_STORED_URL
 *
 * WHAT:  Throws unless the URL is one this provider is allowed to serve.
 * WHY:   THROWS rather than returning a boolean, at the two places that matter,
 *        because a boolean is a check somebody forgets to read. The message
 *        names the host and the provider: the caller logs it, and nothing
 *        customer-facing is built from it, since a customer did not type this
 *        URL and cannot act on it.
 * WHERE: The ingest workflow's fetch step, and `visuals.setBlockVisual`.
 */
export function assertStockDownloadUrl(provider: string, url: string): void {
  if (STOCK_DOWNLOAD_HOSTS[provider] === undefined) {
    throw new Error(
      `[stock/hosts] unknown_provider: "${provider}" has no registered download hosts.`,
    );
  }
  if (!isStockDownloadHost(provider, url)) {
    throw new Error(
      `[stock/hosts] bad_host: "${url}" is not an https URL on a registered ${provider} delivery host.`,
    );
  }
}
