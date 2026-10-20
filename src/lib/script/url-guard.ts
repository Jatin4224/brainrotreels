/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: assertFetchableUrl, isBlockedAddress, UrlGuardError,
 *   SSRF_GUARD, RECHECK_EVERY_REDIRECT, DNS_REBINDING, BLOCKED_RANGES
 *
 * WHAT:  Decides whether this server is allowed to fetch a URL a customer
 *        supplied.
 *
 * WHY:   SSRF_GUARD. A customer gives us a URL and we fetch it with OUR
 *        network identity — which, in any cloud, can reach things no customer
 *        can: the instance metadata service holding role credentials, the
 *        database on a private subnet, an internal admin service that trusts
 *        its network position. Server-Side Request Forgery is the whole
 *        category, and "fetch the URL the user typed" is its textbook case.
 *
 *        The canonical target is `http://169.254.169.254/latest/meta-data/`
 *        on AWS — one unauthenticated GET away from temporary credentials for
 *        the instance role, and therefore from everything that role can do.
 *        It is link-local, so no firewall between us and it.
 *
 *        Four checks, in this order, and the order matters:
 *
 *          1. SCHEME — `https:` only. `file:` reads the worker's disk,
 *             `gopher:` and `dict:` can be shaped into requests against other
 *             protocols, and plain `http:` is both eavesdroppable and the
 *             scheme every metadata service speaks.
 *          2. CREDENTIALS — a URL carrying `user:pass@` is rejected rather
 *             than stripped. `https://evil.com@internal/` is read by a human
 *             as pointing at `evil.com` and by a parser as pointing at
 *             `internal` — a rejection is the only reading that cannot
 *             surprise somebody.
 *          3. ADDRESS — the host is RESOLVED and every address it resolves to
 *             is checked against the blocked ranges. Checking the hostname
 *             text is not a defence: `localtest.me` and countless other public
 *             names resolve to 127.0.0.1 by design.
 *          4. REDIRECTS — re-checked after every hop, capped. See below.
 *
 *        RECHECK_EVERY_REDIRECT is the check people leave out, and it is the
 *        one the attack actually uses: a public, innocuous URL that returns
 *        `302 Location: http://169.254.169.254/...`. Validating only the URL
 *        the customer typed passes it. So the fetch is performed with
 *        `redirect: 'manual'` and each hop is re-validated from scratch.
 *
 *        DNS_REBINDING is the residual risk and is NOT fully closed here, and
 *        that is worth stating rather than implying. Between our resolve and
 *        the fetch's own resolve, a hostile DNS server can return a public
 *        address first and a private one second (a TOCTOU on name
 *        resolution). Closing it completely means pinning the connection to
 *        the address we validated — a custom agent with a `lookup` hook — and
 *        that is not reachable through `fetch` without replacing the
 *        transport. The mitigation here is a short TTL window: we resolve
 *        immediately before fetching, and every redirect re-resolves. Grep
 *        this symbol before anyone claims the guard is complete.
 *
 *        ALL OF IT IS PURE except the DNS lookup, which is injectable. That is
 *        what lets the interesting cases — a redirect into a private range,
 *        a public name resolving to loopback, an IPv6-mapped IPv4 address — be
 *        unit tested with no network at all. A security control nobody can
 *        test is a security control nobody can change safely.
 * WHERE: src/lib/script/ingest.ts, before any fetch of a customer URL.
 */

import { lookup as dnsLookup } from "node:dns/promises";

/**
 * SOURCE OF TRUTH KEYWORDS: UrlGuardError
 *
 * WHAT:  A URL this server refuses to fetch, with a customer-facing reason.
 * WHY:   `message` is deliberately vague about WHY an address was blocked —
 *        "that address is not reachable" rather than "that resolves to
 *        10.0.0.5". The refusal reason is a probe: an attacker who learns
 *        which internal addresses exist has been handed a port scanner. The
 *        specific reason goes in `detail`, which is logged and never
 *        rendered.
 * WHERE: Thrown by assertFetchableUrl and the guarded fetch.
 */
