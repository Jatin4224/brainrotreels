/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: planVariants, VariantPlan, assertSupportedMedia,
 *   UnsupportedMediaError, SUPPORTED_VIDEO_CODECS, SUPPORTED_AUDIO_CODECS,
 *   VERTICAL_MASTER, PROXY, THUMB_WIDTH, WAVEFORM_SIZE, fitForKind,
 *   variantFilename, variantContentType, CODEC_ALLOWLIST_IS_THE_REAL_CHECK
 *
 * WHAT:  What the ingest workflow should build for a given file, and whether it
 *        should refuse the file at all. Pure: it takes a probe result and
 *        returns a plan. No ffmpeg, no storage, no database.
 * WHY:   Separated from the workflow for the same reason src/lib/timeline is
 *        separated from the routers — these are the decisions worth testing,
 *        and they are untestable while they are tangled with a process spawn
 *        and an S3 round-trip. Every number below is a product choice and this
 *        is the one file to argue with about them.
 *
 *        CODEC_ALLOWLIST_IS_THE_REAL_CHECK. The content-type allowlist in
 *        src/lib/types/asset.ts decides what the app will sign an upload for,
 *        based on a string the BROWSER supplied. This file decides what the app
 *        can actually process, based on what ffprobe found INSIDE the file. The
 *        two are different checks and the second is the one that matters: a
 *        ProRes or HEVC MOV is a legitimate `video/quicktime` upload that the
 *        renderer cannot read, and an `.mp4` containing nothing at all is also
 *        a legitimate `video/mp4`.
 * WHERE: Called by src/inngest/functions/asset-ingest.ts. Unit-tested by
 *        ./ingest-plan.test.ts.
 */

import type { MediaProbe, TranscodeFit } from "@/lib/adapters/media/types";
import type { AssetKind, MediaFamily, VariantName } from "@/lib/types/asset";

/**
 * SOURCE OF TRUTH KEYWORDS: VERTICAL_MASTER, PROXY, THUMB_WIDTH, WAVEFORM_SIZE
 *
 * WHAT:  The canvases and quality settings every ingested file is normalised to.
 * WHY:   1080×1920 is the short-form standard and the same canvas
 *        CANVAS_BY_ASPECT declares for `9:16` — the renderer composites onto
 *        it, so a master that is any other size costs a scale on every frame of
 *        every render.
 *        `proxy_480` is 480 wide because it exists to make the EDITOR
 *        responsive: it is downloaded over a customer's connection on every
 *        preview scrub, and at CRF 32 a 30-second clip lands around a megabyte.
 *        That preview/output pairing is the one architecture.md calls out as
 *        the reason the editor and the final render match.
 *        CRF 20 for the master, 32 for the proxy: the master is a source for a
 *        paid output and must not visibly degrade, the proxy is a scrub target
 *        and visible compression is an acceptable trade for the latency.
 * WHERE: planVariants below.
 */
export const VERTICAL_MASTER = {
  width: 1080,
  height: 1920,
  crf: 20,
  fps: 30,
} as const;

export const PROXY = { width: 480, height: 854, crf: 32, fps: 30 } as const;

export const THUMB_WIDTH = 480;

export const WAVEFORM_SIZE = { width: 1200, height: 240 } as const;

/**
 * SOURCE OF TRUTH KEYWORDS: SUPPORTED_VIDEO_CODECS, SUPPORTED_AUDIO_CODECS,
 *   CODEC_ALLOWLIST_IS_THE_REAL_CHECK
 *
 * WHAT:  The codecs this pipeline can decode.
 * WHY:   Short on purpose. These are the codecs a stock ffmpeg build decodes
 *        without a licensed or non-free dependency, which is what the worker
 *        image will have. HEVC is the notable and deliberate omission: modern
 *        iPhones record it by default, so it will be hit, and the honest
 *        behaviour is a clear refusal telling the customer to export as H.264
 *        rather than a transcode that fails halfway through with an ffmpeg
 *        error. Widening this list is a deployment decision (an ffmpeg build
 *        with the right decoders) before it is a code one.
 * WHERE: assertSupportedMedia below.
 */
export const SUPPORTED_VIDEO_CODECS: readonly string[] = [
  "h264",
  "vp8",
  "vp9",
  "av1",
  "mpeg4",
  "mjpeg",
  "png",
  "webp",
];

