/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getImageAdapter, ImageAdapter, IMAGE_PROVIDER,
 *   PROVIDER_ISOLATION, dynamic import
 *
 * WHAT:  The only sanctioned way to reach an image model.
 *
 * WHY:   The dynamic `import()` is the isolation guarantee, as in every other
 *        seam: the implementation module — the one that reads `IMAGE_API_KEY` —
 *        is never evaluated in a process that does not generate an image.
 *
 *        There is no pure half to re-export here, unlike the stock and Reddit
 *        seams, and that is the honest shape rather than an omission: those two
 *        have a URL to validate before anybody spends a request, and this one
 *        takes a prompt that the MODERATION seam has already judged
 *        (PROMPT_IS_ALREADY_MODERATED). Nothing about an image prompt can be
 *        checked without a network call.
 * WHERE: src/services/visuals.service.ts, from the ingest workflow's step.
 */

import "server-only";

import { IMAGE_PROVIDER } from "./provider";
import type { ImageAdapter } from "./types";

export type {
  ImageAdapter,
  ImageFetchError,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageProviderId,
} from "./types";
export { IMAGE_FETCH_ERRORS, IMAGE_PROVIDER_IDS, ImageError } from "./types";
export { IMAGE_PROVIDER, DEFAULT_IMAGE_PROVIDER } from "./provider";

let adapterPromise: Promise<ImageAdapter> | null = null;

async function loadAdapter(): Promise<ImageAdapter> {
  /* Exhaustive over ImageProviderId — a new id without a case here is a
   * compile error at the `never` branch. */
  switch (IMAGE_PROVIDER) {
    case "openai": {
      const mod = await import("./openai");
      return mod.openaiImageAdapter;
    }
    default: {
      const exhaustive: never = IMAGE_PROVIDER;
      throw new Error(
        `[adapters/image] No adapter registered for "${String(exhaustive)}".`,
      );
    }
  }
}

export async function getImageAdapter(): Promise<ImageAdapter> {
  if (!adapterPromise) {
    adapterPromise = loadAdapter();
  }
  return adapterPromise;
}
