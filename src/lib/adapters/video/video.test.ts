/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: video adapter test, VideoError, REFUSED_IS_NOT_FAILED,
 *   PERMANENT_VS_TRANSIENT_FAILURE, looksLikeRefusal, readOutputUrl,
 *   THE_OUTPUT_SHAPE_VARIES_BY_MODEL
 *
 * WHAT:  That a video failure is classified the way the workflow depends on,
 *        and that a finished generation's URL is read whichever shape the
 *        model reported it in.
 *
 * WHY:   PERMANENT_VS_TRANSIENT_FAILURE is the assertion that earns its place
 *        here, because getting it wrong costs real money in one direction and
 *        a broken feature in the other. `transient` is what the workflow
 *        branches on: a reason wrongly marked transient means retrying a
 *        refusal the provider will decline again, and every attempt may be
 *        billed; a reason wrongly marked permanent means giving up on a rate
 *        limit that would have cleared in seconds.
 *
 *        REFUSED_IS_NOT_FAILED is asserted on the classification rather than
 *        on a request, because the distinction exists for the CUSTOMER: a
 *        refusal means reword, and a failure means try again. Collapsing them
 *        produces three identical refusals and a support ticket.
 *
 *        THE_OUTPUT_SHAPE_VARIES_BY_MODEL — a string and an array are both
 *        normal on this provider, and which one you get is a property of the
 *        model rather than the API. A reader that handled only one would work
 *        until somebody changed `VIDEO_MODEL`.
 *
 *        What is NOT tested here: the HTTP calls. They need a provider, and a
 *        mocked `fetch` would assert that this code calls the mock the way the
 *        test set the mock up.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { VIDEO_FETCH_ERRORS, VideoError } from "./types";
import { looksLikeRefusal, readOutputUrl } from "./replicate";

describe("classifying a video failure", () => {
  it("retries only the reasons that can clear on their own", () => {
    /* PERMANENT_VS_TRANSIENT_FAILURE — the workflow branches on this. */
    expect(new VideoError("rate_limited", "busy").transient).toBe(true);
    expect(new VideoError("unavailable", "down").transient).toBe(true);

    expect(new VideoError("refused", "declined").transient).toBe(false);
    expect(new VideoError("unauthorized", "bad key").transient).toBe(false);
    expect(new VideoError("failed", "broke").transient).toBe(false);
  });

  it("classifies every reason it declares", () => {
    /* A reason added to the union without a decision about retrying would
     * default to `false` here, which is the safe direction but should be a
     * choice somebody made rather than one the getter made for them. */
    for (const reason of VIDEO_FETCH_ERRORS) {
      const error = new VideoError(reason, "a message");
      expect(typeof error.transient, reason).toBe("boolean");
    }
  });

  it("keeps the customer message and the operator detail apart", () => {
    /* The message is rendered; the detail is logged. A provider's raw body in
     * a toast is how a customer learns our model name and nothing useful. */
    const error = new VideoError(
      "refused",
      "The video model would not generate this clip.",
      "[video/replicate] 422: nsfw",
    );

    expect(error.message).not.toContain("422");
    expect(error.detail).toContain("422");
    expect(error.name).toBe("VideoError");
  });
});

describe("recognising a safety refusal", () => {
  it("matches the wordings providers actually use", () => {
    for (const body of [
      '{"detail":"Request flagged by safety checker"}',
      '{"error":"content policy violation"}',
      '{"detail":"NSFW content detected"}',
      '{"detail":"Output was flagged"}',
    ]) {
      expect(looksLikeRefusal(body), body).toBe(true);
    }
  });

  it("is case insensitive, because error text is not a contract", () => {
    expect(looksLikeRefusal("SAFETY")).toBe(true);
    expect(looksLikeRefusal("Content Policy")).toBe(true);
  });

  it("does not read an ordinary failure as a refusal", () => {
    /* A miss in this direction costs one pointless retry; a false positive
     * tells a customer to reword a prompt that was fine. */
    for (const body of [
      '{"detail":"Internal server error"}',
      '{"detail":"model is booting"}',
      '{"detail":"prediction timed out"}',
      "",
    ]) {
      expect(looksLikeRefusal(body), body).toBe(false);
    }
  });
});

describe("reading a finished generation", () => {
  it("accepts a bare URL string", () => {
    expect(readOutputUrl({ output: "https://example.test/clip.mp4" })).toBe(
      "https://example.test/clip.mp4",
    );
  });

  it("accepts an array and takes the first clip", () => {
    /* THE_OUTPUT_SHAPE_VARIES_BY_MODEL. The first because this seam asks for
     * ONE clip — a model returning several has produced variants nobody asked
     * for. */
    expect(
      readOutputUrl({
        output: ["https://example.test/a.mp4", "https://example.test/b.mp4"],
      }),
    ).toBe("https://example.test/a.mp4");
  });

  it("returns null for anything it cannot read", () => {
    /* Null rather than throwing: the caller turns it into a readable failure
     * with the credits released, which is better than an exception inside a
     * workflow step. */
    expect(readOutputUrl({})).toBeNull();
    expect(readOutputUrl({ output: null })).toBeNull();
    expect(readOutputUrl({ output: [] })).toBeNull();
    expect(readOutputUrl({ output: "" })).toBeNull();
    expect(readOutputUrl({ output: [123] })).toBeNull();
    expect(readOutputUrl({ output: { url: "x" } })).toBeNull();
  });
});
