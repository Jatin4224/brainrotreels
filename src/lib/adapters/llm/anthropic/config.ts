/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: anthropicConfig, isAnthropicConfigured,
 *   ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_EFFORT, LAZY_CONFIG
 *
 * WHAT:  Everything the Claude adapter needs from the environment.
 * WHY:   LAZY_CONFIG, matching the R2 and Stripe clients: nothing throws at
 *        import. Script generation is optional until somebody generates, and a
 *        module-scope throw would crash the setup checklist — the one screen
 *        whose job is to tell an operator which variables are missing.
 *
 *        The MODEL and the EFFORT are overridable so cost can be traded
 *        against quality without a deploy. The model id is deliberately NOT
 *        validated against a list: pinning one here would mean editing this
 *        file every time a new model ships, which is exactly the maintenance
 *        the provider seam exists to avoid. The effort IS validated, because
 *        it is a closed set the API rejects outright — and a 400 on every
 *        generation because somebody typed `very-high` is worth catching at
 *        the boundary with a readable message.
 * WHERE: ./index.ts, on every request.
 */

import { assertLlmProviderActive } from "../provider";

assertLlmProviderActive("anthropic");

/** The effort levels the API accepts. A value outside this is a 400. */
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * SOURCE OF TRUTH KEYWORDS: DEFAULT_MODEL, DEFAULT_EFFORT, DEFAULT_MAX_TOKENS,
 *   ANTHROPIC_MODEL
 *
 * WHAT:  Which model answers, how hard it thinks, and how much it may write.
 * WHY:   Claude Opus 5.5 is the current default model. Writing a script is a
 *        judgement task — structure, pacing, a hook that earns the next three
 *        seconds — and it is the step every later phase builds on, so a weak
 *        script makes a weak video no amount of rendering fixes.
 *
 *        Effort is set EXPLICITLY rather than left to default. This model
 *        family defaults to `medium`, one level below the previous
 *        generation's, so omitting it silently lowers quality. `high` is the
 *        balance point for work like this; `max` buys little on a
 *        few-hundred-word script and costs real money per generation.
 *
 *        `DEFAULT_MAX_TOKENS` is generous because the schema wraps the script
 *        in JSON and a truncated response fails validation and burns the one
 *        retry — while staying well inside the non-streaming HTTP timeout.
 *
 *        They live in this file rather than beside the request so that
 *        `config.ts` has no import from `index.ts`: the adapter imports its
 *        configuration, and a cycle between the two would make the module's
 *        initialisation order depend on which one was reached first.
 * WHERE: anthropicConfig below, and the request in ./index.ts.
 */
export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_EFFORT: EffortLevel = "high";
export const DEFAULT_MAX_TOKENS = 16_000;

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  effort: EffortLevel;
}

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env["ANTHROPIC_API_KEY"]?.trim());
}

export function anthropicConfig(): AnthropicConfig {
  const apiKey = process.env["ANTHROPIC_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error(
      "[llm/anthropic] ANTHROPIC_API_KEY is not set. Script generation is unavailable until it is configured.",
    );
  }

  const model = process.env["ANTHROPIC_MODEL"]?.trim() || DEFAULT_MODEL;

  const rawEffort = process.env["ANTHROPIC_EFFORT"]?.trim();
  if (
    rawEffort !== undefined &&
    rawEffort.length > 0 &&
    !isEffortLevel(rawEffort)
  ) {
    throw new Error(
      `[llm/anthropic] ANTHROPIC_EFFORT is "${rawEffort}", which the API rejects. ` +
        `Use one of: ${EFFORT_LEVELS.join(", ")}.`,
    );
  }

  return {
    apiKey,
    model,
    effort: isEffortLevel(rawEffort) ? rawEffort : DEFAULT_EFFORT,
  };
}

function isEffortLevel(value: string | undefined): value is EffortLevel {
  return (
    value !== undefined && (EFFORT_LEVELS as readonly string[]).includes(value)
  );
}
