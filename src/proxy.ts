/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: proxy, config
 *
 * WHAT:  Next.js 16 routing middleware — short-circuits static assets, forwards
 *        x-pathname/x-hostname to RSCs, and redirects /sign-up when registration
 *        is closed.
 * WHY:   File is named `proxy.ts` (Next.js 16 rename of `middleware.ts`) and
 *        propagation goes on REQUEST headers via NextResponse.next({ request })
 *        — response headers would only reach the browser, not RSCs.
 * WHERE: Reads REGISTRATION_OPEN from src/lib/config/registration; downstream
 *        RSCs and route handlers read the injected headers via `await headers()`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { REGISTRATION_OPEN } from '@/lib/config/registration'
import { AUTH_ROUTES } from '@/lib/config/auth-routes'

/**
 * SOURCE OF TRUTH KEYWORDS: appProxy
 *
 * WHAT:  The app's own per-request logic — static-asset bypass, optional
 *        sign-up redirect, and request-header propagation.
 * WHY:   Split out from the exported `proxy` so a provider that has to WRAP the
 *        request can run this as its inner handler instead of the logic being
 *        duplicated per provider. Better Auth needs no wrapper, so today `proxy`
 *        just calls this — the split is the seam a provider with middleware
 *        plugs into.
 * WHERE: Called by `proxy` below.
 */
async function appProxy(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname
  const hostname = request.headers.get('host') || request.nextUrl.hostname

  /* Belt-and-braces with the matcher below: if someone relaxes the matcher
   * later, this runtime check still keeps the function out of static-asset
   * paths. */
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/images/') ||
    pathname.startsWith('/fonts/') ||
    /\.(png|jpg|jpeg|gif|svg|ico|webp|css|js|woff|woff2|ttf|eot)$/.test(pathname)
  ) {
    return NextResponse.next()
  }

  /* Registration closed — bounce sign-up attempts to the sign-in page so
   * the user sees a sensible page instead of an auth.ts error. The DB-level
   * hook in `auth.ts` is the real enforcement; this redirect just makes the
   * UX cleaner. Toggled by NEXT_PUBLIC_REGISTRATION_OPEN. */
  if (
    !REGISTRATION_OPEN &&
    (pathname === AUTH_ROUTES.signUp || pathname.startsWith(`${AUTH_ROUTES.signUp}/`))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = AUTH_ROUTES.signIn
    return NextResponse.redirect(url, 302)
  }

  /* RSCs can't access the raw NextRequest, so stamp the pathname/hostname
   * onto the REQUEST headers we forward downstream. Setting them on the
   * response would only leak them to the browser — RSCs read request headers
   * via `await headers()`, not response headers. */
  const forwardedHeaders = new Headers(request.headers)
  forwardedHeaders.set('x-pathname', pathname)
  forwardedHeaders.set('x-hostname', hostname)
  return NextResponse.next({ request: { headers: forwardedHeaders } })
}

/**
 * SOURCE OF TRUTH KEYWORDS: proxy, PROVIDER_ISOLATION
 *
 * WHAT:  The Next.js proxy entry point — runs the app's per-request logic.
 * WHY:   Better Auth reads its session from cookies inside the request that
 *        needs it, so there is no middleware to run and nothing to wrap.
 *        PROVIDER_ISOLATION: a provider that DOES require middleware must be
 *        reached from here through a dynamic `import()` inside a branch on
 *        AUTH_PROVIDER, never a static import — the proxy ships to the edge
 *        runtime on every single request, so a statically imported SDK is paid
 *        for whether or not it is selected. Wrap `appProxy` rather than editing
 *        it, so the app logic stays in one place.
 * WHERE: Wired by Next.js automatically; matcher below excludes static assets.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  return appProxy(request)
}

/**
 * SOURCE OF TRUTH KEYWORDS: config
 *
 * WHAT:  Matcher excluding static-asset paths so proxy isn't invoked for them.
 * WHY:   Belt-and-braces with the runtime guard inside proxy(); keeps the
 *        function out of the request path for assets entirely.
 * WHERE: Read by Next.js at build time; pairs with the runtime check in proxy().
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw\\.js|images|fonts).*)'],
}
