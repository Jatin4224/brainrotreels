/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: verifyRemotionSignature, remotionWebhookPayloadSchema,
 *   RemotionWebhookPayload, PROVIDER_ISOLATION, SIGNATURE_FROM_THE_SDK,
 *   VERIFY_RETURNS_A_BOOLEAN
 *
 * WHAT:  The two provider-specific halves of the render webhook: how to check
 *        its signature, and what its payload looks like.
 *
 * WHY:   PROVIDER_ISOLATION. The route at src/app/api/webhooks/remotion is
 *        application code and must not import the provider's SDK — eslint
 *        enforces that — so the one piece of the provider's vocabulary it
 *        genuinely needs lives here, in the provider's own folder, behind two
 *        plain functions. Swapping renderers replaces this file and the route
 *        keeps its shape.
 *
 *        SIGNATURE_FROM_THE_SDK. The HMAC is computed by the provider's own
 *        `validateWebhookSignature` rather than reimplemented with
 *        `node:crypto`. Reimplementing it is about fifteen lines and is the
 *        wrong fifteen lines: the scheme (sha512 over the re-stringified body,
 *        prefixed `sha512=`, compared in constant time) is the PROVIDER's
 *        decision, and a copy of it would keep verifying happily after an
 *        upgrade changed it — which presents as every render stalling at the
 *        wait step with no error anywhere. The cost is that this module pulls
 *        the SDK into the webhook route's bundle; a webhook route runs on
 *        nodejs with no cold-start budget worth protecting, so that is the
 *        cheaper side of the trade.
 *
 *        VERIFY_RETURNS_A_BOOLEAN. The SDK THROWS on a mismatch, with
 *        different messages for "no signature" and "signatures do not match".
 *        A route that let that propagate would answer 500 — which tells a
 *        caller the server is broken and invites the provider to retry a
 *        forged request on a schedule — where the honest answer is 400. One
 *        boundary, one boolean, and the route decides the status code.
 * WHERE: src/app/api/webhooks/remotion/route.ts.
 */

import "server-only";

import { validateWebhookSignature } from "@remotion/lambda-client";
import { z } from "zod";

/**
 * SOURCE OF TRUTH KEYWORDS: verifyRemotionSignature, VERIFY_RETURNS_A_BOOLEAN
 *
 * WHAT:  True when this body really came from our render provider.
 * WHY:   `body` is the PARSED object, not the raw text, because that is what
 *        the provider signs — see SIGNATURE_IS_OVER_RESTRINGIFIED_JSON in the
 *        route. Passing raw bytes here fails for every genuine call.
 * WHERE: The route, before it reads or enqueues anything.
 */
export function verifyRemotionSignature(args: {
  secret: string;
  body: unknown;
  signatureHeader: string;
}): boolean {
  try {
    validateWebhookSignature({
      secret: args.secret,
      body: args.body,
      signatureHeader: args.signatureHeader,
    });
    return true;
  } catch {
    /* Swallowed deliberately: the message distinguishes a missing signature
     * from a wrong one, and surfacing either to a caller tells an attacker
     * which half of their forgery to fix. The route logs the refusal. */
    return false;
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: remotionWebhookPayloadSchema, RemotionWebhookPayload
 *
 * WHAT:  The provider's callback payload, narrowed to the fields this app acts
 *        on.
 * WHY:   NOT `.strict()`, which is the opposite of the rule everywhere else in
 *        this codebase and is right here for one reason: this object is
 *        written by somebody else. The provider adds fields in minor
 *        versions — timings, costs, artifacts — and a strict schema would
 *        reject the whole payload for a field we do not read, which would
 *        stall every render in flight on the next provider upgrade. Same trade
 *        as ONE_BAD_ITEM_IS_NOT_A_BAD_DOCUMENT, applied to an inbound payload
 *        rather than a document: be exact about what you require and tolerant
 *        about what you ignore.
 *
 *        A discriminated union on `type`, so `outputUrl` is only reachable on
 *        the success branch. The alternative — one object with everything
 *        optional — compiles and then lets a timeout payload be read for an
 *        output URL that structurally cannot be there.
 *
 *        `outputUrl` is `.optional().nullable()` because the provider types it
 *        `string | undefined` and a success with no output is a real (if
 *        pathological) state: the route treats it the same as a missing one
 *        and the workflow refuses to finalize without it.
 * WHERE: The route, after verification.
 */
const staticFields = {
  renderId: z.string().min(1),
  bucketName: z.string().min(1),
  /* Echoed back from what the adapter sent. The renderId inside it is how the
   * route finds OUR row — see RENDER_ID_FROM_CUSTOM_DATA. */
  customData: z.record(z.string(), z.unknown()).nullable().optional(),
};

export const remotionWebhookPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    ...staticFields,
    type: z.literal("success"),
    outputUrl: z.string().min(1).nullable().optional(),
  }),
  z.object({
    ...staticFields,
    type: z.literal("error"),
    errors: z
      .array(z.object({ message: z.string(), name: z.string().optional() }))
      .optional(),
  }),
  z.object({
    ...staticFields,
    type: z.literal("timeout"),
  }),
]);

export type RemotionWebhookPayload = z.infer<
  typeof remotionWebhookPayloadSchema
>;
