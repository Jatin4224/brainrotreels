/*

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

import "server-only";

import { RENDER_PROVIDER } from "./provider";
import type { RenderAdapter } from "./types";

export type {
  RenderAdapter,
  RenderOptions,
  RenderProgressResult,
  RenderProviderId,
  RenderStartResult,
  RenderStillResult,
  StillOptions,
} from "./types";
export { RENDER_PROVIDER_IDS, RenderProviderError } from "./types";
export { RENDER_PROVIDER, DEFAULT_RENDER_PROVIDER } from "./provider";

let adapterPromise: Promise<RenderAdapter> | null = null;

async function loadAdapter(): Promise<RenderAdapter> {
  /* Exhaustive over RenderProviderId — a new id without a case here is a
   * compile error at the `never` branch. */
  switch (RENDER_PROVIDER) {
    case "lambda": {
      const mod = await import("./lambda");
      return mod.lambdaRenderAdapter;
    }
    default: {
      const exhaustive: never = RENDER_PROVIDER;
      throw new Error(
        `[adapters/render] No adapter registered for "${String(exhaustive)}".`,
      );
    }
  }
}

export async function getRenderAdapter(): Promise<RenderAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter();
  }
  return adapterPromise;
}

/**
 * SOURCE OF TRUTH KEYWORDS: isRenderConfigured, ASK_BEFORE_YOU_SPEND,
 *   PROVIDER_ISOLATION
 *
 * WHAT:  Whether this deployment has a renderer at all.
 *
 * WHY:   ASK_BEFORE_YOU_SPEND. `getRenderAdapter` resolves happily on a
 *        deployment with no AWS configured — the throw comes later, from
 *        inside the first call, as a RenderProviderError. That is right for a
 *        paid render, which SHOULD fail loudly; it is wrong for optional work
 *        like the motion review pass, which has to be able to say "no
 *        renderer, so no review" and complete the stage with a warning rather
 *        than report a failure the customer cannot act on.
 *
 *        The config check stays behind the same dynamic import as the adapter
 *        (PROVIDER_ISOLATION), so asking the question still does not evaluate
 *        a provider SDK on a deployment that will never use one.
 * WHERE: src/lib/script/motion-review.ts.
 */
export async function isRenderConfigured(): Promise<boolean> {
  switch (RENDER_PROVIDER) {
    case "lambda": {
      const mod = await import("./lambda/config");
      return mod.isLambdaRenderConfigured();
    }
    default: {
      const exhaustive: never = RENDER_PROVIDER;
      void exhaustive;
      return false;
    }
  }
}
