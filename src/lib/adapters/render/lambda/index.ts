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
 * SOURCE OF TRUTH KEYWORDS: lambdaRenderAdapter, renderMediaOnLambda,
 *   getRenderProgress, PROVIDER_ISOLATION, RenderProviderError,
 *   PERMANENT_VS_TRANSIENT_FAILURE, SCALE_NOT_CANVAS, DETERMINISTIC_ENCODE,
 *   PROGRESS_IS_FOR_THE_TIMEOUT_PATH, WEBHOOK_NOT_POLLING
 *
 * WHAT:  The Remotion Lambda implementation of RenderAdapter.
 *
 * WHY:   A translation layer and nothing more — the adapter's job is to keep
 *        `@remotion/lambda` out of call sites, not to wrap its execution
 *        model. Three things it translates, each of which would otherwise leak
 *        a provider concept into a workflow:
 *
 *        WEBHOOK_NOT_POLLING. `renderMediaOnLambda` is handed a `webhook`, so
 *        the provider calls US when the render ends. That is the phase's
 *        central requirement ("the workflow completes without any polling
 *        step") and it is a parameter on the START call, not a later
 *        subscription — a render started without it can only ever be polled.
 *
 *        SCALE_NOT_CANVAS. The requested resolution becomes Remotion's
 *        `scale`, never a forced width or height. The composition resolves
 *        every normalized box, font size and overlay position against the
 *        document's own canvas, so changing the canvas would MOVE things on
 *        screen; `scale` multiplies the rasterised output and changes nothing
 *        about the layout. See SCALE_BY_RESOLUTION in src/lib/types/render.ts.
 *
 *        PERMANENT_VS_TRANSIENT_FAILURE. Everything this file throws is a
 *        `RenderProviderError` carrying whether a retry could help, because
 *        the workflow has to decide whether a customer waits. A missing
 *        configuration or a composition that does not exist will not improve
 *        on the fourth attempt; a network blip reaching AWS will. The
 *        classification is this folder's responsibility precisely because it
 *        is the only place that understands the provider's errors.
 *
 *        DETERMINISTIC_ENCODE: `imageFormat: 'jpeg'` and an explicit codec,
 *        mirroring remotion.config.ts — which the CLI reads and Lambda does
 *        NOT (REMOTION_CLI_ONLY). Anything that must hold for every render has
 *        to be stated in both places, and this is the half the cloud sees. A
 *        render whose encoder settings came from a config file the renderer
 *        never loads is a render that differs from the local one for no
 *        visible reason.
 * WHERE: Loaded by ../index.ts through a dynamic import. eslint confines the
 *        `@remotion/lambda*` SDK to this folder.
 */

import 'server-only'

import { getRenderProgress, renderMediaOnLambda } from '@remotion/lambda-client'
/* The region list is imported from the SDK rather than typed out, so it cannot
 * drift from the union it is validating against across a Remotion upgrade. */
import { AWS_REGIONS, type AwsRegion } from '@remotion/lambda-client/regions'

import type { TimelineDoc } from '@/lib/timeline'
import {
  SCALE_BY_RESOLUTION,
  TIMELINE_COMPOSITION_ID,
  type RenderResolution,
} from '@/lib/types/render'
import type {
  RenderAdapter,
  RenderOptions,
  RenderProgressResult,
  RenderStartResult,
} from '../types'
import { RenderProviderError } from '../types'
import { lambdaRenderConfig } from './config'

/**
 * SOURCE OF TRUTH KEYWORDS: LAMBDA_FRAMES_PER_FUNCTION, CHUNK_SIZE
 *
 * WHAT:  How many frames each Lambda invocation renders.
 * WHY:   Left to Remotion, deliberately — this is the one knob where the
 *        provider's own heuristic beats a constant, because the right value
 *        depends on the frame count and on the function's memory, and a fixed
 *        number is wrong at both ends: too small and the per-invocation
 *        overhead (a cold start and a browser launch) dominates the actual
 *        work; too large and the parallelism this seam exists for disappears.
 *        Recorded as an absence so the next person does not add it as a
 *        "missing" option.
 * WHERE: Not passed below. Documented here instead.
 */

/** Maps our resolution vocabulary onto the provider's scale factor. */
function scaleFor(resolution: RenderResolution): number {
  return SCALE_BY_RESOLUTION[resolution]
}

/**
 * SOURCE OF TRUTH KEYWORDS: toProviderError, PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  Classifies a thrown provider error as permanent or transient.
 * WHY:   Pattern-matched on the message, which is unpleasant and is still the
 *        right trade: the SDK throws plain `Error`s for most of these, so
 *        there is no class to test. The list is short, each entry names a
 *        condition that genuinely cannot improve by waiting, and the DEFAULT
 *        is transient — which is the safe direction. Mistaking a blip for a
 *        permanent failure strands a paid render that would have worked;
 *        mistaking a permanent failure for a blip costs two more attempts and
 *        then lands in the same place.
 * WHERE: Both methods below.
 */
function toProviderError(error: unknown, context: string): RenderProviderError {
  if (error instanceof RenderProviderError) return error

  const message = error instanceof Error ? error.message : String(error)

  /* Conditions that are about the DEPLOYMENT or the DOCUMENT, not the moment.
   * A second attempt reproduces every one of them exactly. */
  const permanentSignals = [
    'is not configured',
    'No composition with the ID',
    'does not exist',
    'Function not found',
    'ResourceNotFoundException',
    'AccessDenied',
    'InvalidAccessKeyId',
    'SignatureDoesNotMatch',
    'NoSuchBucket',
  ]
  const permanent = permanentSignals.some((signal) => message.includes(signal))

  return new RenderProviderError(
    permanent
      ? 'This video could not be rendered. Please contact support — the renderer is misconfigured.'
      : 'The renderer could not be reached. This will be retried automatically.',
    { detail: `[render/lambda] ${context}: ${message}`, permanent },
  )
}

export const lambdaRenderAdapter: RenderAdapter = {
  id: 'lambda',

  async start(doc: TimelineDoc, options: RenderOptions): Promise<RenderStartResult> {
    const config = lambdaRenderConfig()

    try {
      const result = await renderMediaOnLambda({
        region: toAwsRegion(config.region),
        functionName: config.functionName,
        /* Resolved ONCE, here, from REMOTION_SITE_VERSION. A render carries
         * this URL for its whole life, which is what makes deploying a new
         * site safe while one is in flight — see VERSIONED_SITE_URL. */
        serveUrl: config.serveUrl,
        composition: TIMELINE_COMPOSITION_ID,
        /* The composition's whole input. `watermark` is in here rather than in
         * the document because it is an entitlement, not a property of the
         * video — see WATERMARK_IS_A_PROP. */
        inputProps: {
          doc,
          assets: options.assets,
          watermark: options.watermark,
        },
        codec: 'h264',
        /* H.264 video with AAC audio: the pairing every phone and every
         * platform plays without transcoding it again. */
        audioCodec: 'aac',
        imageFormat: 'jpeg',
        scale: scaleFor(options.resolution),
        /* `public` so the completion URL can be streamed into R2 without this
         * process holding AWS read credentials for the Remotion bucket. The
         * object is short-lived — it is copied into R2 and then only R2's
         * signed URLs are ever handed out — and the key is an unguessable
         * render id. Grep OUTPUT_IS_COPIED_NOT_SERVED. */
        privacy: 'public',
        webhook: {
          url: options.webhookUrl,
          secret: options.webhookSecret,
          /* Echoed back on the callback. This is how the webhook finds OUR
           * row — see the note on RenderOptions.customData. */
          customData: options.customData,
        },
        /* Remotion's own per-chunk retries. Two, matching the ingest
         * workflow's reasoning: the failures worth retrying inside a render
         * clear immediately or not at all, and more attempts mostly buy a
         * longer wait before the same answer — on a paid render, with the
         * meter running. */
        maxRetries: 2,
      })

      return { providerRenderId: result.renderId }
    } catch (error) {
      throw toProviderError(error, 'renderMediaOnLambda failed')
    }
  },

  /**
   * PROGRESS_IS_FOR_THE_TIMEOUT_PATH — this is NOT a polling loop. The happy
   * path learns a render has finished from the webhook; the one caller here is
   * the branch that has already waited 45 minutes and has to establish whether
   * the render is dead or merely slow before writing `timedOut` on the row.
   */
  async getProgress(providerRenderId: string): Promise<RenderProgressResult> {
    const config = lambdaRenderConfig()

    try {
      const progress = await getRenderProgress({
        renderId: providerRenderId,
        /* The provider's own bucket, from configuration — not a value carried
         * on the row. See the note on RenderStartResult. */
        bucketName: config.bucketName,
        functionName: config.functionName,
        region: toAwsRegion(config.region),
      })

      /* Order matters: a fatal error can coexist with `done`, and reading
       * `done` first would report a failed render as completed. */
      if (progress.fatalErrorEncountered) {
        return {
          status: 'failed',
          progress: progress.overallProgress,
          outputUrl: null,
          /* The FIRST error, not the last and not all of them. Lambda reports
           * one per failed chunk and they are usually the same cause repeated
           * fifty times; the row renders this inline. */
          error: progress.errors[0]?.message ?? 'The render failed without reporting a reason.',
        }
      }

      if (progress.done) {
        return {
          status: 'completed',
          progress: 1,
          outputUrl: progress.outputFile,
          error: null,
        }
      }

      return {
        /* `lambdasInvoked` rather than `overallProgress > 0`: a render that has
         * been accepted but whose functions have not started yet reports zero
         * progress, and calling that `rendering` would make a stuck queue look
         * like a stuck render. */
        status: progress.lambdasInvoked > 0 ? 'rendering' : 'queued',
        progress: progress.overallProgress,
        outputUrl: null,
        error: null,
      }
    } catch (error) {
      throw toProviderError(error, 'getRenderProgress failed')
    }
  },
}

/**
 * SOURCE OF TRUTH KEYWORDS: toAwsRegion, AwsRegion, REGION_IS_VALIDATED
 *
 * WHAT:  Narrows the configured region string to the provider's own union.
 * WHY:   REGION_IS_VALIDATED. `AwsRegion` is a closed union of the regions
 *        Remotion Lambda supports, and the value arrives as a `string` from
 *        the environment — so this is the boundary where the two meet. A cast
 *        would compile and then fail inside the SDK with an error about a
 *        missing function rather than a misspelled region, which is a much
 *        longer afternoon. The check is against the SDK's own list so it
 *        cannot go stale against a Remotion upgrade.
 * WHERE: Both methods above.
 */
function toAwsRegion(region: string): AwsRegion {
  const supported: readonly string[] = AWS_REGIONS
  if (!supported.includes(region)) {
    throw new RenderProviderError(
      'This video could not be rendered. Please contact support — the renderer is misconfigured.',
      {
        detail:
          `[render/lambda] REMOTION_AWS_REGION is "${region}", which Remotion Lambda does not ` +
          `support. Choose one of: ${supported.join(', ')}.`,
        permanent: true,
      },
    )
  }
  /* Narrowed by the membership test above, which is why this is not an
   * unchecked assertion: `includes` cannot narrow a widened string on its own. */
  return region as AwsRegion
}
