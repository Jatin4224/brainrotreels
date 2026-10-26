/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: getStorageAdapter, LAZY_CLIENT, isR2Configured,
 *   storage seam tests, FAIL_AT_CALL_TIME
 *
 * WHAT:  Tests that the storage seam resolves, and that an unconfigured R2
 *        fails at call time with an actionable message.
 * WHY:   FAIL_AT_CALL_TIME is the same posture config/stripe.ts takes, and it
 *        is load-bearing: the root layout renders the setup checklist — the
 *        one screen whose job is to say which variables are missing — and a
 *        module-scope throw anywhere in its import graph would replace that
 *        checklist with a stack trace. These tests run with no R2 variables
 *        set, which is exactly the fresh-clone case.
 * WHERE: Run by `npm test`. Guards the storage adapter's laziness.
 */

import { describe, expect, it } from "vitest";

import {
  getStorageAdapter,
  STORAGE_PROVIDER,
  STORAGE_PROVIDER_IDS,
} from "./index";
import { isR2Configured } from "./r2/client";

describe("storage seam", () => {
  it("defaults to r2", () => {
    expect(STORAGE_PROVIDER).toBe("r2");
    expect(STORAGE_PROVIDER_IDS).toContain("r2");
  });

  /* Importing the adapter must not require credentials — only using it does. */
  it("resolves the adapter without any R2 configuration", async () => {
    const adapter = await getStorageAdapter();
    expect(adapter.id).toBe("r2");
  });

  it("memoises the adapter", async () => {
    const [a, b] = await Promise.all([
      getStorageAdapter(),
      getStorageAdapter(),
    ]);
    expect(a).toBe(b);
  });

  it("reports itself unconfigured when the env is absent", () => {
    expect(isR2Configured()).toBe(false);
  });

  /* The message has to name the variables — "undefined is not a function"
   * from deep inside the SDK is the failure mode this replaces. */
  it("throws an actionable error on first use, not on import", async () => {
    const adapter = await getStorageAdapter();
    await expect(
      adapter.signedGetUrl("orgs/o/uploads/a/b.mp4"),
    ).rejects.toThrow(/R2_ACCOUNT_ID|R2_BUCKET|not configured/);
  });

  /* A no-op delete must not reach the SDK at all, so it stays safe to call
   * unconditionally in cleanup paths. */
  it("treats an empty batch delete as a no-op", async () => {
    const adapter = await getStorageAdapter();
    await expect(adapter.deleteObjects([])).resolves.toBeUndefined();
  });
});

/**
 * SOURCE OF TRUTH KEYWORDS: publicUrl tests, CDN_IS_OPTIONAL,
 *   PUBLIC_IS_NOT_SIGNED
 *
 * WHAT:  That a bucket with no CDN in front of it still works.
 * WHY:   CDN_IS_OPTIONAL is the half of Phase 11's CDN serving that has to be
 *        true on a fresh clone: `R2_PUBLIC_URL` is optional, and these tests
 *        run with no R2 variables at all, so `publicUrl` must answer null
 *        rather than throw or invent an origin. `signScopedKey` then falls back
 *        to signing, and the only cost of an unconfigured CDN is cache misses.
 * WHERE: Run by `npm test`. Guards publicUrl in ./r2.
 */
describe("publicUrl", () => {
  it("answers null with no CDN origin configured", async () => {
    const adapter = await getStorageAdapter();
    expect(adapter.publicUrl("library/backgrounds/lib-waves/vertical.mp4")).toBeNull();
  });

  /* It must not need credentials either — the same laziness as the rest of the
   * adapter (FAIL_AT_CALL_TIME), since a public URL is string concatenation and
   * has nothing to sign. */
  it("does not require R2 credentials", async () => {
    const adapter = await getStorageAdapter();
    expect(isR2Configured()).toBe(false);
    expect(() => adapter.publicUrl("library/x/y.mp4")).not.toThrow();
  });
});
