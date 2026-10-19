/**
 * SOURCE OF TRUTH KEYWORDS: resolveAuthCallback, isAuthRoute, authRouteWithCallback,
 *                           OPEN_REDIRECT_GUARD, AUTH_CALLBACK_PARAM, auth-routes tests
 *
 * WHAT:  Unit tests for the auth route helpers, concentrated on the
 *        open-redirect guard in resolveAuthCallback.
 * WHY:   resolveAuthCallback is a security boundary: it decides where a user is
 *        sent immediately after authenticating. A gap turns our own sign-in
 *        page into a credible phishing hop on our own domain. The
 *        protocol-relative cases (`//host`, `/\host`) are the ones a naive
 *        startsWith('/') check lets through, so they are asserted explicitly
 *        rather than folded into a generic "rejects bad input" case.
 * WHERE: Run by `npm test`. Covers src/lib/config/auth-routes.ts.
 */

import { describe, expect, it } from 'vitest'

import {
  AUTH_CALLBACK_PARAM,
  AUTH_ROUTES,
  authRouteWithCallback,
  isAuthRoute,
  resolveAuthCallback,
} from './auth-routes'

describe('resolveAuthCallback', () => {
  it('accepts a site-relative path', () => {
    expect(resolveAuthCallback('/dashboard')).toBe('/dashboard')
    expect(resolveAuthCallback('/dashboard/settings/billing')).toBe('/dashboard/settings/billing')
  })

  it('accepts a path carrying its own query string', () => {
    expect(resolveAuthCallback('/dashboard?tab=media')).toBe('/dashboard?tab=media')
  })

  it('trims surrounding whitespace', () => {
    expect(resolveAuthCallback('  /dashboard  ')).toBe('/dashboard')
  })

  /* The whole vulnerability: both start with a slash, and both resolve to
   * another ORIGIN in a browser. */
  it('rejects protocol-relative URLs', () => {
    expect(resolveAuthCallback('//evil.example')).toBeNull()
    expect(resolveAuthCallback('//evil.example/path')).toBeNull()
    expect(resolveAuthCallback('/\\evil.example')).toBeNull()
    expect(resolveAuthCallback('/\\\\evil.example')).toBeNull()
  })

  it('rejects absolute URLs', () => {
    expect(resolveAuthCallback('https://evil.example')).toBeNull()
    expect(resolveAuthCallback('http://evil.example')).toBeNull()
    expect(resolveAuthCallback('javascript:alert(1)')).toBeNull()
  })

  it('rejects anything not starting with a slash', () => {
    expect(resolveAuthCallback('dashboard')).toBeNull()
    expect(resolveAuthCallback('../dashboard')).toBeNull()
  })

  /* Control characters can smuggle a second header or URL past a naive parser. */
  it('rejects control characters and embedded whitespace', () => {
    expect(resolveAuthCallback('/dash\nboard')).toBeNull()
    expect(resolveAuthCallback('/dash\tboard')).toBeNull()
    expect(resolveAuthCallback('/dash board')).toBeNull()
    expect(resolveAuthCallback('/dashboard\x00')).toBeNull()
    expect(resolveAuthCallback('/dashboard\x7f')).toBeNull()
  })

  it('rejects empty and missing input', () => {
    expect(resolveAuthCallback('')).toBeNull()
    expect(resolveAuthCallback('   ')).toBeNull()
    expect(resolveAuthCallback(undefined)).toBeNull()
  })

  /* A repeated ?callbackURL= arrives as an array — ambiguous intent, and the
   * usual shape of someone probing the parser. */
  it('rejects a repeated parameter arriving as an array', () => {
    expect(resolveAuthCallback(['/dashboard', '//evil.example'])).toBeNull()
    expect(resolveAuthCallback(['/dashboard'])).toBeNull()
  })
})

describe('isAuthRoute', () => {
  it('matches every declared auth route exactly', () => {
    for (const route of Object.values(AUTH_ROUTES)) {
      expect(isAuthRoute(route)).toBe(true)
    }
  })

  it('matches nested paths beneath an auth route', () => {
    expect(isAuthRoute(`${AUTH_ROUTES.signIn}/callback`)).toBe(true)
  })

  it('does not match app routes', () => {
    expect(isAuthRoute('/dashboard')).toBe(false)
    expect(isAuthRoute('/')).toBe(false)
  })

  /* Prefix matching must not treat a longer sibling as a child route. */
  it('does not match a route that merely shares a prefix', () => {
    expect(isAuthRoute(`${AUTH_ROUTES.signIn}-evil`)).toBe(false)
  })
})

describe('authRouteWithCallback', () => {
  it('returns the route unchanged when there is no callback', () => {
    expect(authRouteWithCallback(AUTH_ROUTES.signIn, null)).toBe(AUTH_ROUTES.signIn)
    expect(authRouteWithCallback(AUTH_ROUTES.signIn, '')).toBe(AUTH_ROUTES.signIn)
  })

  it('appends an encoded callback', () => {
    expect(authRouteWithCallback(AUTH_ROUTES.signIn, '/dashboard')).toBe(
      `${AUTH_ROUTES.signIn}?${AUTH_CALLBACK_PARAM}=%2Fdashboard`,
    )
  })

  it('encodes a callback that carries its own query string', () => {
    const result = authRouteWithCallback(AUTH_ROUTES.signIn, '/dashboard?tab=media')
    expect(result).toBe(`${AUTH_ROUTES.signIn}?${AUTH_CALLBACK_PARAM}=%2Fdashboard%3Ftab%3Dmedia`)
    /* The encoding is what stops the callback from injecting a second parameter. */
    expect(result.split('?')).toHaveLength(2)
  })
})
