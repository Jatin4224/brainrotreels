/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: anthropicLlmAdapter, STRUCTURED_OUTPUTS_NOT_TOOLS,
 *   RETRY_ONCE_WITH_THE_ERROR, PROVIDER_ISOLATION, LLM_REFUSAL,
 *   PERMANENT_VS_TRANSIENT_FAILURE, ANTHROPIC_MODEL
 *
 * WHAT:  The Claude implementation of LlmAdapter.
 *
 * WHY:   STRUCTURED_OUTPUTS_NOT_TOOLS. The schema is enforced with
 *        `client.messages.parse()` + `zodOutputFormat`, which constrains the
 *        response format itself. Two alternatives were available and both are
 *        worse here:
 *
 *          - A tool with `strict: true` and `tool_choice: {type: 'tool'}` —
 *            the classic "make it return JSON" trick. FORCED TOOL CHOICE IS
 *            REJECTED on the current models (a 400), so this does not merely
 *            read worse, it does not work.
 *          - Asking for JSON in the prompt and parsing the text. That is the
 *            thing structured outputs exist to replace: it fails on a stray
 *            preamble, a trailing code fence, or a smart quote, and every one
 *            of those is a paid request thrown away.
 *
 *        RETRY_ONCE_WITH_THE_ERROR, the phase's step 2, lives here rather than
 *        in the caller so every consumer gets it without opting in. The retry
 *        appends the VALIDATION ERROR to the user turn — not a bare "try
 *        again", which gives the model nothing to correct. Exactly once: a
 *        second failure is the question being wrong, not the model having a
 *        bad moment, and each attempt is billed to a customer's credits.
 *
 *        Nothing is prefilled and no `tool_choice` is forced, because both
 *        return a 400 on the current models. Nothing sets `budget_tokens`
 *        either — thinking is always on for this model family and the token
 *        budget parameter is rejected; depth is controlled with
 *        `output_config.effort`.
 * WHERE: Loaded by ../index.ts through a dynamic import. eslint confines the
 *        `@anthropic-ai/sdk` import to this folder.
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import { LlmError, type LlmAdapter, type LlmGenerateArgs } from "../types";
import { DEFAULT_MAX_TOKENS, anthropicConfig } from "./config";

let client: Anthropic | null = null;

/**
 * LAZY_CLIENT, matching the R2 and Stripe clients: built on first use and
 * throwing there, not at import. Script generation is optional until somebody
 * generates, and a module-scope throw would crash the setup checklist — the
 * one screen whose job is to report which variables are missing.
 */
function getClient(): Anthropic {
  if (client) return client;
  const config = anthropicConfig();
  client = new Anthropic({ apiKey: config.apiKey });
  return client;
}

