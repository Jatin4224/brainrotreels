/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: validation.test, firstIssueMessage,
 *   THE_FIRST_ISSUE_IS_THE_MESSAGE, ONE_VALIDATION_SENTENCE_EVERY_SURFACE
 *
 * WHAT:  That a Zod failure becomes one sentence naming the field.
 *
 * WHY:   This function is now the only implementation behind both surfaces'
 *        validation copy, so its edge cases are the ones that used to differ
 *        between them: a nested path, an issue at the root, and the
 *        theoretically-empty issue list that would otherwise read as an
 *        undefined in a customer-facing message.
 * WHERE: src/lib/api/validation.ts.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { firstIssueMessage } from "./validation";

/* A real parse failure rather than a hand-built ZodError, so the test breaks
 * if Zod changes the shape this function reads. */
function failureOf(schema: z.ZodType, value: unknown): z.ZodError {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error("expected this to fail");
  return parsed.error;
}

describe("firstIssueMessage", () => {
  it("names the field that was wrong", () => {
    const schema = z.object({ title: z.string().min(1) });
    const message = firstIssueMessage(failureOf(schema, { title: "" }));

    expect(message).toContain("title");
  });

  it("joins a nested path with dots, so a caller can find the field", () => {
    const schema = z.object({
      caption: z.object({ style: z.string().min(1) }),
    });
    const message = firstIssueMessage(
      failureOf(schema, { caption: { style: "" } }),
    );

    expect(message).toContain("caption.style");
  });

  it("reports an array element by its index", () => {
    const schema = z.object({ speakers: z.array(z.string().min(1)) });
    const message = firstIssueMessage(
      failureOf(schema, { speakers: ["ok", ""] }),
    );

    expect(message).toContain("speakers.1");
  });

  it("uses the issue's own message when the failure is at the root", () => {
    /* An empty path has no field to name, so prefixing it with `": "` would
     * produce a sentence starting with punctuation. */
    const schema = z.string().min(3);
    const message = firstIssueMessage(failureOf(schema, "a"));

    expect(message.startsWith(":")).toBe(false);
    expect(message.length).toBeGreaterThan(0);
  });

  it("names a missing required field rather than describing the type", () => {
    const schema = z.object({ projectId: z.string().min(1) });
    const message = firstIssueMessage(failureOf(schema, {}));

    expect(message).toContain("projectId");
  });

  it("never returns an empty string or an undefined", () => {
    /* It goes straight into a customer-facing `error.message`, so the
     * degenerate case has to be a sentence rather than a blank. */
    const empty = { issues: [] } as unknown as z.ZodError;

    expect(firstIssueMessage(empty)).toBe(
      "The request could not be validated.",
    );
  });
});