export class UrlGuardError extends Error {
  readonly detail: string;

  constructor(message: string, detail = "") {
    super(message);
    this.name = "UrlGuardError";
    this.detail = detail;
  }
}

/** Only https. See the scheme note in the file header. */
const ALLOWED_PROTOCOLS = new Set(["https:"]);

/**
 * SOURCE OF TRUTH KEYWORDS: MAX_REDIRECTS
 *
 * Five is enough for the legitimate case — canonical-host, trailing-slash,
 * country redirect, consent interstitial — and short enough that a redirect
 * loop costs five requests rather than a worker.
 */
export const MAX_REDIRECTS = 5;

/**
 * SOURCE OF TRUTH KEYWORDS: BLOCKED_RANGES, isBlockedAddress
 *
 * WHAT:  True when an IP address is one this server must never fetch from.
 * WHY:   BLOCKED_RANGES. An allowlist of public space is not expressible —
 *        "the public internet" is every range minus these — so this is a
 *        deny-list, and it is written out rather than pulled from a package so
 *        every entry can carry its reason:
 *
 *          - 127/8, ::1          loopback: our own services
 *          - 10/8, 172.16/12,
 *            192.168/16          RFC1918: the private network we sit in
 *          - 169.254/16, fe80::  LINK-LOCAL: the metadata service. The one
 *                                that leaks credentials.
 *          - 100.64/10           carrier-grade NAT, used by some cloud fabrics
 *          - 0/8, ::             "this network"; 0.0.0.0 routes to localhost
 *                                on several stacks
 *          - 192.0.0/24, 198.18/15,
 *            192.0.2/24, 198.51.100/24,
 *            203.0.113/24        IETF special-purpose and documentation
 *          - 224/4, ff00::       multicast
 *          - 240/4               reserved
 *          - fc00::/7            IPv6 unique-local, the RFC1918 equivalent
 *
 *        IPv4-MAPPED IPv6 is handled explicitly (`::ffff:127.0.0.1`), because
 *        a resolver returning the mapped form of a loopback address would
 *        otherwise walk straight past the IPv4 table.
 * WHERE: assertFetchableUrl, after every resolution.
 */
export function isBlockedAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (value.length === 0) return true;

  /* An IPv6 address may carry a zone index (`fe80::1%eth0`) which is not part
   * of the address and breaks the comparisons below. */
  const bare = value.split("%")[0] ?? value;

  if (bare.includes(":")) return isBlockedIpv6(bare);
  return isBlockedIpv4(bare);
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) {
    /* Not a dotted quad — treat as blocked rather than guessing. A resolver
     * returned something this function does not understand, and the safe
     * reading of "I do not understand this address" is "do not fetch it". */
    return true;
  }

  const octets = parts.map((part) => Number(part));
  if (
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }

  const [a = 0, b = 0] = octets;

  if (a === 0) return true; // "this network"; 0.0.0.0 is localhost on many stacks
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // LINK-LOCAL — the metadata service
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0 && octets[2] === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && octets[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast (224/4) and reserved (240/4)

  return false;
}

function isBlockedIpv6(address: string): boolean {
  /* IPv4-mapped (`::ffff:127.0.0.1`) and IPv4-compatible forms carry an IPv4
   * address inside an IPv6 one. Without this, `::ffff:169.254.169.254` would
   * skip the entire IPv4 table above. */
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1] !== undefined) return isBlockedIpv4(mapped[1]);

  if (address === "::" || address === "::1") return true; // unspecified, loopback

  /* fe80::/10 link-local — the IPv6 metadata address lives here. */
  if (/^fe[89ab][0-9a-f]:/.test(address)) return true;
  /* fc00::/7 unique-local — the IPv6 RFC1918. */
  if (/^f[cd][0-9a-f]{2}:/.test(address)) return true;
  /* ff00::/8 multicast. */
  if (/^ff[0-9a-f]{2}:/.test(address)) return true;

  return false;
}

