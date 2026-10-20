/**
 * SOURCE OF TRUTH KEYWORDS: assertFetchableUrl, guardedFetch, isBlockedAddress,
 *   SSRF_GUARD, RECHECK_EVERY_REDIRECT, BLOCKED_RANGES, url guard tests
 *
 * WHAT:  Whether this server can be talked into fetching something it must not.
 *
 * WHY:   This is the highest-consequence code in Phase 06. A hole here is not
 *        a bad script — it is one unauthenticated GET from a customer-supplied
 *        URL to `169.254.169.254`, which on any cloud returns temporary
 *        credentials for the instance role. Every other test in this suite
 *        protects a feature; these protect the infrastructure.
 *
 *        They are written as ATTACKS rather than as coverage, because that is
 *        the only framing in which a missing case is visible: each test says
 *        what an attacker would send and what must happen. The resolver is
 *        injected, so every case is deterministic and needs no network — which
 *        is what makes it safe to change the guard later.
 * WHERE: Run by `npm test`. Guards src/lib/script/url-guard.ts.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  MAX_REDIRECTS,
  UrlGuardError,
  assertFetchableUrl,
  guardedFetch,
  isBlockedAddress,
} from './url-guard'

/** A resolver that answers every name with one fixed address. */
function resolvesTo(address: string) {
  return async () => [address]
}

/** A resolver that answers per hostname, for the redirect cases. */
function resolvesBy(map: Record<string, string>) {
  return async (hostname: string) => {
    const address = map[hostname]
    if (address === undefined) throw new Error(`no test mapping for ${hostname}`)
    return [address]
  }
}

const PUBLIC = '93.184.216.34'

describe('isBlockedAddress', () => {
  /**
   * The address that matters most. On AWS this is the instance metadata
   * service: an unauthenticated GET returns credentials for the instance
   * role. It is link-local, so no firewall sits between us and it.
   */
  it('blocks the cloud metadata address', () => {
    expect(isBlockedAddress('169.254.169.254')).toBe(true)
  })

  it('blocks every private and special-purpose range', () => {
    const blocked = [
      '127.0.0.1', // loopback
      '127.1.2.3', // all of 127/8, not just .0.1
      '10.0.0.1', // RFC1918
      '172.16.0.1', // RFC1918 lower bound
      '172.31.255.255', // RFC1918 upper bound
      '192.168.1.1', // RFC1918
      '169.254.1.1', // link-local generally
      '100.64.0.1', // carrier-grade NAT
      '0.0.0.0', // "this network" — localhost on several stacks
      '192.0.0.1', // IETF protocol assignments
      '192.0.2.1', // TEST-NET-1
      '198.18.0.1', // benchmarking
      '198.51.100.1', // TEST-NET-2
      '203.0.113.1', // TEST-NET-3
      '224.0.0.1', // multicast
      '240.0.0.1', // reserved
      '255.255.255.255', // broadcast
    ]
    for (const address of blocked) {
      expect(isBlockedAddress(address), address).toBe(true)
    }
  })

  it('allows ordinary public addresses', () => {
    /* The guard has to let the actual product work. A deny-list that blocks
     * 172.32.x — just outside RFC1918 — would silently break real sites. */
    for (const address of [PUBLIC, '8.8.8.8', '172.32.0.1', '172.15.255.255', '99.99.99.99']) {
      expect(isBlockedAddress(address), address).toBe(false)
    }
  })

  it('blocks IPv4-mapped IPv6 forms of private addresses', () => {
    /* `::ffff:169.254.169.254` is the metadata service wearing a different
     * hat. Without the mapped-form check it walks straight past the IPv4
     * table. */
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true)
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true)
  })

  it('blocks IPv6 loopback, link-local, unique-local and multicast', () => {
    for (const address of ['::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1']) {
      expect(isBlockedAddress(address), address).toBe(true)
    }
  })

  it('ignores an IPv6 zone index when deciding', () => {
    /* `fe80::1%eth0` is link-local with a zone attached. Comparing the raw
     * string would miss it. */
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true)
  })

  it('blocks anything it cannot parse', () => {
    /* "I do not understand this address" must read as "do not fetch it".
     * The opposite default is how a novel resolver response becomes a hole. */
    for (const address of ['', '   ', 'not-an-address', '1.2.3', '1.2.3.4.5', '999.1.1.1']) {
      expect(isBlockedAddress(address), JSON.stringify(address)).toBe(true)
    }
  })
})

