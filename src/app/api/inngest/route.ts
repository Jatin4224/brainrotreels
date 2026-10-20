/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: inngest route, serve, INNGEST_FUNCTIONS, maxDuration,
 *   nodejs runtime, workflow endpoint
 *
 * WHAT:  The endpoint Inngest calls to discover and execute workflow steps.
 * WHY:   `runtime = 'nodejs'` because workflows reach Prisma and, later,
 *        FFmpeg-adjacent code — none of which runs on edge.
 *        `maxDuration = 300` bounds a single STEP invocation, not a workflow.
 *        That distinction is the one to remember: a workflow may run for
 *        hours, but each step must return inside this window, which is exactly
 *        why long work is started in one step and awaited by webhook in
 *        another rather than polled inline.
 *        `dynamic = 'force-dynamic'` keeps Next from trying to prerender it.
 *        Signature verification is handled by the SDK from INNGEST_SIGNING_KEY;
 *        in dev with no key it accepts the local dev server, which is why the
 *        key is optional in env rather than required.
 * WHERE: Registered with Inngest as the app's serve endpoint. Workflows come
 *        from src/inngest/functions.
 */

import { serve } from "inngest/next";

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import { INNGEST_FUNCTIONS } from "@/inngest/functions";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngestClient,
  functions: INNGEST_FUNCTIONS,
});
