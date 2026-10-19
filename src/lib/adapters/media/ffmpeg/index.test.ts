/**
 * SOURCE OF TRUTH KEYWORDS: parseProbeOutput, PARSED_NOT_CAST, ffprobe json,
 *                           MediaProcessingError, ffmpeg adapter tests
 *
 * WHAT:  Parsing real ffprobe output into a MediaProbe.
 * WHY:   ffprobe is an external program whose JSON is loosely typed by
 *        convention and not by contract: durations arrive as STRINGS, frame
 *        rates as fractions, and whole sections are absent depending on the
 *        container. Every one of those has a wrong answer that looks fine —
 *        `Number("30000/1001")` is NaN, and NaN survives every comparison the
 *        pipeline makes about duration before reaching a render. These cases
 *        are taken from what ffprobe actually emits rather than invented.
 * WHERE: Run by `npm test`. Guards src/lib/adapters/media/ffmpeg/index.ts.
 */

import { describe, expect, it } from 'vitest'

import { MediaProcessingError } from '../types'
import { parseProbeOutput } from './index'

/* Trimmed from `ffprobe -print_format json -show_format -show_streams` on a
 * 16:9 phone recording. Note `duration` is a string and `r_frame_rate` is a
 * fraction — both are verbatim. */
const MP4_OUTPUT = JSON.stringify({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      r_frame_rate: '30000/1001',
      avg_frame_rate: '30000/1001',
      duration: '12.345000',
    },
    {
      codec_type: 'audio',
      codec_name: 'aac',
      channels: 2,
      sample_rate: '48000',
      duration: '12.400000',
    },
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '12.400000', size: '2048000' },
})

describe('parseProbeOutput', () => {
  it('reads a normal MP4', () => {
    const probe = parseProbeOutput(MP4_OUTPUT)

    expect(probe.containerFormat).toBe('mov,mp4,m4a,3gp,3g2,mj2')
    expect(probe.bytes).toBe(2048000)
    expect(probe.video).toEqual({ codec: 'h264', width: 1920, height: 1080, fps: 30000 / 1001 })
    expect(probe.audio).toEqual({ codec: 'aac', channels: 2, sampleRate: 48000 })
  })

  /* The string-duration case. A NaN here reaches the renderer. */
  it('coerces a string duration to a finite number', () => {
    const probe = parseProbeOutput(MP4_OUTPUT)
    expect(probe.durationSec).toBeCloseTo(12.4, 5)
    expect(Number.isFinite(probe.durationSec)).toBe(true)
  })

  /* NTSC rates are fractions precisely because they are not representable as
   * a decimal, so the fraction has to be divided rather than parsed. */
  it('reduces a fractional frame rate', () => {
    expect(parseProbeOutput(MP4_OUTPUT).video?.fps).toBeCloseTo(29.97, 2)
  })

  it('falls back to avg_frame_rate when r_frame_rate is the meaningless 0/0', () => {
    const output = JSON.stringify({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'vp9',
          width: 1080,
          height: 1920,
          r_frame_rate: '0/0',
          avg_frame_rate: '25/1',
        },
      ],
      format: { format_name: 'matroska,webm', duration: '5.0', size: '100' },
    })

    expect(parseProbeOutput(output).video?.fps).toBe(25)
  })

  it('reads an audio-only file as having no video stream', () => {
    const output = JSON.stringify({
      streams: [{ codec_type: 'audio', codec_name: 'mp3', channels: 2, sample_rate: '44100' }],
      format: { format_name: 'mp3', duration: '183.5', size: '2937600' },
    })

    const probe = parseProbeOutput(output)
    expect(probe.video).toBeNull()
    expect(probe.audio?.codec).toBe('mp3')
    expect(probe.durationSec).toBeCloseTo(183.5, 5)
  })

  /* A still image genuinely has no duration. Storing 0 would make "shorter
   * than the narration" true of every photo. */
  it('reports no duration for a still image', () => {
    const output = JSON.stringify({
      streams: [
        { codec_type: 'video', codec_name: 'mjpeg', width: 1200, height: 800, r_frame_rate: '0/0' },
      ],
      format: { format_name: 'image2', size: '240000' },
    })

    const probe = parseProbeOutput(output)
    expect(probe.durationSec).toBeNull()
    expect(probe.video?.width).toBe(1200)
    /* 0, not null — a video container holding one frame IS one frame. */
    expect(probe.video?.fps).toBe(0)
  })

  /* The corrupt-file shape: ffprobe opened it and found nothing. The parse
   * SUCCEEDS with both streams null, and assertSupportedMedia is what refuses
   * it — these are deliberately two steps, so the error message can be about
   * the file rather than about the tool. */
  it('parses a file with no streams rather than throwing', () => {
    const probe = parseProbeOutput(JSON.stringify({ streams: [], format: { size: '0' } }))
    expect(probe.video).toBeNull()
    expect(probe.audio).toBeNull()
  })

  it('throws a readable error on output that is not JSON', () => {
    expect(() => parseProbeOutput('ffprobe: command failed')).toThrow(MediaProcessingError)
    expect(() => parseProbeOutput('')).toThrow(MediaProcessingError)
  })

  it('tolerates an unparseable number instead of producing NaN', () => {
    const output = JSON.stringify({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1080,
          height: 1920,
          r_frame_rate: '30/1',
        },
      ],
      format: { format_name: 'mp4', duration: 'N/A', size: 'N/A' },
    })

    const probe = parseProbeOutput(output)
    expect(probe.durationSec).toBeNull()
    expect(probe.bytes).toBe(0)
  })
})