export const SUPPORTED_AUDIO_CODECS: readonly string[] = [
  "aac",
  "mp3",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_f32le",
  "opus",
  "vorbis",
  "flac",
];

/**
 * SOURCE OF TRUTH KEYWORDS: UnsupportedMediaError, READABLE_INGEST_FAILURE
 *
 * WHAT:  A file this pipeline will not process, with the reason as a sentence
 *        the customer reads.
 * WHY:   Distinct from MediaProcessingError, which means "the tool failed".
 *        This one means "the tool would have worked and we are declining", and
 *        the workflow must NOT retry it: the file will never become supported,
 *        so a retry is three more minutes of compute and the same answer. The
 *        message is written for the customer — it says what to do, not what
 *        went wrong internally.
 * WHERE: Thrown by assertSupportedMedia; caught in asset-ingest.ts, which marks
 *        the asset `failed` with `error` set to this message.
 */
export class UnsupportedMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedMediaError";
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: assertSupportedMedia, CORRUPT_FILE
 *
 * WHAT:  Throws unless the probed file is something this pipeline can process.
 * WHY:   Three refusals, in the order a file fails them:
 *
 *        CORRUPT_FILE — no video stream AND no audio stream means ffprobe
 *        opened the file and found no media in it. A zero-byte "video", an
 *        HTML error page saved with an .mp4 name, a truncated upload. This is
 *        the case Phase 02's last check names, and it has to be caught here
 *        rather than by a transcode that fails with "Invalid data found".
 *
 *        An unsupported codec, with the codec named — "HEVC" tells the customer
 *        what to change in their export settings; "unsupported format" does
 *        not.
 *
 *        Zero dimensions, which some malformed headers report alongside a
 *        perfectly good-looking stream list, and which would make the fit maths
 *        divide by zero.
 * WHERE: The validate step of the ingest workflow, straight after probe.
 */
