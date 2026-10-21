/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ffmpegMediaAdapter, MediaAdapter, ffprobeJsonSchema,
 *   fitFilter, FIT_FILTER_CHAIN, PARSED_NOT_CAST, FASTSTART, probe, transcode,
 *   extractFrame, renderWaveform
 *
 * WHAT:  The ffmpeg/ffprobe implementation of MediaAdapter.
 * WHY:   PARSED_NOT_CAST — ffprobe's JSON is parsed with a zod schema, not cast.
 *        It is an external program's output, so it is untrusted input in exactly
 *        the sense CLAUDE.md rule 5 means: fields are missing on some
 *        containers, `duration` is a STRING, and `r_frame_rate` is the fraction
 *        `"30000/1001"`. Casting it would put NaN into `durationSec` and a
 *        timeline that silently renders nothing.
 *
 *        FIT_FILTER_CHAIN — the crop and pad chains are built here and only
 *        here. Both start by scaling with `force_original_aspect_ratio`,
 *        because the naive `scale=1080:1920` stretches a 16:9 clip into a
 *        funhouse mirror and nobody notices until a customer does. `increase`
 *        then crop fills the frame and loses the edges; `decrease` then pad
 *        keeps everything and adds bars. `setsar=1` is not optional: a source
 *        with a non-square pixel aspect ratio (plenty of phone and camera
 *        footage) otherwise produces a file whose stored dimensions are right
 *        and whose displayed shape is wrong.
 *
 *        FASTSTART moves the MP4 index to the front of the file so a browser
 *        can start playing before it has the whole thing. Without it the editor
 *        preview downloads the entire proxy before showing a frame.
 * WHERE: Loaded by ../index.ts through a dynamic import. eslint confines
 *        node:child_process to this folder.
 */

import "server-only";

import { z } from "zod";

import { assertMediaProviderActive } from "../provider";
import {
  MediaProcessingError,
  type MediaAdapter,
  type MediaProbe,
  type TranscodeFit,
  type TranscodeRequest,
} from "../types";
import { ffmpegBinary, ffprobeBinary, runTool } from "./binaries";

assertMediaProviderActive("ffmpeg");

/**
 * SOURCE OF TRUTH KEYWORDS: ffprobeJsonSchema, PARSED_NOT_CAST
 *
 * WHAT:  The subset of `ffprobe -print_format json` this app reads.
 * WHY:   Everything is optional because it genuinely is — a WAV has no video
 *        stream, an image has no duration, and a stream copy can be missing
 *        `nb_channels`. Numbers arrive as strings, so each one is coerced
 *        explicitly rather than trusted; `catch(undefined)` on the numeric
 *        fields means one unparseable value degrades that field instead of
 *        failing the whole probe and marking a good file corrupt.
 * WHERE: probe() below.
 */
/* `.optional().catch(undefined)` in that order, which is the only arrangement
 * that compiles AND behaves: `.catch()` must return the schema's own output
 * type, so the optional has to come first for `undefined` to be a legal
 * fallback. The effect is "absent or unparseable both read as absent", which is
 * what every caller below already handles. */
const ffprobeNumber = z
  .union([z.number(), z.string()])
  .transform((value) =>
    typeof value === "number" ? value : Number.parseFloat(value),
  )
  .refine((value) => Number.isFinite(value))
  .optional()
  .catch(undefined);

const ffprobeStreamSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: ffprobeNumber,
  height: ffprobeNumber,
  channels: ffprobeNumber,
  sample_rate: ffprobeNumber,
  duration: ffprobeNumber,
  /* The frame rate as a fraction, e.g. "30000/1001". `avg_frame_rate` is
   * "0/0" on some containers, so r_frame_rate is tried first. */
  r_frame_rate: z.string().optional(),
  avg_frame_rate: z.string().optional(),
});

const ffprobeJsonSchema = z.object({
  format: z
    .object({
      format_name: z.string().optional(),
      duration: ffprobeNumber,
      size: ffprobeNumber,
    })
    .optional(),
  streams: z.array(ffprobeStreamSchema).optional(),
});

/**
 * SOURCE OF TRUTH KEYWORDS: parseFrameRate
 *
 * WHAT:  Turns ffprobe's `"30000/1001"` into 29.97.
 * WHY:   A fraction, not a decimal, because NTSC rates are not representable as
 *        one — and `"0/0"` is what ffprobe reports for a stream with no
 *        meaningful rate, which must come back as null rather than as NaN or a
 *        division by zero.
 * WHERE: probe() below.
 */
