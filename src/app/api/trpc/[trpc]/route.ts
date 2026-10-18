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
 * SOURCE OF TRUTH KEYWORDS: GET, POST, runtime, maxDuration, dynamic
 *
 * WHAT:  The tRPC HTTP handler — every client-side tRPC call lands here.
 * WHY:   Wraps fetchRequestHandler with apiLimiter so rate-limit headers fire
 *        before any procedure resolves; 429 short-circuits without touching
 *        the DB or auth path.
 * WHERE: Routes traffic to appRouter (src/trpc/routers/_app); rate limiter
 *        comes from src/lib/rate-limit; context built in src/trpc/init.
 */

import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@/trpc/routers/_app'
import { createTRPCContext } from '@/trpc/init'
import {
  apiLimiter,
  buildRateLimitHeaders,
  checkRateLimit,
  getClientIp,
} from '@/lib/rate-limit'

// Node runtime: Edge can't reliably hold SSE connections open.
// maxDuration 300s: Vercel default of 10s is too short for subscriptions;
// tRPC's tracked() resume-from-id handles platform-level reconnects.
export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

async function handler(req: Request): Promise<Response> {
  // IP-keyed pre-auth ceiling; protected procedures additionally rate-limit per user.
  const ip = getClientIp(req.headers)
  const identifier = ip ?? 'trpc:anonymous'

  const result = await checkRateLimit(apiLimiter, identifier)
  if (!result.allowed) {
    return new Response(
      JSON.stringify({
        error: 'TOO_MANY_REQUESTS',
        message: 'Too many requests. Please slow down.',
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          ...buildRateLimitHeaders(result),
        },
      }
    )
  }

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: createTRPCContext,
    responseMeta: ({ type }) => {
      if (type === 'subscription') {
        // X-Accel-Buffering: no — keep nginx/Cloudflare from buffering SSE chunks.
        return {
          headers: {
            'X-Accel-Buffering': 'no',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Connection: 'keep-alive',
          },
        }
      }
      return {}
    },
  })
}

export { handler as GET, handler as POST }
