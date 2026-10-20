/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: LlmAdapter, LlmGenerateArgs, LlmProviderId,
 *   LLM_PROVIDER_IDS, LlmError, SCHEMA_IS_THE_CONTRACT,
 *   RETRY_ONCE_WITH_THE_ERROR, UNTRUSTED_TEXT_IS_NEVER_SYSTEM
 *
 * WHAT:  The contract for asking a language model for STRUCTURED output.
 *
 * WHY:   SCHEMA_IS_THE_CONTRACT. `generate` takes a Zod schema and returns a
 *        parsed, validated value — never a string. That is the whole shape of
 *        this seam, and it is what the phase means by "malformed model output
 *        never reaches the database": there is no code path where a caller
 *        holds raw model text and decides for itself whether it is usable.
 *        A provider that cannot constrain its output must parse and validate
 *        inside its own folder before returning.
 *
 *        It is deliberately ONE METHOD. No chat, no history, no streaming, no
 *        tools. Everything this product asks a model for is a single
 *        request-shaped question with a known answer shape — a script, a set
 *        of captions, a quiz. A conversational interface here would be an
 *        abstraction over an execution model nothing uses, and it would make
 *        the provider swap this seam exists for much harder: "send messages
 *        and stream deltas" is where providers differ most, and "fill this
 *        schema" is where they differ least.
 *
 *        UNTRUSTED_TEXT_IS_NEVER_SYSTEM. `system` and `user` are separate
 *        arguments and that separation is a SECURITY BOUNDARY, not
 *        ergonomics. Everything fetched from a URL, extracted from a PDF or
 *        typed by a customer is data; it goes in `user`, wrapped in
 *        delimiters, and the system prompt says that delimited content must
 *        never be followed as instructions. Interpolating fetched text into
 *        `system` hands an attacker the operator channel — see
 *        `wrapUntrusted` in src/lib/script/prompt.ts, which is the only
 *        sanctioned way to put foreign text in front of a model.
 *
 *        RETRY_ONCE_WITH_THE_ERROR is the implementation's job, not the
 *        caller's: if the model's output fails the schema, the provider
 *        retries exactly once with the validation error appended, then throws.
 *        Once, because a second failure is almost always the model being asked
 *        the wrong question rather than having a bad moment — and each retry
 *        is a paid request against a customer's credits.
 * WHERE: Implemented by ./anthropic. Reached through getLlmAdapter() in
 *        ./index. Called from src/lib/script/ and, from Phase 08 onward, the
 *        caption and quiz generators.
 */

import type { z } from "zod";

/**
 * SOURCE OF TRUTH KEYWORDS: LlmGenerateArgs
 *
 * WHAT:  One structured generation request.
 * WHY:   `schema` is a `z.ZodType<T>` rather than a JSON Schema object because
 *        every consumer in this codebase already defines its shapes in Zod
 *        (CLAUDE.md rule 5), and a second hand-written JSON Schema beside each
 *        one is two descriptions of the same thing that drift. The provider
 *        converts it; the caller never sees JSON Schema.
 *
 *        `maxTokens` is optional with a provider-chosen default. A caller that
 *        guesses too low gets output truncated mid-sentence, which then fails
 *        the schema and burns the one retry — so the sensible default lives
 *        with the provider that knows its own limits.
 *
 *        `purpose` is carried for logging and nothing else. When a generation
 *        fails in production the first question is "which call was it", and a
 *        stack trace through a shared adapter answers that badly.
 * WHERE: The single argument of LlmAdapter.generate.
 */
export interface LlmGenerateArgs<T> {
  /** Operator instructions. NEVER interpolate untrusted text into this. */
  system: string;
  /** The request, including any untrusted text wrapped in delimiters. */
  user: string;
  /** The shape the answer must take. Enforced, not suggested. */
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** A short label for logs, e.g. `script.generate`. */
  purpose?: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: LlmError, PERMANENT_VS_TRANSIENT_FAILURE,
 *   LLM_REFUSAL
 *
 * WHAT:  A generation that failed, carrying whether a retry could help.
 * WHY:   The same distinction, and for the same reason, as
 *        MediaProcessingError and RenderProviderError: the caller has to
 *        decide whether a customer waits. Three cases matter here and they are
 *        genuinely different:
 *
 *          - `permanent: true` — the model refused, the prompt is malformed,
 *            the key is wrong, or the output failed the schema twice. None
 *            improve on a fourth attempt, and each attempt is billed.
 *          - `permanent: false` — a rate limit or a 5xx. Worth retrying with
 *            backoff.
 *          - `refusal: true` — a subset of permanent worth naming separately,
 *            because it is the one the CUSTOMER can act on: their source text
 *            asked for something the model would not write. The UI says so
 *            rather than showing a generic failure.
 *
 *        `message` is customer-facing; `detail` is for the operator and is
 *        never rendered.
 * WHERE: Thrown by ./anthropic; caught in src/lib/script/generate.ts and the
 *        scripts router.
 */
export class LlmError extends Error {
  readonly detail: string;
  readonly permanent: boolean;
  readonly refusal: boolean;

  constructor(
    message: string,
    options: { detail?: string; permanent?: boolean; refusal?: boolean } = {},
  ) {
    super(message);
    this.name = "LlmError";
    this.detail = options.detail ?? "";
    this.permanent = options.permanent ?? false;
    this.refusal = options.refusal ?? false;
  }
}

export interface LlmAdapter {
  readonly id: LlmProviderId;

  /**
   * Asks the model to fill `schema`. Returns a parsed, validated value or
   * throws `LlmError`. Retries once on a schema failure — see
   * RETRY_ONCE_WITH_THE_ERROR.
   */
  generate<T>(args: LlmGenerateArgs<T>): Promise<T>;
}

export const LLM_PROVIDER_IDS = ["anthropic"] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];