export function assertSupportedMedia(probe: MediaProbe): void {
  if (probe.video === null && probe.audio === null) {
    throw new UnsupportedMediaError(
      "This file does not contain any video or audio. It may be corrupt or incompletely uploaded — try exporting it again.",
    );
  }

  if (
    probe.video !== null &&
    !SUPPORTED_VIDEO_CODECS.includes(probe.video.codec)
  ) {
    throw new UnsupportedMediaError(
      `This video uses the ${probe.video.codec.toUpperCase()} codec, which we cannot process. Export it as H.264 (MP4) and upload it again.`,
    );
  }

  if (
    probe.audio !== null &&
    !SUPPORTED_AUDIO_CODECS.includes(probe.audio.codec)
  ) {
    throw new UnsupportedMediaError(
      `This audio uses the ${probe.audio.codec.toUpperCase()} codec, which we cannot process. Export it as MP3 or WAV and upload it again.`,
    );
  }

  if (
    probe.video !== null &&
    (probe.video.width <= 0 || probe.video.height <= 0)
  ) {
    throw new UnsupportedMediaError(
      "This video reports no picture size, so it cannot be resized for a vertical video. It may be corrupt.",
    );
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: fitForKind, CROP_OR_PAD
 *
 * WHAT:  Whether a given asset kind should be cropped or padded onto the
 *        vertical canvas.
 * WHY:   CROP_OR_PAD. Cropping fills the screen and throws away the sides;
 *        padding keeps everything and adds black bars. Which one is right is a
 *        property of the MATERIAL, not of the file:
 *
 *        - A `background` or `ai_footage` clip is texture. Nobody is reading
 *          its edges, and bars behind a narration video would look broken, so
 *          it crops. This is the setting Phase 11's gameplay footage depends on.
 *        - An `upload` or `image` is the customer's own content and may well
 *          have a subject near an edge or text across the top; silently cutting
 *          a third off it is the worse failure, so it pads. Phase 15's editor
 *          is where someone can reframe it deliberately.
 *
 *        A full Record over AssetKind rather than a default, so a new kind
 *        cannot ship without this decision being made for it.
 * WHERE: planVariants below.
 */
const FIT_BY_KIND: Readonly<Record<AssetKind, TranscodeFit>> = {
  background: "crop",
  ai_footage: "crop",
  render_output: "crop",
  upload: "pad",
  image: "pad",
  avatar: "pad",
  /* Audio kinds never reach the fit maths; listed so the Record is exhaustive
   * and a future audio-with-visualiser variant has a stated default. */
  audio_tts: "pad",
  audio_music: "pad",
  sfx: "pad",
};

export function fitForKind(kind: AssetKind): TranscodeFit {
  return FIT_BY_KIND[kind];
}

/**
 * SOURCE OF TRUTH KEYWORDS: VariantPlan, planVariants
 *
 * WHAT:  One variant the workflow should produce: its name, the file it writes,
 *        and the parameters to produce it with.
 * WHY:   A plan rather than a sequence of calls, so the workflow is a loop over
 *        data and the test can assert the decisions without running ffmpeg.
 *        `source` names which EARLIER artifact a variant is derived from, and it
 *        is the field that makes the workflow resumable: each step downloads
 *        its own input by key, so a retry after the master was produced
 *        re-derives the proxy from the stored master instead of starting from
 *        the original.
 * WHERE: planVariants' return value; consumed step by step in asset-ingest.ts.
 */
export interface VariantPlan {
  variant: VariantName;
  /** Which artifact this one is made from. */
  source: "original" | "vertical_1080";
  /** The object filename inside the asset's own prefix. */
  filename: string;
  contentType: string;
  width: number;
  height: number;
  operation: "transcode" | "frame" | "waveform";
  /** Present for `transcode` only. */
  transcode?: {
    fit: TranscodeFit;
    crf: number;
    fps?: number;
    encode: "video" | "still";
    /**
     * Whether to drop the source's audio track.
     *
     * MUTE_BACKGROUNDS_NOT_UPLOADS. A background or generated clip is texture
     * under narration, and keeping its own audio means every render using it
     * carries a second soundtrack nobody asked for — so those are muted at
     * INGEST rather than at render time, where it would be a flag to remember
     * on every path. A customer's own upload may BE the audio they want, so it
     * keeps its track.
     */
    muted: boolean;
  };
  /** Present for `frame` only — where in the source to grab the poster. */
  atSec?: number;
}

/**
 * SOURCE OF TRUTH KEYWORDS: ProbeFacts, PLAN_TAKES_FACTS_NOT_A_PROBE
 *
 * WHAT:  The only three things variant planning needs to know about a file.
 * WHY:   PLAN_TAKES_FACTS_NOT_A_PROBE. The planner used to take a whole
 *        MediaProbe, which forced its one real caller — a workflow step that
 *        has these facts replayed to it as JSON, not the original probe — to
 *        fabricate a probe object with empty codecs and zero bytes just to call
 *        it. A narrow input means the caller passes what it has and the fiction
 *        disappears.
 * WHERE: planVariants' parameter; built from the probe step's stored result.
 */
export interface ProbeFacts {
  durationSec: number | null;
  /** The source's own pixel dimensions, or null for audio. */
  source: { width: number; height: number } | null;
}

/** Kinds whose own audio is dropped — see MUTE_BACKGROUNDS_NOT_UPLOADS. */
const MUTED_KINDS: readonly AssetKind[] = ["background", "ai_footage"];

/**
 * SOURCE OF TRUTH KEYWORDS: planVariants, VIDEO_PLAN, IMAGE_PLAN, AUDIO_PLAN
 *
 * WHAT:  The whole variant set for one asset, in the order it must be built.
 * WHY:   Three shapes, because the three families need genuinely different
 *        things and a single plan padded with no-ops would hide that:
 *
 *        VIDEO → a vertical master, a proxy derived FROM the master (not from
 *        the original: deriving it from the master is what guarantees the
 *        preview and the output are the same framing, which is the whole point
 *        of the pairing), and a poster frame.
 *
 *        IMAGE → a vertical master as a STILL and a thumbnail. No proxy: a JPEG
 *        is already small enough to preview, and a second copy of it would be
 *        storage spent for nothing.
 *
 *        AUDIO → a waveform only. There is nothing to crop, and generating a
 *        black video for a music file is how a library ends up full of 1080p
 *        files of nothing.
 *
 *        The poster is taken at one second rather than zero: the first frame of
 *        a huge share of real video is black, a fade-in, or a slate, and a media
 *        library of black rectangles is indistinguishable from a broken one. A
 *        clip shorter than a second falls back to its midpoint.
 * WHERE: asset-ingest.ts iterates this.
 */
export function planVariants(args: {
  family: MediaFamily;
  kind: AssetKind;
  facts: ProbeFacts;
}): VariantPlan[] {
  const { family, kind, facts } = args;
  const fit = fitForKind(kind);
  const muted = MUTED_KINDS.includes(kind);

  if (family === "audio") {
    return [
      {
        variant: "waveform",
        source: "original",
        filename: "waveform.png",
        contentType: "image/png",
        width: WAVEFORM_SIZE.width,
        height: WAVEFORM_SIZE.height,
        operation: "waveform",
      },
    ];
  }

  if (family === "image") {
    return [
      {
        variant: "vertical_1080",
        source: "original",
        filename: "vertical_1080.jpg",
        contentType: "image/jpeg",
        width: VERTICAL_MASTER.width,
        height: VERTICAL_MASTER.height,
        operation: "transcode",
        /* A still has no audio track to drop, so `muted` is irrelevant here and
         * written false rather than omitted — the field is required so that a
         * video plan cannot forget it. */
        transcode: {
          fit,
          crf: VERTICAL_MASTER.crf,
          encode: "still",
          muted: false,
        },
      },
      {
        variant: "thumb",
        source: "original",
        filename: "thumb.jpg",
        contentType: "image/jpeg",
        width: THUMB_WIDTH,
        /* Derived from the source's own ratio — a thumbnail is a preview of the
         * file, so letterboxing it would misrepresent what was uploaded. */
        height: thumbHeightFor(facts, THUMB_WIDTH),
        operation: "frame",
        atSec: 0,
      },
    ];
  }

  return [
    {
      variant: "vertical_1080",
      source: "original",
      filename: "vertical_1080.mp4",
      contentType: "video/mp4",
      width: VERTICAL_MASTER.width,
      height: VERTICAL_MASTER.height,
      operation: "transcode",
      transcode: {
        fit,
        crf: VERTICAL_MASTER.crf,
        fps: VERTICAL_MASTER.fps,
        encode: "video",
        muted,
      },
    },
    {
      variant: "proxy_480",
      source: "vertical_1080",
      filename: "proxy_480.mp4",
      contentType: "video/mp4",
      width: PROXY.width,
      height: PROXY.height,
      operation: "transcode",
      /* Already vertical by this point, so the fit is a no-op either way;
       * `crop` is named explicitly so a rounding difference cannot introduce a
       * one-pixel bar. The master has already had the muting decision applied,
       * so the proxy simply keeps whatever the master has. */
      transcode: {
        fit: "crop",
        crf: PROXY.crf,
        fps: PROXY.fps,
        encode: "video",
        muted: false,
      },
    },
    {
      variant: "thumb",
      source: "vertical_1080",
      filename: "thumb.jpg",
      contentType: "image/jpeg",
      width: THUMB_WIDTH,
      height: Math.round(
        (THUMB_WIDTH * VERTICAL_MASTER.height) / VERTICAL_MASTER.width,
      ),
      operation: "frame",
      atSec: posterTimeFor(facts.durationSec),
    },
  ];
}

/**
 * SOURCE OF TRUTH KEYWORDS: posterTimeFor
 *
 * WHAT:  Where in a clip to grab its poster frame.
 * WHY:   One second in, for the reason in planVariants' WHY. A clip shorter
 *        than that uses its midpoint, and a clip of unknown length uses zero —
 *        seeking past the end of a file produces no frame at all, and a missing
 *        thumbnail is worse than a dark one.
 * WHERE: planVariants.
 */
export function posterTimeFor(durationSec: number | null): number {
  if (durationSec === null || durationSec <= 0) return 0;
  if (durationSec <= 1) return durationSec / 2;
  return 1;
}

function thumbHeightFor(facts: ProbeFacts, width: number): number {
  const source = facts.source;
  if (source === null || source.width <= 0 || source.height <= 0) return width;
  /* Even, because every encoder this pipeline touches requires it, and at least
   * 2 so a degenerate 1-pixel-tall source cannot produce a zero-height frame. */
  return Math.max(
    2,
    2 * Math.round((width * source.height) / source.width / 2),
  );
}
