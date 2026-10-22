/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: narrateOneLine, NarrateLineInput,
 *   ONE_RECORDING_PATH, CACHE_BEFORE_PAYING, LOUDNESS_IS_NORMALISED,
 *   DURATION_IS_MEASURED_NOT_CLAIMED, PER_LINE_FAILURE
 *
 * WHAT:  The single path by which a narration line acquires audio.
 *
 * WHY:   ONE_RECORDING_PATH. Both workflows that produce narration — the
 *        whole-script fan-out and the single-line re-record — call THIS, so a
 *        cache hit, a synthesis, loudness normalisation, the storage key and
 *        the failure classification are the same in both. Two copies would
 *        drift within a phase, and the drift would be audible: one path
 *        normalising and the other not is a narration that jumps in volume
 *        exactly at the lines somebody edited.
 *
 *        Extracted from project-tts.ts when line-resynth.ts needed it, rather
 *        than duplicated — which is the moment the shared rule is cheapest to
 *        establish.
 * WHERE: src/inngest/functions/project-tts.ts and line-resynth.ts.
 */

import { writeFile } from "node:fs/promises";

import { getMediaAdapter } from "@/lib/adapters/media";
import { MediaProcessingError } from "@/lib/adapters/media/types";
import { getTtsAdapter, TtsError } from "@/lib/adapters/tts";
import { projectKey } from "@/lib/adapters/storage";
import { prisma } from "@/lib/config/prisma";
import { uploadFile, withStagingDir } from "@/lib/media";
import {
  createProcessingAsset,
  markAssetReady,
  setModerationStatus,
} from "@/services/assets.service";
import {
  findCachedAudio,
  findNarrationLine,
  markLineFailed,
  markLineReady,
  markLineSynthesizing,
} from "@/services/narration.service";

/**
 * SOURCE OF TRUTH KEYWORDS: NarrateLineInput
 *
 * WHAT:  What one recording needs.
 * WHY:   `projectId` is taken rather than derived from the line, because it
 *        decides the STORAGE KEY — narration lives under the project's prefix
 *        so deleting a project removes its audio with it. A caller that got it
 *        wrong would write one project's narration under another's, which no
 *        database constraint would catch (STORAGE_KEY_CONVENTION).
 * WHERE: Both callers.
 */
