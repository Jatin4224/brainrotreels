/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MediaAdapter, MediaProbe, MediaProbeVideo,
 *   MediaProbeAudio, MEDIA_PROVIDER_IDS, MediaProviderId, probe, transcode,
 *   extractFrame, renderWaveform, FFMPEG_RUNS_IN_A_CONTAINER,
 *   MediaProcessingError
 *
 * WHAT:  The contract for inspecting and transcoding media files.
 * WHY:   FFMPEG_RUNS_IN_A_CONTAINER — the decision Phase 02 asked to be
 *        recorded, and the reason this seam exists at all.
 *
 *        ffmpeg runs IN THE PROCESS THAT RUNS THE WORKFLOW, which must
 *        therefore be a long-lived container (a Node worker serving
 *        /api/inngest, or a dedicated worker image), never a serverless
 *        function. Three things force it:
 *
 *          1. SIZE — a serverless bundle caps at a few hundred MB; an ffmpeg
 *             build is most of that before any application code.
 *          2. TIME — transcoding a two-minute 4K upload outlasts a serverless
 *             execution budget, and a step that times out retries from the top
 *             and times out again, forever.
 *          3. DISK — ffmpeg wants real files. A function's writable /tmp is
 *             small and, worse, not shared between the retries of one step.
 *
 *        Lambda was the alternative and is a worse fit HERE while being the
 *        right answer in Phase 04: a render is one long job per project and
 *        parallelises across frames, whereas ingest is many short jobs that
 *        want a warm process and a local disk. The seam is what lets that
 *        choice be revisited — add a provider id and an implementation folder,
 *        and no workflow changes.
 *
 *        The contract is in terms of LOCAL FILE PATHS, not storage keys or
 *        streams. That is deliberate: the adapter must not know what R2 is (the
 *        workflow stages files in and out — see src/lib/media/staging.ts), and
 *        it must not take a stream, because ffmpeg needs to seek, which is
 *        exactly what a stream cannot do. Every method is one process
 *        invocation, so each one can be its own resumable workflow step.
 * WHERE: Implemented by ./ffmpeg. Reached through getMediaAdapter() in ./index.
 *        Called ONLY from src/inngest/functions/asset-ingest.ts — never from a
 *        route, a router or a component.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: MediaProbe, MediaProbeVideo, MediaProbeAudio
 *
 * WHAT:  What a file actually is, as read from its own header rather than from
 *        its name or the browser's claim about it.
 * WHY:   `video` and `audio` are independently nullable because all four
 *        combinations are real and each one is handled differently: video+audio
 *        is a normal upload, video-only is a silent background (fine), audio-
 *        only is music or narration, and NEITHER means the file is not media at
 *        all — which is the corrupt-file case the ingest workflow has to mark
 *        `failed` with something a customer can read.
 *        `durationSec` is nullable on its own because a still image legitimately
 *        has no duration, and storing 0 for it would make "shorter than the
 *        narration" true of every photo (see the looping logic in Phase 11).
 * WHERE: Returned by MediaAdapter.probe; consumed by src/lib/media/ingest-plan.ts.
 */
export interface MediaProbeVideo {
  codec: string;
  width: number;
  height: number;
  /** Frames per second, already reduced from ffprobe's `30000/1001` form. */
  fps: number;
}

export interface MediaProbeAudio {
  codec: string;
  channels: number;
  sampleRate: number;
}