/**
 * SOURCE OF TRUTH KEYWORDS: UrlResolver, assertFetchableUrl
 *
 * WHAT:  How a hostname becomes addresses. Injectable so the guard is testable.
 * WHY:   The guard's interesting cases are all about what a name RESOLVES to,
 *        and a test that depended on real DNS would be slow, flaky, and
 *        dependent on somebody continuing to point `localtest.me` at
 *        loopback. One function parameter makes every case deterministic.
 * WHERE: assertFetchableUrl's options; defaulted to node:dns.
 */
export type UrlResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: UrlResolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true });
  return results.map((entry) => entry.address);
};

/**
 * SOURCE OF TRUTH KEYWORDS: assertFetchableUrl, SSRF_GUARD
 *
 * WHAT:  Throws unless this exact URL is safe for the server to fetch.
 * WHY:   Returns the validated `URL` so a caller cannot accidentally fetch a
 *        DIFFERENT string from the one that was checked — passing a string in
 *        and fetching the original is how a guard gets bypassed by a stray
 *        `.trim()`.
 * WHERE: Called once per hop by `guardedFetch`, and directly by any future
 *        code that fetches a customer-supplied URL.
 */
export async function assertFetchableUrl(
  rawUrl: string,
  options: { resolver?: UrlResolver } = {},
): Promise<URL> {
  const resolver = options.resolver ?? defaultResolver;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlGuardError(
      "That does not look like a web address.",
      `unparseable: ${rawUrl}`,
    );
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UrlGuardError(
      "Only https links can be used. Paste the article text instead if the site is http-only.",
      `blocked scheme: ${url.protocol}`,
    );
  }

  /* Rejected, not stripped — see the credentials note in the file header. */
  if (url.username.length > 0 || url.password.length > 0) {
    throw new UrlGuardError(
      "That link contains login details, which we will not follow.",
      "url carried credentials",
    );
  }

  if (url.hostname.length === 0) {
    throw new UrlGuardError(
      "That does not look like a web address.",
      "empty hostname",
    );
  }

  let addresses: string[];
  try {
    addresses = await resolver(url.hostname);
  } catch (error) {
    throw new UrlGuardError(
      "That site could not be reached. Check the link, or paste the text instead.",
      `dns failed for ${url.hostname}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (addresses.length === 0) {
    throw new UrlGuardError(
      "That site could not be reached. Check the link, or paste the text instead.",
      `no addresses for ${url.hostname}`,
    );
  }

  /* EVERY address, not the first. A name that resolves to one public and one
   * private address is a rebinding attempt, and connecting is not guaranteed
   * to pick the one we validated. */
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new UrlGuardError(
        "That address cannot be reached from here. Paste the text instead.",
        `${url.hostname} resolves to blocked address ${address}`,
      );
    }
  }

  return url;
}

/**
 * SOURCE OF TRUTH KEYWORDS: guardedFetch, RECHECK_EVERY_REDIRECT, MAX_REDIRECTS
 *
 * WHAT:  Fetches a customer-supplied URL, validating every hop.
 *
 * WHY:   RECHECK_EVERY_REDIRECT is the reason this function exists instead of
 *        a bare `fetch` after one `assertFetchableUrl`. The attack is not a
 *        private URL — anybody can see that one coming. It is a PUBLIC,
 *        innocuous URL whose server answers `302 Location:
 *        http://169.254.169.254/latest/meta-data/`. Validate once and that
 *        redirect is followed by the platform, inside our network, with our
 *        identity, and the guard never sees the address it was written to
 *        block.
 *
 *        So `redirect: 'manual'` and the loop is ours: every `Location` is
 *        resolved against the current URL and run through the full guard
 *        again — scheme, credentials, and a fresh DNS check — before another
 *        request is made.
 *
 *        A relative `Location` is resolved against the CURRENT url rather than
 *        the original, which is what the spec says and is also the only
 *        reading that stays correct after a cross-host hop.
 *
 *        The body is capped by `maxBytes` while STREAMING, not after. A
 *        `Content-Length` header is a claim by a server we have already
 *        established we do not trust, so an unbounded read of a hostile
 *        response is a worker killed by a slow multi-gigabyte body.
 * WHERE: src/lib/script/ingest.ts.
 */
export async function guardedFetch(
  rawUrl: string,
  options: {
    resolver?: UrlResolver | undefined;
    maxBytes: number;
    timeoutMs: number;
    fetchImpl?: typeof fetch | undefined;
  },
): Promise<{ body: string; finalUrl: string; contentType: string }> {
  const doFetch = options.fetchImpl ?? fetch;
  const resolverOption =
    options.resolver === undefined ? {} : { resolver: options.resolver };

  let current = await assertFetchableUrl(rawUrl, resolverOption);

  /* One budget for the whole chain, not per request — five hops that each take
   * the full timeout is still a worker held for five timeouts. */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await doFetch(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          /* Identifying ourselves honestly. A site that blocks us can then do
           * so deliberately rather than by fingerprint, and an operator
           * reading their logs can tell who we are. */
          "user-agent": "brainrotreels-script-ingest/1.0",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        },
      });

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (location === null || location.length === 0) {
          throw new UrlGuardError(
            "That link could not be followed. Paste the text instead.",
            `${response.status} with no Location header`,
          );
        }

        if (hop === MAX_REDIRECTS) {
          throw new UrlGuardError(
            "That link redirects too many times. Paste the text instead.",
            `exceeded ${MAX_REDIRECTS} redirects`,
          );
        }

        /* Resolved against the CURRENT url, then fully re-validated. This is
         * RECHECK_EVERY_REDIRECT. */
        const next = new URL(location, current).toString();
        current = await assertFetchableUrl(next, resolverOption);
        continue;
      }

      if (!response.ok) {
        throw new UrlGuardError(
          response.status === 401 || response.status === 403
            ? "That article is behind a login or paywall. Paste the text instead."
            : "That page could not be read. Check the link, or paste the text instead.",
          `${response.status} ${response.statusText} for ${current.toString()}`,
        );
      }

      const body = await readCapped(response, options.maxBytes);

      return {
        body,
        finalUrl: current.toString(),
        contentType: response.headers.get("content-type") ?? "",
      };
    }

    /* Unreachable: the loop either returns or throws. Here so the function has
     * no implicit undefined path. */
    throw new UrlGuardError(
      "That link could not be followed. Paste the text instead.",
      "redirect loop exited unexpectedly",
    );
  } catch (error) {
    if (error instanceof UrlGuardError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new UrlGuardError(
        "That site took too long to respond. Paste the text instead.",
        `timed out after ${options.timeoutMs}ms`,
      );
    }
    throw new UrlGuardError(
      "That site could not be reached. Check the link, or paste the text instead.",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}

/* 307 and 308 preserve the method; 301/302/303 may not. All five are followed
 * here because this is a GET either way. */
function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: readCapped, CAP_WHILE_STREAMING
 *
 * WHAT:  Reads a response body up to a byte cap, then stops.
 * WHY:   CAP_WHILE_STREAMING. Checking `Content-Length` and then calling
 *        `.text()` is not a cap — the header is a claim by a server we have
 *        already decided not to trust, and a response that omits it or lies
 *        about it is read in full. Cancelling the stream at the cap bounds the
 *        memory whatever the server does.
 *
 *        Truncation is SILENT and that is correct here: the caller caps input
 *        length anyway (a script is made from the first few thousand words,
 *        not from an entire site), so a truncated article is a usable article.
 * WHERE: guardedFetch.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;

      chunks.push(value);
      total += value.byteLength;
      if (total >= maxBytes) break;
    }
  } finally {
    /* Releases the connection whether we finished or stopped early. Without
     * this a capped read leaks a socket per hostile response. */
    await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(
    merged.subarray(0, maxBytes),
  );
}
