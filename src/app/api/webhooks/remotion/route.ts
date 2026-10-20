/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: POST, remotionWebhook, render/finished,
 *   VERIFY_BEFORE_ANYTHING, SIGNATURE_IS_OVER_RESTRINGIFIED_JSON,
 *   WEBHOOK_ONLY_RELAYS, RENDER_ID_FROM_CUSTOM_DATA, ACK_WHAT_WE_CANNOT_USE
 *
 * WHAT:  The endpoint the render provider calls when a render ends. It
 *        verifies the signature, translates the payload into this app's own
 *        vocabulary, and relays it onto the queue as
 *        `render/finished` so the waiting workflow resumes.
 *
 * WHY:   VERIFY_BEFORE_ANYTHING. The signature is checked before a single
 *        database row is read and before anything is enqueued. This endpoint
 *        is public by necessity — AWS has to reach it — so without the check
 *        it is an unauthenticated way for anyone to tell us a render finished,
 *        and the thing they would be telling us is "mark this render complete
 *        and store THIS url as the customer's video". The phase's last "done
 *        when" check is that an unsigned or wrongly-signed call is rejected,
 *        and the ordering is what makes it true rather than nearly true.
 *
 *        SIGNATURE_IS_OVER_RESTRINGIFIED_JSON, and this is the one place this
 *        route genuinely differs from the Stripe webhook it is otherwise
 *        modelled on. Stripe signs the RAW BODY, so that handler must read
 *        `request.text()` and must not parse first. Remotion signs
 *        `JSON.stringify(body)` — the parsed object re-serialised — so the
 *        raw bytes are NOT what the HMAC covers, and passing the raw text
 *        would fail verification for every genuine call. The body is therefore
 *        parsed first and the PARSED VALUE is handed to the verifier. That is
 *        only sound because the payload is machine-generated with stable key
 *        order; it is written down here because "follow the Stripe webhook"
 *        would otherwise lead the next person to a handler that rejects
 *        everything.
 *
 *        WEBHOOK_ONLY_RELAYS. It does not store the MP4, does not create
 *        assets and does not write the render's status. The phase's step 6
 *        asks it to do the first two; the full reasoning for moving them is in
 *        FINALIZE_DOES_THE_COPY in src/inngest/functions/project-render.ts, and
 *        the short version is that this is a serverless request with the
 *        tightest budget in the system, the provider retries it if it is slow,
 *        and a failure here would surface as a render timeout forty minutes
 *        later. So it does the one thing only it can do — verify and relay —
 *        and returns in milliseconds.
 *
 *        RENDER_ID_FROM_CUSTOM_DATA. Our row is found through the
 *        `customData.renderId` the adapter sent out with the render, not
 *        through `providerRenderId`. Both would usually work and only one
 *        always does: there is a window between the provider accepting a
 *        render and our transaction committing its id, and a very fast render
 *        can call back inside it. Matching on data we chose ourselves has no
 *        such window.
 *
 *        ACK_WHAT_WE_CANNOT_USE. A correctly-signed call we cannot act on —
 *        a renderId that no longer exists, an unrecognised payload shape — is
 *        answered 200, exactly as the Stripe handler acknowledges event types
 *        it does not handle. A non-2xx makes the provider retry on a schedule,
 *        and retrying will not make a deleted render exist; the retries would
 *        simply continue until the provider gave up. A call we could not
 *        VERIFY is a different thing and gets a 400.
 * WHERE: Registered as the webhook URL by the `start-render` step, built from
 *        APP_URL. Configure nothing in a dashboard — the URL is sent with each
 *        render, which is what lets a preview deployment keep its own renders.
 */

import { NextResponse } from "next/server";

import { enqueue } from "@/lib/adapters/jobs";
import { getRemotionWebhookSecret } from "@/lib/adapters/render/lambda/config";
import {
  remotionWebhookPayloadSchema,
  verifyRemotionSignature,
} from "@/lib/adapters/render/lambda/webhook";

/* Signature verification needs Node's crypto, and `enqueue` reaches the jobs
 * provider — neither runs on edge. Same reason as the Stripe webhook. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The header Remotion sends its HMAC in. */