export interface MediaProbe {
  /** The container, e.g. `mov,mp4,m4a` — ffprobe reports a comma-joined list. */
  containerFormat: string;
  durationSec: number | null;
  bytes: number;
  video: MediaProbeVideo | null;
  audio: MediaProbeAudio | null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: TranscodeFit, TranscodeRequest
 *
 * WHAT:  One transcode: an input file, an output file, the canvas to land on,
 *        and how to reconcile a source that is the wrong shape.
 * WHY:   `fit` is a parameter rather than a constant because the right answer
 *        depends on the material, and the phase brief says "centre-crop OR pad".
 *        A 16:9 gameplay clip should be CROPPED to vertical — padding it would
 *        put two black bars across most of a phone screen. A logo sting or a
 *        screen recording should be PADDED, because cropping cuts the subject
 *        in half. The ingest plan decides per asset kind; the adapter only
 *        executes.
 *        `crf` is exposed because the proxy wants to be small and ugly and the
 *        master wants to be large and clean, and that single number is the
 *        whole difference between them.
 * WHERE: MediaAdapter.transcode; built by planVariants in src/lib/media.
 */
export type TranscodeFit = "crop" | "pad";

export interface TranscodeRequest {
  inputPath: string;
  outputPath: string;
  width: number;
  height: number;
  fit: TranscodeFit;
  /** Constant Rate Factor — lower is better quality and a bigger file. */
  crf: number;
  /** Frames per second to normalise to. Omit to keep the source's rate. */
  fps?: number;
  /** Drop the audio track. The renderer composites narration separately. */
  muted?: boolean;
  /**
   * `still` writes ONE frame as a JPEG instead of a video, through the exact
   * same fit maths. An uploaded photo needs a 1080×1920 rendition as much as a
   * clip does, and encoding it as a one-frame H.264 would be a video file that
   * every consumer then has to special-case. Defaults to `video`.
   */
  encode?: "video" | "still";
}

/**
 * SOURCE OF TRUTH KEYWORDS: MediaProcessingError, READABLE_INGEST_FAILURE
 *
 * WHAT:  A media operation that failed, carrying the tool's own output.
 * WHY:   READABLE_INGEST_FAILURE. Phase 02 has to mark a corrupt asset `failed`
 *        "with a readable error", and ffmpeg's stderr is hundreds of lines of
 *        build flags with the actual cause on one of them. `message` is the
 *        sentence shown to the customer; `detail` is the tail of stderr, kept
 *        for the operator and never rendered. One class rather than a bare
 *        Error so the workflow can tell a media failure (mark the row failed,
 *        do not retry — the file will not improve) from an infrastructure
 *        failure (retry).
 * WHERE: Thrown by every ./ffmpeg method; caught in asset-ingest.ts.
 */
export class MediaProcessingError extends Error {
  readonly detail: string;

  constructor(message: string, detail: string = "") {
    super(message);
    this.name = "MediaProcessingError";
    this.detail = detail;
  }
}

export interface MediaAdapter {
  readonly id: MediaProviderId;

  /** Reads a file's real shape. Never trusts the extension. */
  probe(filePath: string): Promise<MediaProbe>;

  /** Video (or image) to a fixed canvas. H.264 + AAC, faststart for streaming. */
  transcode(request: TranscodeRequest): Promise<void>;

  /** One frame as a JPEG poster. */
  extractFrame(args: {
    inputPath: string;
    outputPath: string;
    atSec: number;
    width: number;
  }): Promise<void>;

  /** An audio track drawn as a PNG waveform for the editor's audio lane. */
  renderWaveform(args: {
    inputPath: string;
    outputPath: string;
    width: number;
    height: number;
  }): Promise<void>;

  /**
   * SOURCE OF TRUTH KEYWORDS: normalizeLoudness, LOUDNESS_IS_NORMALISED,
   *   DURATION_IS_MEASURED_NOT_CLAIMED
   *
   * WHAT:  Brings one audio file to a consistent loudness and reports how long
   *        it actually is.
   *
   * WHY:   LOUDNESS_IS_NORMALISED, which is Phase 07's step 6. Synthesised
   *        lines are NOT uniformly loud — different voices, and even different
   *        lines in one voice, come back at different levels. Cut together
   *        untouched, a narration audibly jumps in volume at every line break,
   *        and the ducking curve in Phase 03 then ducks the music against a
   *        moving target. Normalising per line, before anything is stored, is
   *        what makes a stitched narration sound like one take.
   *
   *        DURATION_IS_MEASURED_NOT_CLAIMED is why this returns a duration
   *        rather than being a `void` transcode. The provider's figure is an
   *        estimate, and the timeline positions every other element against
   *        these numbers — captions, cuts, the music bed — so an estimate
   *        compounds into visible desynchronisation across a video. The
   *        measurement is taken from the NORMALISED file, because that is the
   *        file that gets stored and played.
   * WHERE: The TTS workflow, after every synthesis.
   */
  normalizeLoudness(args: {
    inputPath: string;
    outputPath: string;
  }): Promise<{ durationSec: number }>;
}

export const MEDIA_PROVIDER_IDS = ["ffmpeg"] as const;

export type MediaProviderId = (typeof MEDIA_PROVIDER_IDS)[number];
