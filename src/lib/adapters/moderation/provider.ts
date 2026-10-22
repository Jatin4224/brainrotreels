/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MODERATION_PROVIDER, moderationSelector,
 *   assertModerationProviderActive, DEFAULT_MODERATION_PROVIDER
 *
 * WHAT:  Resolves which content classifier is selected, once.
 * WHY:   Server-only and selected exactly like the jobs, storage, media,
 *        render, llm, tts and stt seams — see src/lib/adapters/select-provider.ts
 *        for why these cannot share the auth machinery. No client half exists:
 *        a browser never classifies anything, and a classifier that could be
 *        called from a browser would be one an attacker could call with
 *        text they never intend to generate.
 *
 *        It is a SEPARATE selector from the LLM one even though the only
 *        implementation today is a Claude call. They are different decisions
 *        with different economics: the realistic swap is moving moderation to
 *        a dedicated, far cheaper classification API while keeping Claude for
 *        the writing — and one shared `LLM_PROVIDER` switch would make that
 *        impossible to express.
 * WHERE: Used by ./index.ts and asserted at module scope by ./claude.
 */

import { createProviderSelector } from "../select-provider";
import {
  MODERATION_PROVIDER_IDS,
  type ModerationProviderId,
} from "./types";

export const DEFAULT_MODERATION_PROVIDER: ModerationProviderId = "claude";

export const moderationSelector = createProviderSelector<ModerationProviderId>({
  label: "moderation",
  envVar: "MODERATION_PROVIDER",
  rawValue: process.env["MODERATION_PROVIDER"],
  ids: MODERATION_PROVIDER_IDS,
  fallback: DEFAULT_MODERATION_PROVIDER,
});

export const MODERATION_PROVIDER: ModerationProviderId =
  moderationSelector.provider;

export function assertModerationProviderActive(
  id: ModerationProviderId,
): void {
  moderationSelector.assertActive(id);
}
