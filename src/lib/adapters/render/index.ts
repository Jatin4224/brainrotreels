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
 * SOURCE OF TRUTH KEYWORDS: getRenderAdapter, RenderAdapter, PROVIDER_ISOLATION,
 *   dynamic import, RENDER_PROVIDER, LAMBDA_IS_RIGHT_FOR_RENDERING
 *
 * WHAT:  The only sanctioned way for app code to start a cloud render.
 * WHY:   The dynamic `import()` is the isolation guarantee, exactly as in the
 *        jobs, storage and media seams: `@remotion/lambda` pulls the AWS SDK
 *        and the whole Remotion bundler with it, so it must never be evaluated
 *        in a process that is not rendering — and certainly never reach a page
 *        bundle. eslint confines those imports to ./lambda.
 *
 *        Where the work runs, and why it differs from ingest, is recorded in
 *        ./types.ts under LAMBDA_IS_RIGHT_FOR_RENDERING. Read it before
 *        calling any of this from somewhere new: these methods may only be
 *        called from a workflow step. A tRPC mutation runs inside a 10-second
 *        Prisma transaction and a route handler inside a serverless budget;
 *        `start()` is a provider round-trip that can exceed both, and it has a
 *        bill attached, so it belongs behind the gates in the procedure layer
 *        and the durability of a workflow — never in the request that asked
 *        for it.
 * WHERE: src/inngest/functions/project-render.ts.
 */

import 'server-only'

import { RENDER_PROVIDER } from './provider'
import type { RenderAdapter } from './types'

export type {
  RenderAdapter,
  RenderOptions,
  RenderProgressResult,
  RenderProviderId,
  RenderStartResult,
} from './types'
export { RENDER_PROVIDER_IDS, RenderProviderError } from './types'
export { RENDER_PROVIDER, DEFAULT_RENDER_PROVIDER } from './provider'

let adapterPromise: Promise<RenderAdapter> | null = null

async function loadAdapter(): Promise<RenderAdapter> {
  /* Exhaustive over RenderProviderId — a new id without a case here is a
   * compile error at the `never` branch. */
  switch (RENDER_PROVIDER) {
    case 'lambda': {
      const mod = await import('./lambda')
      return mod.lambdaRenderAdapter
    }
    default: {
      const exhaustive: never = RENDER_PROVIDER
      throw new Error(`[adapters/render] No adapter registered for "${String(exhaustive)}".`)
    }
  }
}

export async function getRenderAdapter(): Promise<RenderAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter()
  }
  return adapterPromise
}