function parseFrameRate(value: string | undefined): number | null {
  if (value === undefined) return null;
  const [numerator, denominator] = value.split("/");
  const top = Number.parseFloat(numerator ?? "");
  const bottom = denominator === undefined ? 1 : Number.parseFloat(denominator);
  if (
    !Number.isFinite(top) ||
    !Number.isFinite(bottom) ||
    bottom === 0 ||
    top === 0
  )
    return null;
  return top / bottom;
}

/**
 * SOURCE OF TRUTH KEYWORDS: fitFilter, FIT_FILTER_CHAIN
 *
 * WHAT:  The `-vf` chain that lands any source on an exact canvas.
 * WHY:   See FIT_FILTER_CHAIN in the file header. Exported-shaped (module
 *        local) rather than inlined so the crop and pad spellings sit side by
 *        side where the difference is reviewable.
 * WHERE: transcode() below.
 */
function fitFilter(width: number, height: number, fit: TranscodeFit): string {
  if (fit === "crop") {
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      "setsar=1",
    ].join(",");
  }

  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    /* Centre the content and fill the rest with black. `ow`/`oh` are the pad
     * output dimensions, so this expression is independent of the source. */
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    "setsar=1",
  ].join(",");
}

/**
 * SOURCE OF TRUTH KEYWORDS: parseProbeOutput, PARSED_NOT_CAST
 *
 * WHAT:  Turns ffprobe's JSON text into a MediaProbe.
 * WHY:   Exported and separate from `probe()` so the parsing can be tested
 *        against real ffprobe output without an ffprobe install — and it is
 *        worth testing: the awkward cases here (a duration that arrives as a
 *        STRING, a frame rate that arrives as the fraction "30000/1001" or the
 *        meaningless "0/0", streams that are absent entirely) are all shapes
 *        real files produce, and each one has a wrong answer that looks
 *        plausible. NaN in `durationSec` is the worst of them: it survives
 *        every comparison and reaches the renderer.
 * WHERE: probe() below; ./index.test.ts.
 */
export function parseProbeOutput(stdout: string): MediaProbe {
  {
    let raw: unknown;
    try {
      raw = JSON.parse(stdout);
    } catch {
      throw new MediaProcessingError(
        "This file could not be read as audio or video.",
        stdout.slice(0, 500),
      );
    }

    const parsed = ffprobeJsonSchema.safeParse(raw);
    if (!parsed.success) {
      throw new MediaProcessingError(
        "This file could not be read as audio or video.",
        parsed.error.message,
      );
    }

    const streams = parsed.data.streams ?? [];
    const videoStream = streams.find((stream) => stream.codec_type === "video");
    const audioStream = streams.find((stream) => stream.codec_type === "audio");

    /* Format duration first — a container knows its own length even when a
     * stream does not report one. */
    const duration =
      parsed.data.format?.duration ??
      videoStream?.duration ??
      audioStream?.duration;

    const videoWidth = videoStream?.width;
    const videoHeight = videoStream?.height;
    const fps =
      parseFrameRate(videoStream?.r_frame_rate) ??
      parseFrameRate(videoStream?.avg_frame_rate);

    return {
      containerFormat: parsed.data.format?.format_name ?? "unknown",
      /* A still image reports no duration, and 0 would be a lie that reads as
       * a real length downstream. */
      durationSec: duration !== undefined && duration > 0 ? duration : null,
      bytes: parsed.data.format?.size ?? 0,
      video:
        videoStream !== undefined &&
        videoWidth !== undefined &&
        videoHeight !== undefined
          ? {
              codec: videoStream.codec_name ?? "unknown",
              width: videoWidth,
              height: videoHeight,
              /* 0 rather than null: a stream that reports no rate is a still
                 image inside a video container, which is one frame. */
              fps: fps ?? 0,
            }
          : null,
      audio:
        audioStream !== undefined
          ? {
              codec: audioStream.codec_name ?? "unknown",
              channels: audioStream.channels ?? 0,
              sampleRate: audioStream.sample_rate ?? 0,
            }
          : null,
    };
  }
}

