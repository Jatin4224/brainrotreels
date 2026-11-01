/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: firstIssueMessage, THE_FIRST_ISSUE_IS_THE_MESSAGE,
 *   ONE_VALIDATION_SENTENCE_EVERY_SURFACE, ZOD_IS_THE_CONTRACT
 *
 * WHAT:  A Zod failure as one sentence naming the field that was wrong.
 *
 * WHY:   THE_FIRST_ISSUE_IS_THE_MESSAGE. A serialised issue array is accurate
 *        and unreadable; the common case is one typo, and a client reading
 *        `error.message` should get something it can act on. A client that
 *        wants structure has the OpenAPI document and the tool's
 *        `inputSchema`, both generated from the same schema — so nothing is
 *        lost by not shipping every issue here.
 *
 *        ONE_VALIDATION_SENTENCE_EVERY_SURFACE is why this is its own module.
 *        The REST pipeline and the MCP tool dispatcher both reject bad input,
 *        and both had this same path-joining, first-issue logic written out
 *        separately — which means the wording of a validation failure could
 *        drift between a `POST /api/v1/renders` and a `start_render` tool call
 *        for the same mistake. One function is one sentence.
 *
 *        Pure, and that is deliberate: it is the half of both surfaces'
 *        validation that can be tested without a database or a request.
 * WHERE: `parseInput` in src/app/api/v1/_lib/handler.ts, and every tool's
 *        `validate` in src/lib/api/mcp-tools.ts.
 */

import type { z } from "zod";

export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "The request could not be validated.";

  /* A nested path reads as `caption.style`, which is what a caller needs in
   * order to find the field. An issue at the root has an empty path and is
   * better served by its own message alone. */
  const path = issue.path.join(".");
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}