describe('assertFetchableUrl', () => {
  it('accepts an ordinary https URL on a public address', async () => {
    const url = await assertFetchableUrl('https://example.com/article', {
      resolver: resolvesTo(PUBLIC),
    })
    expect(url.hostname).toBe('example.com')
  })

  it('rejects every scheme but https', async () => {
    for (const raw of [
      'http://example.com', // eavesdroppable, and what metadata services speak
      'file:///etc/passwd', // reads the worker's disk
      'gopher://example.com', // shapeable into other protocols
      'ftp://example.com',
      'javascript:alert(1)',
      'data:text/html,hi',
    ]) {
      await expect(
        assertFetchableUrl(raw, { resolver: resolvesTo(PUBLIC) }),
        raw,
      ).rejects.toThrow(UrlGuardError)
    }
  })

  it('rejects a URL carrying credentials rather than stripping them', async () => {
    /* `https://evil.com@internal/` reads to a human as evil.com and to a
     * parser as `internal`. Rejection is the only unsurprising reading. */
    await expect(
      assertFetchableUrl('https://user:pass@example.com/', { resolver: resolvesTo(PUBLIC) }),
    ).rejects.toThrow(UrlGuardError)
  })

  /**
   * The case that defeats hostname-based filtering: a perfectly ordinary
   * public name that resolves to loopback. Real names do this today.
   */
  it('rejects a public hostname that resolves to a blocked address', async () => {
    await expect(
      assertFetchableUrl('https://localtest.me/', { resolver: resolvesTo('127.0.0.1') }),
    ).rejects.toThrow(UrlGuardError)

    await expect(
      assertFetchableUrl('https://metadata.example/', {
        resolver: resolvesTo('169.254.169.254'),
      }),
    ).rejects.toThrow(UrlGuardError)
  })

  it('rejects a name that resolves to BOTH a public and a private address', async () => {
    /* A rebinding attempt. Checking only the first address would pass it, and
     * nothing guarantees the connection picks the one we validated. */
    await expect(
      assertFetchableUrl('https://split.example/', {
        resolver: async () => [PUBLIC, '169.254.169.254'],
      }),
    ).rejects.toThrow(UrlGuardError)
  })

  it('rejects a name that resolves to nothing, and one that fails to resolve', async () => {
    await expect(
      assertFetchableUrl('https://nowhere.example/', { resolver: async () => [] }),
    ).rejects.toThrow(UrlGuardError)

    await expect(
      assertFetchableUrl('https://broken.example/', {
        resolver: async () => {
          throw new Error('NXDOMAIN')
        },
      }),
    ).rejects.toThrow(UrlGuardError)
  })

  it('does not leak which internal address was hit', async () => {
    /* The refusal reason is a probe. An attacker who learns that
     * `10.0.0.5` exists has been handed a port scanner. */
    try {
      await assertFetchableUrl('https://internal.example/', {
        resolver: resolvesTo('10.0.0.5'),
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(UrlGuardError)
      const guardError = error as UrlGuardError
      expect(guardError.message).not.toContain('10.0.0.5')
      /* The operator still gets it, out of band. */
      expect(guardError.detail).toContain('10.0.0.5')
    }
  })
})

describe('guardedFetch', () => {
  function respond(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
    return new Response(body, {
      status: init.status ?? 200,
      headers: { 'content-type': 'text/html', ...(init.headers ?? {}) },
    })
  }

  it('returns the body of a plain public page', async () => {
    const result = await guardedFetch('https://example.com/a', {
      resolver: resolvesTo(PUBLIC),
      maxBytes: 1_000_000,
      timeoutMs: 5_000,
      fetchImpl: async () => respond('<h1>hello</h1>'),
    })
    expect(result.body).toContain('hello')
    expect(result.finalUrl).toBe('https://example.com/a')
  })

  /**
   * RECHECK_EVERY_REDIRECT — the attack this whole module exists for. The URL
   * the customer typed is public and innocuous; the SERVER sends them to the
   * metadata service. A guard that validates only the original URL follows it.
   */
  it('rejects a public URL that redirects into the metadata service', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('https://innocent.example')) {
        return respond('', {
          status: 302,
          headers: { location: 'https://metadata.example/latest/meta-data/' },
        })
      }
      /* If the guard ever reaches here, it followed the redirect — which is
       * the failure this test exists to catch. */
      return respond('SECRET CREDENTIALS')
    })

    await expect(
      guardedFetch('https://innocent.example/post', {
        resolver: resolvesBy({
          'innocent.example': PUBLIC,
          'metadata.example': '169.254.169.254',
        }),
        maxBytes: 1_000_000,
        timeoutMs: 5_000,
        fetchImpl: fetchImpl,
      }),
    ).rejects.toThrow(UrlGuardError)

    /* Exactly one request: the first. The redirect target was refused before
     * a second request was made. */
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects a redirect that downgrades to http', async () => {
    const fetchImpl = async () =>
      respond('', { status: 301, headers: { location: 'http://example.com/plain' } })

    await expect(
      guardedFetch('https://example.com/a', {
        resolver: resolvesTo(PUBLIC),
        maxBytes: 1_000_000,
        timeoutMs: 5_000,
        fetchImpl: fetchImpl,
      }),
    ).rejects.toThrow(UrlGuardError)
  })

  it('follows a legitimate redirect between public hosts', async () => {
    /* The guard has to let real sites work — canonical-host and
     * trailing-slash redirects are the normal case. */
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://example.com/a') {
        return respond('', { status: 301, headers: { location: 'https://www.example.com/a' } })
      }
      return respond('<p>final</p>')
    })

    const result = await guardedFetch('https://example.com/a', {
      resolver: resolvesBy({ 'example.com': PUBLIC, 'www.example.com': PUBLIC }),
      maxBytes: 1_000_000,
      timeoutMs: 5_000,
      fetchImpl: fetchImpl,
    })

    expect(result.body).toContain('final')
    expect(result.finalUrl).toBe('https://www.example.com/a')
  })

  it('resolves a relative redirect against the current URL', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://example.com/a/b') {
        return respond('', { status: 302, headers: { location: '../c' } })
      }
      return respond('relative ok')
    })

    const result = await guardedFetch('https://example.com/a/b', {
      resolver: resolvesTo(PUBLIC),
      maxBytes: 1_000_000,
      timeoutMs: 5_000,
      fetchImpl: fetchImpl,
    })

    expect(result.finalUrl).toBe('https://example.com/c')
  })

  it('gives up on a redirect loop instead of following it forever', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      return respond('', { status: 302, headers: { location: 'https://example.com/loop' } })
    }

    await expect(
      guardedFetch('https://example.com/loop', {
        resolver: resolvesTo(PUBLIC),
        maxBytes: 1_000_000,
        timeoutMs: 5_000,
        fetchImpl: fetchImpl,
      }),
    ).rejects.toThrow(UrlGuardError)

    expect(calls).toBeLessThanOrEqual(MAX_REDIRECTS + 1)
  })

  it('reports a paywall or login separately from a dead link', async () => {
    /* The phase asks for a clear error offering raw-text entry, and 401/403
     * is the case a customer can actually act on. */
    const paywalled = guardedFetch('https://example.com/a', {
      resolver: resolvesTo(PUBLIC),
      maxBytes: 1_000_000,
      timeoutMs: 5_000,
      fetchImpl: async () => respond('', { status: 403 }),
    })
    await expect(paywalled).rejects.toThrow(/paywall|login/i)

    const dead = guardedFetch('https://example.com/a', {
      resolver: resolvesTo(PUBLIC),
      maxBytes: 1_000_000,
      timeoutMs: 5_000,
      fetchImpl: async () => respond('', { status: 404 }),
    })
    await expect(dead).rejects.toThrow(/could not be read/i)
  })

  it('caps the body at maxBytes rather than trusting Content-Length', async () => {
    /* A hostile server can omit or lie about Content-Length. The cap has to
     * bound what is actually read. */
    const huge = 'x'.repeat(500_000)
    const result = await guardedFetch('https://example.com/a', {
      resolver: resolvesTo(PUBLIC),
      maxBytes: 1_000,
      timeoutMs: 5_000,
      fetchImpl: async () => respond(huge),
    })
    expect(result.body.length).toBeLessThanOrEqual(1_000)
  })
})