export const ffmpegMediaAdapter: MediaAdapter = {
  id: "ffmpeg",

  async probe(filePath: string): Promise<MediaProbe> {
    const stdout = await runTool(
      ffprobeBinary(),
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      "This file could not be read as audio or video.",
    );
    return parseProbeOutput(stdout);
  },

  async transcode(request: TranscodeRequest): Promise<void> {
    const {
      inputPath,
      outputPath,
      width,
      height,
      fit,
      crf,
      fps,
      muted,
      encode,
    } = request;
    const filter = fitFilter(width, height, fit);

    if (encode === "still") {
      await runTool(
        ffmpegBinary(),
        [
          "-y",
          "-i",
          inputPath,
          "-vf",
          filter,
          "-frames:v",
          "1",
          /* 2 is ffmpeg's near-lossless JPEG quality; this rendition is what a
             render composites, so it is not the place to save bytes. */
          "-q:v",
          "2",
          outputPath,
        ],
        "This image could not be converted.",
      );
      return;
    }

    await runTool(
      ffmpegBinary(),
      [
        "-y",
        "-i",
        inputPath,
        "-vf",
        filter,
        ...(fps !== undefined ? ["-r", String(fps)] : []),
        "-c:v",
        "libx264",
        "-preset",
        /* `veryfast` rather than `medium`: this runs per upload on a worker
         * that is also serving other ingests, and the size difference on
         * short-form clips is single-digit percent. */
        "veryfast",
        "-crf",
        String(crf),
        /* yuv420p is the only pixel format every browser and Remotion decode
         * path agrees on; a 10-bit or 4:2:2 source that keeps its own format
         * produces a file that plays on the worker and nowhere else. */
        "-pix_fmt",
        "yuv420p",
        ...(muted === true
          ? ["-an"]
          : ["-c:a", "aac", "-b:a", "128k", "-ar", "48000"]),
        /* FASTSTART — see the file header. */
        "-movflags",
        "+faststart",
        outputPath,
      ],
      "This video could not be converted. Its format may not be supported.",
    );
  },

  async extractFrame({ inputPath, outputPath, atSec, width }): Promise<void> {
    await runTool(
      ffmpegBinary(),
      [
        /* `-ss` BEFORE `-i` seeks by keyframe without decoding everything up to
         * that point — on a two-minute source that is the difference between a
         * poster frame in 50ms and one in 20 seconds. */
        "-ss",
        atSec.toFixed(3),
        "-i",
        inputPath,
        "-frames:v",
        "1",
        /* -2 keeps the aspect ratio and rounds to an even number, which the
           encoder requires. */
        "-vf",
        `scale=${width}:-2`,
        "-q:v",
        "4",
        outputPath,
      ],
      "A preview image could not be made for this file.",
    );
  },

  async renderWaveform({
    inputPath,
    outputPath,
    width,
    height,
  }): Promise<void> {
    await runTool(
      ffmpegBinary(),
      [
        "-y",
        "-i",
        inputPath,
        "-filter_complex",
        /* A fixed mid-grey, not a theme token: this is a PNG's pixel data, so
         * there is no CSS to read. Mid-grey is the one value legible against
         * both the light and the dark editor background, which is why the
         * waveform is not drawn in the brand colour. */
        `showwavespic=s=${width}x${height}:colors=#9ca3af`,
        "-frames:v",
        "1",
        outputPath,
      ],
      "A waveform could not be drawn for this audio.",
    );
  },

  /**
   * SOURCE OF TRUTH KEYWORDS: normalizeLoudness, LOUDNESS_IS_NORMALISED,
   *   EBU_R128, SINGLE_PASS_LOUDNORM
   *
   * WHY:   EBU_R128 via ffmpeg's `loudnorm`, targeting −16 LUFS. That target
   *        is the streaming-platform convention for spoken content: loud
   *        enough to sit over a music bed, quiet enough that the platform's
   *        own normalisation does not pull it back down and take the dynamics
   *        with it.
   *
   *        SINGLE_PASS_LOUDNORM, and the tradeoff is deliberate. Two-pass is
   *        more accurate — it measures the whole file, then applies a
   *        correction — but it means two ffmpeg invocations per line, and a
   *        script is dozens of lines. One pass is accurate enough for speech,
   *        where the dynamic range is narrow and the content is a few seconds
   *        long. If narration ever includes music or long dynamic passages,
   *        this is the line to revisit.
   *
   *        `-ar 44100` is pinned because `loudnorm` resamples to 192kHz
   *        internally and will happily emit that if not told otherwise —
   *        producing files several times larger for no audible gain.
   */
  async normalizeLoudness({ inputPath, outputPath }): Promise<{
    durationSec: number;
  }> {
    await runTool(
      ffmpegBinary(),
      [
        "-y",
        "-i",
        inputPath,
        "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar",
        "44100",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        outputPath,
      ],
      "That narration could not be levelled.",
    );

    /* Measured from the OUTPUT, not the input — the file that gets stored and
     * played is the one the timeline has to agree with. */
    const probed = await ffmpegMediaAdapter.probe(outputPath);
    if (probed.durationSec === null || probed.durationSec <= 0) {
      throw new MediaProcessingError(
        "That narration came out empty.",
        `[media/ffmpeg] normalised ${outputPath} has no duration`,
      );
    }

    return { durationSec: probed.durationSec };
  },
};
