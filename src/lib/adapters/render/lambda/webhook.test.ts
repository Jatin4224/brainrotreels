/**
 * SOURCE OF TRUTH KEYWORDS: verifyRemotionSignature, remotionWebhookPayloadSchema,
 *   VERIFY_BEFORE_ANYTHING, SIGNATURE_IS_OVER_RESTRINGIFIED_JSON,
 *   ACK_WHAT_WE_CANNOT_USE, webhook signature tests
 *
 * WHAT:  The render webhook's two untrusted-input decisions: is this call
 *        genuine, and is this payload one we can act on.
 * WHY:   This endpoint is public by necessity — the render provider has to be
 *        able to reach it — so the signature check is the ONLY thing between
 *        the internet and "mark this customer's render complete and store THIS
 *        url as their video". The phase's last "done when" check is that an
 *        unsigned or wrongly-signed call is rejected, and it is checked here
 *        rather than only by hand because it is the kind of thing a refactor
 *        can quietly remove.
 *
 *        SIGNATURE_IS_OVER_RESTRINGIFIED_JSON is asserted explicitly, because
 *        it is the one place this webhook differs from the Stripe handler it
 *        is otherwise modelled on, and the difference is invisible until every
 *        render stalls. The signature here is built the way the PROVIDER
 *        builds it — sha512 over `JSON.stringify(body)` — so this test fails
 *        if someone "fixes" the route to verify raw bytes.
 * WHERE: Run by `npm test`. Guards src/lib/adapters/render/lambda/webhook.ts
 *        and, through it, src/app/api/webhooks/remotion/route.ts.
 */

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { remotionWebhookPayloadSchema, verifyRemotionSignature } from './webhook'

const SECRET = 'test-webhook-secret'

/* Built the way the provider builds it, NOT by calling the function under
 * test — a test that signed with the same helper it verifies with would pass
 * even if both were wrong. */
function sign(body: unknown, secret = SECRET): string {
  return `sha512=${createHmac('sha512', secret).update(JSON.stringify(body)).digest('hex')}`
}

const successBody = {
  type: 'success',
  renderId: 'provider-render-1',
  bucketName: 'remotionlambda-test',
  customData: { renderId: 'render_abc' },
  outputUrl: 'https://example.invalid/out.mp4',
  /* Fields this build does not read, present because the provider sends them.
   * See the note on the schema about why it is not `.strict()`. */
  costs: { accruedSoFar: 0.01, displayCost: '$0.01' },
  timeToFinish: 42_000,
}

describe('verifyRemotionSignature', () => {
  it('accepts a correctly-signed body', () => {
    expect(
      verifyRemotionSignature({
        secret: SECRET,
        body: successBody,
        signatureHeader: sign(successBody),
      }),
    ).toBe(true)
  })

  it('rejects a body signed with a different secret', () => {
    /* The forgery that matters: an attacker who knows the payload shape but
     * not the secret. */
    expect(
      verifyRemotionSignature({
        secret: SECRET,
        body: successBody,
        signatureHeader: sign(successBody, 'not-the-secret'),
      }),
    ).toBe(false)
  })

  it('rejects a body that was tampered with after signing', () => {
    const signature = sign(successBody)
    const tampered = { ...successBody, outputUrl: 'https://attacker.invalid/payload.mp4' }
    /* Swapping the output URL is the whole attack — it would make the workflow
     * copy an arbitrary file into the customer's workspace as their render. */
    expect(
      verifyRemotionSignature({ secret: SECRET, body: tampered, signatureHeader: signature }),
    ).toBe(false)
  })

  it('rejects a missing or empty signature rather than throwing', () => {
    /* VERIFY_RETURNS_A_BOOLEAN — the SDK throws for both of these, and a route
     * that let it propagate would answer 500 instead of 400. */
    expect(
      verifyRemotionSignature({ secret: SECRET, body: successBody, signatureHeader: '' }),
    ).toBe(false)
    expect(
      verifyRemotionSignature({
        secret: SECRET,
        body: successBody,
        /* What the provider sends when it was configured with no secret. */
        signatureHeader: 'NO_SECRET_PROVIDED',
      }),
    ).toBe(false)
  })

  it('verifies the re-stringified body, not the raw bytes it arrived as', () => {
    /* SIGNATURE_IS_OVER_RESTRINGIFIED_JSON. The same object serialised with
     * different whitespace is the same payload to the provider's scheme, which
     * is precisely why the route must parse before verifying. If this ever
     * fails, the route is verifying the wrong thing. */
    const raw = JSON.stringify(successBody, null, 2)
    const reparsed: unknown = JSON.parse(raw)
    expect(
      verifyRemotionSignature({
        secret: SECRET,
        body: reparsed,
        signatureHeader: sign(successBody),
      }),
    ).toBe(true)
  })
})

describe('remotionWebhookPayloadSchema', () => {
  it('reads a success payload and its output url', () => {
    const parsed = remotionWebhookPayloadSchema.safeParse(successBody)
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.type === 'success') {
      expect(parsed.data.outputUrl).toBe('https://example.invalid/out.mp4')
      expect(parsed.data.customData?.['renderId']).toBe('render_abc')
    }
  })

  it('reads an error payload and keeps the first message', () => {
    const parsed = remotionWebhookPayloadSchema.safeParse({
      type: 'error',
      renderId: 'provider-render-2',
      bucketName: 'remotionlambda-test',
      customData: { renderId: 'render_def' },
      errors: [{ message: 'Composition threw', name: 'Error', stack: '...' }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.type === 'error') {
      expect(parsed.data.errors?.[0]?.message).toBe('Composition threw')
    }
  })

  it('reads a timeout payload, which carries no output and no errors', () => {
    const parsed = remotionWebhookPayloadSchema.safeParse({
      type: 'timeout',
      renderId: 'provider-render-3',
      bucketName: 'remotionlambda-test',
      customData: { renderId: 'render_ghi' },
    })
    expect(parsed.success).toBe(true)
  })

  it('tolerates unknown fields a newer provider version adds', () => {
    /* The behaviour that keeps renders flowing across a provider upgrade — a
     * strict schema would reject the whole payload for a field nobody reads,
     * and every render in flight would stall at the wait step. */
    const parsed = remotionWebhookPayloadSchema.safeParse({
      ...successBody,
      somethingAddedInANewerVersion: { nested: true },
    })
    expect(parsed.success).toBe(true)
  })

  it('refuses a payload with no recognised type', () => {
    /* ACK_WHAT_WE_CANNOT_USE — the route answers 200 and logs, but it must
     * know it could not act, which is this returning false. */
    expect(
      remotionWebhookPayloadSchema.safeParse({
        renderId: 'provider-render-4',
        bucketName: 'remotionlambda-test',
      }).success,
    ).toBe(false)
  })
})
