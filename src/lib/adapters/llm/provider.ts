/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: LLM_PROVIDER, llmSelector, assertLlmProviderActive,
 *   DEFAULT_LLM_PROVIDER
 *
 * WHAT:  Resolves which language-model implementation is selected, once.
 * WHY:   Server-only and selected exactly like the jobs, storage, media and
 *        render seams — see src/lib/adapters/select-provider.ts for why these
 *        cannot share the auth machinery. No client half exists: a browser
 *        never calls a model directly, because the key would be in the bundle
 *        and the spend would be unbounded.
 * WHERE: Used by ./index.ts and asserted at module scope by ./anthropic.
 */

import { createProviderSelector } from "../select-provider";
import { LLM_PROVIDER_IDS, type LlmProviderId } from "./types";

export const DEFAULT_LLM_PROVIDER: LlmProviderId = "anthropic";

export const llmSelector = createProviderSelector<LlmProviderId>({
  label: "llm",
  envVar: "LLM_PROVIDER",
  rawValue: process.env["LLM_PROVIDER"],
  ids: LLM_PROVIDER_IDS,
  fallback: DEFAULT_LLM_PROVIDER,
});

export const LLM_PROVIDER: LlmProviderId = llmSelector.provider;

export function assertLlmProviderActive(id: LlmProviderId): void {
  llmSelector.assertActive(id);
}