export const anthropicLlmAdapter: LlmAdapter = {
  id: "anthropic",

  async generate<T>(args: LlmGenerateArgs<T>): Promise<T> {
    const config = anthropicConfig();
    const anthropic = getClient();
    const label = args.purpose ?? "llm.generate";

    /* The first attempt, and then at most one more carrying the validation
     * error. A plain loop rather than recursion so the attempt count is
     * visible and cannot run away. */
    let lastIssue: string | null = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const user =
        lastIssue === null
          ? args.user
          : `${args.user}\n\n${retryInstruction(lastIssue)}`;

      let response;
      try {
        response = await anthropic.messages.parse({
          model: config.model,
          max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
          system: args.system,
          messages: [{ role: "user", content: user }],
          output_config: {
            effort: config.effort,
            /* SCHEMA_IS_THE_CONTRACT — the response format is constrained by
             * the caller's own Zod schema, so `parsed_output` is either the
             * right shape or null. */
            format: zodOutputFormat(args.schema as z.ZodType),
          },
        });
      } catch (error) {
        throw toLlmError(error, label);
      }

      /* A safety decline. Checked BEFORE the content, because a refused
       * response still returns 200 with content blocks — reading them first
       * would treat a refusal as a parse failure and spend the retry on a
       * request that will be refused identically. */
      if (response.stop_reason === "refusal") {
        throw new LlmError(
          "The assistant declined to write this script. Try rephrasing the source material.",
          {
            detail: `[llm/anthropic] ${label} refused: ${response.stop_details?.category ?? "unknown"}`,
            permanent: true,
            refusal: true,
          },
        );
      }

      if (response.stop_reason === "max_tokens") {
        /* Permanent as far as a retry with the same budget is concerned: the
         * answer did not fit, and asking again produces the same truncation. */
        throw new LlmError(
          "That source was too long to turn into a script. Try a shorter input.",
          {
            detail: `[llm/anthropic] ${label} hit max_tokens before completing the schema.`,
            permanent: true,
          },
        );
      }

      const parsed = response.parsed_output;
      if (parsed !== null && parsed !== undefined) {
        /* Parsed by the SDK against the caller's schema. Re-validating here
         * would be the same check twice; the type is already T. */
        return parsed as T;
      }

      /* The model answered but the answer did not fit the schema. Capture why,
       * so the retry has something specific to correct. */
      lastIssue = describeSchemaFailure(args.schema, response);

      console.warn(
        `[llm/anthropic] ${label} attempt ${attempt} did not match the schema: ${lastIssue}`,
      );
    }

    /* RETRY_ONCE_WITH_THE_ERROR — both attempts failed the schema. Permanent:
     * a third request is the same question asked a third time. */
    throw new LlmError(
      "The assistant could not produce a usable script. Please try again, or edit the source text.",
      {
        detail: `[llm/anthropic] ${label} failed the schema twice. Last issue: ${lastIssue ?? "unknown"}`,
        permanent: true,
      },
    );
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: retryInstruction, RETRY_ONCE_WITH_THE_ERROR
 *
 * WHAT:  The correction appended to the second attempt.
 * WHY:   It names the FAILURE, not the requirement. "Return valid JSON" is
 *        already in the schema the model was given and repeating it adds
 *        nothing; "`blocks[2].sectionType` was 'intro', which is not one of
 *        hook, body, cta" is a correctable statement. It is also phrased as
 *        data about the previous attempt rather than as a new instruction, so
 *        it cannot be confused with the untrusted source text above it.
 * WHERE: The retry branch above.
 */
function retryInstruction(issue: string): string {
  return [
    "Your previous response did not match the required output schema.",
    `The problem was: ${issue}`,
    "Produce the same content again, corrected to match the schema exactly.",
  ].join("\n");
}

/**
 * SOURCE OF TRUTH KEYWORDS: describeSchemaFailure
 *
 * WHAT:  A short, specific reason the response did not fit the schema.
 * WHY:   `parsed_output` is null without saying why, so the reason has to be
 *        recovered by running the schema over the raw text ourselves. Zod's
 *        own issue list is the best description available and it is already
 *        in the caller's vocabulary.
 *
 *        Falls back to a generic sentence rather than throwing: this runs on
 *        the path where something has ALREADY gone wrong, and a crash here
 *        would replace a retryable failure with an unexplained one.
 * WHERE: Between the two attempts above.
 */
function describeSchemaFailure(
  schema: z.ZodType,
  response: { content: unknown[] },
): string {
  try {
    const text = response.content
      .filter(
        (block): block is { type: "text"; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text",
      )
      .map((block) => block.text)
      .join("");

    if (text.trim().length === 0) return "the response contained no text";

    const result = schema.safeParse(JSON.parse(text));
    if (result.success) return "the response could not be parsed by the SDK";

    return result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
  } catch {
    return "the response was not valid JSON";
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: toLlmError, PERMANENT_VS_TRANSIENT_FAILURE
 *
 * WHAT:  Classifies an SDK error as permanent or worth retrying.
 * WHY:   Narrowed on the SDK's TYPED error classes rather than on message
 *        text, which is localised and changes between versions. The chain is
 *        most-specific-first, and the DEFAULT is permanent — the safe
 *        direction for a billed call: mistaking a blip for a permanent failure
 *        costs one failed generation the customer can retry by hand, while
 *        mistaking a malformed prompt for a blip bills them three times for
 *        the same refusal.
 * WHERE: Around the request above.
 */
function toLlmError(error: unknown, label: string): LlmError {
  if (error instanceof LlmError) return error;

  const detail = `[llm/anthropic] ${label}: ${error instanceof Error ? error.message : String(error)}`;

  if (error instanceof Anthropic.RateLimitError) {
    return new LlmError(
      "The assistant is busy right now. This will be retried automatically.",
      {
        detail,
        permanent: false,
      },
    );
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new LlmError(
      "Script generation is not configured. Please contact support.",
      { detail, permanent: true },
    );
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new LlmError(
      "That source could not be turned into a script. Try shortening or rephrasing it.",
      { detail, permanent: true },
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmError(
      "The assistant could not be reached. This will be retried automatically.",
      {
        detail,
        permanent: false,
      },
    );
  }
  if (error instanceof Anthropic.APIError) {
    /* 5xx is transient, everything else is not. `status` is typed on the base
     * class, so this covers every status the chain above did not name. */
    const status = error.status ?? 0;
    return new LlmError(
      status >= 500
        ? "The assistant is temporarily unavailable. This will be retried automatically."
        : "That script could not be generated. Please try again.",
      { detail, permanent: status < 500 },
    );
  }

  return new LlmError("That script could not be generated. Please try again.", {
    detail,
    permanent: true,
  });
}
