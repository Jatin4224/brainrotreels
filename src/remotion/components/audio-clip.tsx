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
 * SOURCE OF TRUTH KEYWORDS: AudioClip, audioClipPropsSchema, DUCKING_CURVE,
 *   DUCK_IS_A_REQUEST, NOT_IN_THE_REGISTRY, duckingVolumeAt,
 *   EXPLICIT_REPETITIONS_FOR_DUCKED_LOOPS
 *
 * WHAT:  Plays one audio item — narration, a music bed or an effect — at its
 *        gain, ducking under narration when the item asks to be ducked.
 * WHY:   NOT_IN_THE_REGISTRY, and that is deliberate rather than an omission.
 *        An audio item has no `render` field at all (see `audioItemSchema`),
 *        because there is nothing to choose: audio is not drawn and there will
 *        never be a second "audio component family". Putting it in
 *        RENDER_COMPONENTS would mean inventing a render kind the document
 *        cannot express. The composition mounts this directly for every item on
 *        an audio track.
 *
 *        DUCK_IS_A_REQUEST: the document stores `duck: true`, not a volume
 *        curve, and the schema says why — encoding the curve would freeze it
 *        against narration that has not been recorded yet. So the curve is
 *        computed HERE, from where the narration actually is, which means
 *        re-recording a line re-ducks the music with no document change.
 *
 *        DUCKING_CURVE is a ramp, not a switch. A music bed that cuts from
 *        full to 25% on one frame is audible as a click; 150ms of ramp is
 *        inaudible as a transition and is what every broadcast mixer does. The
 *        ramp is computed per frame as a pure function of the frame number, so
 *        it stays deterministic.
 * WHERE: Mounted by src/remotion/timeline-renderer.tsx for audio tracks.
 */

import { Audio, Sequence, useVideoConfig } from 'remotion'
import { z } from 'zod'

import { duckingVolumeAt, type FrameWindow } from '@/lib/render'
import type { RenderItemProps } from '@/lib/types'

const audioClipPropsSchema = z.object({
  assetId: z.string().min(1),
  gain: z.number().min(0).max(4).default(1),
  duck: z.boolean().default(false),
  loop: z.boolean().default(false),
})

export interface AudioClipProps extends RenderItemProps {
  /** The frames during which any narration item is playing. */
  narrationWindows: readonly FrameWindow[]
}

export function AudioClip({ item, assets, frames, narrationWindows }: AudioClipProps) {
  const { fps } = useVideoConfig()

  const parsed = audioClipPropsSchema.safeParse(item)
  if (!parsed.success) return null

  const { assetId, gain, duck, loop } = parsed.data
  const asset = assets[assetId]
  /* Same rule as MediaClip: a missing asset is a gap, not a failed render. */
  if (asset === undefined || asset.url === null) return null

  const url = asset.url

  /* `volume` as a FUNCTION of the frame, which is Remotion's own API for a
   * level that changes. The frame Remotion passes is relative to the nearest
   * enclosing Sequence, and the ducking windows are ABSOLUTE document frames,
   * so every call shifts by the offset of whatever sequence it sits in —
   * `frames.from` for a plain item, plus the repetition's own offset when the
   * item loops. Getting that shift wrong is not a crash: the bed ducks at the
   * wrong moment, which sounds like a mixing choice rather than a bug. */
  const volumeAt = (offset: number) =>
    duck
      ? (relativeFrame: number) =>
          gain *
          duckingVolumeAt({ frame: offset + relativeFrame, fps, windows: narrationWindows })
      : gain

  const sourceLength = asset.durationInSeconds
  const shouldLoop =
    loop && sourceLength !== undefined && sourceLength > 0 && frames.durationInFrames / fps > sourceLength

  if (!shouldLoop) {
    return <Audio src={url} volume={volumeAt(frames.from)} />
  }

  /* EXPLICIT_REPETITIONS_FOR_DUCKED_LOOPS. Remotion's <Loop> would be shorter,
   * but its children cannot tell WHICH repetition they are — the frame they
   * see restarts at 0 each time — so a ducking curve inside one would reset
   * every few seconds and duck against the wrong part of the narration. Laying
   * the repetitions out by hand is what makes each one's absolute offset
   * knowable. The last is trimmed to the item's end rather than overrunning
   * it, so the audio stops where the document says it does. */
  const sourceFrames = Math.max(1, Math.round(sourceLength * fps))
  const repetitions = Math.ceil(frames.durationInFrames / sourceFrames)

  return (
    <>
      {Array.from({ length: repetitions }, (_, index) => {
        const offset = index * sourceFrames
        return (
          <Sequence
            key={index}
            from={offset}
            durationInFrames={Math.min(sourceFrames, frames.durationInFrames - offset)}
            layout="none"
          >
            <Audio src={url} volume={volumeAt(frames.from + offset)} />
          </Sequence>
        )
      })}
    </>
  )
}