export interface NarrateLineInput {
  organizationId: string;
  projectId: string;
  line: {
    id: string;
    textHash: string;
    voiceId: string;
    providerVoiceId: string;
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: narrateLine, CACHE_BEFORE_PAYING,
 *   LOUDNESS_IS_NORMALISED, DURATION_IS_MEASURED_NOT_CLAIMED, PER_LINE_FAILURE
 *
 * WHAT:  Gets one line recorded: reuse existing audio, or synthesise,
 *        normalise and store it.
 *
 * WHY:   The cache check is repeated here rather than trusted from the plan,
 *        because a line earlier in THIS run may have just produced audio for
 *        identical text — a script that repeats a phrase pays once, not twice.
 *        The plan's `needsSynthesis` sizes the hold; this decides the call.
 *
 *        LOUDNESS_IS_NORMALISED before storage, so a stitched narration does
 *        not jump in volume at every line break, and
 *        DURATION_IS_MEASURED_NOT_CLAIMED — the stored duration comes from the
 *        normalised file, never from the provider's estimate, because the
 *        timeline positions everything else against it.
 *
 *        PER_LINE_FAILURE: a permanent failure marks this line and returns
 *        rather than throwing, so the remaining lines still run. A transient
 *        one throws and lets Inngest retry the step.
 * WHERE: The fan-out above, and `line.resynth`.
 */
export async function narrateOneLine(args: {
  organizationId: string;
  projectId: string;
  line: NarrateLineInput["line"];
}): Promise<{ lineId: string; cached: boolean; durationSec: number | null }> {
  const { organizationId, projectId, line } = args;

  const existing = await findNarrationLine(prisma, organizationId, line.id);
  if (existing === null) {
    /* The row was replaced by a newer run while this one was in flight. */
    return { lineId: line.id, cached: false, durationSec: null };
  }
  if (existing.status === "ready") {
    return {
      lineId: line.id,
      cached: true,
      durationSec: existing.durationSec,
    };
  }

  /* Checked again — see the WHY above. */
  const cached = await findCachedAudio(prisma, {
    organizationId,
    textHash: line.textHash,
    voiceId: line.voiceId,
  });
  if (cached !== null) {
    await markLineReady(prisma, organizationId, line.id, cached);
    return { lineId: line.id, cached: true, durationSec: cached.durationSec };
  }

  const claimed = await markLineSynthesizing(prisma, organizationId, line.id);
  if (claimed === 0) {
    /* Another run got there first. Not an error — the fan-out is per line and
     * steps retry. */
    return { lineId: line.id, cached: false, durationSec: null };
  }

  const tts = await getTtsAdapter();

  let spoken;
  try {
    spoken = await tts.synthesize({
      text: existing.text,
      voiceId: line.providerVoiceId,
    });
  } catch (error) {
    if (error instanceof TtsError) {
      console.error(`[project.tts] line ${line.id}: ${error.detail}`);
      if (error.permanent) {
        await markLineFailed(prisma, organizationId, line.id, error.message);
        return { lineId: line.id, cached: false, durationSec: null };
      }
      throw error;
    }
    throw error;
  }

  return withStagingDir(async (dir) => {
    const rawPath = dir.file("raw.mp3");
    const levelledPath = dir.file("levelled.mp3");

    await writeFile(rawPath, spoken.audio);

    const media = await getMediaAdapter();

    let measured;
    try {
      measured = await media.normalizeLoudness({
        inputPath: rawPath,
        outputPath: levelledPath,
      });
    } catch (error) {
      if (error instanceof MediaProcessingError) {
        console.error(`[project.tts] line ${line.id} levelling:`, error.detail);
        await markLineFailed(prisma, organizationId, line.id, error.message);
        return { lineId: line.id, cached: false, durationSec: null };
      }
      throw error;
    }

    /* Stored under the project's audio prefix, so deleting a project removes
     * its narration with it (STORAGE_KEY_CONVENTION). */
    const storageKey = projectKey(
      organizationId,
      projectId,
      "audio",
      `${line.id}.mp3`,
    );

    const bytes = await uploadFile({
      localPath: levelledPath,
      storageKey,
      contentType: "audio/mpeg",
    });

    /* The audio becomes an ordinary Asset, so signing, deletion and the media
     * library all work on it exactly as they do for an upload
     * (RENDER_OUTPUT_IS_AN_ASSET, applied to narration). */
    const asset = await createProcessingAsset(prisma, {
      organizationId,
      kind: "audio_tts",
      source: "generated",
      filename: `${line.id}.mp3`,
      storageKey,
      contentType: "audio/mpeg",
      bytes,
    });

    await markAssetReady(prisma, asset.id, {
      durationSec: measured.durationSec,
    });

    /* MODERATION_IS_NOT_APPLICABLE_TO_OUR_OWN_SYNTHESIS. Phase 10 made
     * `Asset.moderationStatus` load-bearing: anything not cleared is withheld
     * from every render (NOT_APPROVED_DOES_NOT_RENDER in
     * src/services/assets.service.ts), and the column defaults to `pending`.
     * Narration is this app's own synthesis of a SCRIPT that the pipeline
     * already classified as text before a word of it was spoken, so sending
     * the audio to a classifier would be paying to moderate our own output —
     * and leaving it `pending` would withhold the narration from the video it
     * was recorded for. `skipped` is the honest value: moderation applies, and
     * it happened upstream. Written as a separate, deliberate call because
     * `createProcessingAsset` refuses to let a creation claim a moderation
     * state. */
    await setModerationStatus(prisma, asset.id, "skipped");

    await markLineReady(prisma, organizationId, line.id, {
      audioAssetId: asset.id,
      durationSec: measured.durationSec,
    });

    return {
      lineId: line.id,
      cached: false,
      durationSec: measured.durationSec,
    };
  });
}