const SIGNATURE_HEADER = "X-Remotion-Signature";

export async function POST(request: Request): Promise<NextResponse> {
  const secret = getRemotionWebhookSecret();
  if (secret === null) {
    /* 503 rather than 500: the endpoint is not broken, it is not configured —
     * and with no secret there is no way to tell a genuine call from a forged
     * one, so accepting anything would be worse than refusing everything. */
    return NextResponse.json(
      { error: "The render webhook is not configured" },
      { status: 503 },
    );
  }

  const signature = request.headers.get(SIGNATURE_HEADER);
  if (signature === null || signature.length === 0) {
    return NextResponse.json(
      { error: "Missing render webhook signature" },
      { status: 400 },
    );
  }

  /* SIGNATURE_IS_OVER_RESTRINGIFIED_JSON — parsed first, deliberately. See the
   * file header before changing this to request.text(). */
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body is not JSON" }, { status: 400 });
  }

  /* VERIFY_BEFORE_ANYTHING. Nothing above this line touched the database or
   * the queue, and nothing below it runs if this fails. */
  if (!verifyRemotionSignature({ secret, body, signatureHeader: signature })) {
    console.error("[remotion-webhook] signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const parsed = remotionWebhookPayloadSchema.safeParse(body);
  if (!parsed.success) {
    /* ACK_WHAT_WE_CANNOT_USE. Signed by us, so it is genuine — just not a
     * shape this build understands, which is what a provider upgrade looks
     * like. Logged loudly and acknowledged, because retrying it will produce
     * the identical payload. */
    console.error(
      "[remotion-webhook] a correctly-signed payload did not match the expected shape:",
      parsed.error.issues.slice(0, 5),
    );
    return NextResponse.json({ received: true, acted: false });
  }

  const payload = parsed.data;
  /* Bracketed because `customData` is an open record — the provider echoes
   * whatever it was given, so the key is data rather than a known property. */
  const renderId = payload.customData?.["renderId"];

  if (typeof renderId !== "string" || renderId.length === 0) {
    /* RENDER_ID_FROM_CUSTOM_DATA — without it there is no way to know which
     * row this is about. Every render this build starts sends it, so this can
     * only be a render started by an older deploy. */
    console.error(
      `[remotion-webhook] payload for provider render ${payload.renderId} carries no renderId in customData`,
    );
    return NextResponse.json({ received: true, acted: false });
  }

  /* WEBHOOK_ONLY_RELAYS. The whole handler, right here: translate the
   * provider's three payload types into our own outcome, and put it on the
   * queue. The workflow does everything that touches storage or the row. */
  try {
    await enqueue({
      name: "render/finished",
      data: {
        renderId,
        outcome: payload.type,
        outputUrl:
          payload.type === "success" ? (payload.outputUrl ?? null) : null,
        error:
          payload.type === "error"
            ? (payload.errors?.[0]?.message ??
              "The renderer reported an error with no message.")
            : payload.type === "timeout"
              ? "The renderer timed out while producing this video."
              : null,
      },
      /* Deduplicated on the provider's render id and the outcome, so an
       * at-least-once delivery — the provider's normal behaviour, not a fault
       * — produces one event rather than one per delivery. The workflow's
       * finalize step is idempotent anyway; this stops it having to be twice. */
      id: `render-finished-${payload.renderId}-${payload.type}`,
    });
  } catch (error) {
    /* ENQUEUE_FAILURE_MUST_RETRY, and this is the one case where a non-2xx is
     * the right answer. The queue is how the waiting workflow finds out the
     * render ended; if the enqueue failed, nobody will ever tell it, and it
     * will sit until the 45-minute timeout and then record `timedOut` for a
     * video that rendered perfectly. A 500 makes the provider deliver again on
     * its own retry schedule, which is exactly what is wanted — and the
     * idempotency key above means the eventual success still produces one
     * event. Caught rather than left to propagate so the response is a clean
     * JSON body instead of a framework stack trace, matching the Stripe
     * webhook's handler-error branch. */
    console.error(
      `[remotion-webhook] could not enqueue render/finished for ${renderId}:`,
      error,
    );
    return NextResponse.json(
      { error: "Could not record this render" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true, acted: true });
}
