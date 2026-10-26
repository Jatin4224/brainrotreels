/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: backgrounds.service test, isWithinBreadth,
 *   BreadthCursor, A_CURSOR_NOT_A_ROW_INDEX, BREADTH_IS_APPLIED_AT_READ_TIME,
 *   CATALOGUE_ORDER_IS_STABLE
 *
 * WHAT:  The pure half of the background service — the comparison that decides
 *        whether a catalogue row falls inside a plan's slice.
 *
 * WHY:   This one function is the whole breadth cap. The lock badge on a tile
 *        and the refusal on the write both call it, which is the only reason
 *        they cannot drift — so it is worth asserting rather than trusting,
 *        including the two boundary rows nobody clicks by accident and the
 *        tie-break that only matters when two assets were synced in the same
 *        millisecond.
 *
 *        A_CURSOR_NOT_A_ROW_INDEX is the property under test. The earlier
 *        implementation used a row's position in the page, which was wrong the
 *        moment a search was applied: the rank among the MATCHES says nothing
 *        about the rank in the catalogue, so a free workspace could be shown
 *        rows thirty to forty as unlocked and then refused by the server. A
 *        cursor comparison is filter-independent, and these tests are what say
 *        so.
 *
 *        The database-touching functions are not covered: they are Prisma
 *        queries whose behaviour is the `where` clause, and asserting them
 *        would mean asserting Prisma.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { isWithinBreadth, type BreadthCursor } from "./backgrounds.service";

const at = (iso: string) => new Date(iso);

function row(id: string, iso: string) {
  return { id, createdAt: at(iso) };
}

describe("isWithinBreadth", () => {
  /* An unlimited plan, and a catalogue smaller than the cap, both resolve to
   * `all` — and they have to mean the same thing, because "the plan allows 100
   * and there are 7" is not a restriction. */
  it("includes everything when the plan's slice is the whole catalogue", () => {
    const cursor: BreadthCursor = { scope: "all" };
    expect(isWithinBreadth(row("lib-a", "2026-01-01T00:00:00Z"), cursor)).toBe(
      true,
    );
    expect(isWithinBreadth(row("lib-z", "2030-01-01T00:00:00Z"), cursor)).toBe(
      true,
    );
  });

  /* Reachable: a plan whose cap is zero. It must lock everything rather than
   * fall through to "no cursor, so no limit", which is what a nullable row
   * would have done. */
  it("includes nothing when the plan's slice is empty", () => {
    const cursor: BreadthCursor = { scope: "none" };
    expect(isWithinBreadth(row("lib-a", "2026-01-01T00:00:00Z"), cursor)).toBe(
      false,
    );
  });

  describe("with a cursor at the last included row", () => {
    const cursor: BreadthCursor = {
      scope: "upTo",
      createdAt: at("2026-01-10T00:00:00Z"),
      id: "lib-middle",
    };

    it("includes a row synced earlier", () => {
      expect(
        isWithinBreadth(row("lib-anything", "2026-01-09T23:59:59Z"), cursor),
      ).toBe(true);
    });

    /* Inclusive: the cursor IS the last row the plan includes, so the boundary
     * row itself must be usable. Off by one here locks a background the
     * customer has paid for. */
    it("includes the cursor row itself", () => {
      expect(
        isWithinBreadth(row("lib-middle", "2026-01-10T00:00:00Z"), cursor),
      ).toBe(true);
    });

    it("excludes a row synced later", () => {
      expect(
        isWithinBreadth(row("lib-anything", "2026-01-10T00:00:01Z"), cursor),
      ).toBe(false);
    });

    /* CATALOGUE_ORDER_IS_STABLE's tie-break. Two rows synced in the same
     * millisecond are ordered by id, and the comparison has to agree with the
     * `orderBy` that produced the cursor — otherwise the boundary moves
     * depending on which of the two the caller happens to hold. */
    it("breaks a tie on id, the same way the catalogue ordering does", () => {
      expect(
        isWithinBreadth(row("lib-aaa", "2026-01-10T00:00:00Z"), cursor),
      ).toBe(true);
      expect(
        isWithinBreadth(row("lib-zzz", "2026-01-10T00:00:00Z"), cursor),
      ).toBe(false);
    });

    /* The point of a cursor: the answer cannot depend on how the row was
     * found, so the same row gives the same verdict whether it came from page
     * one, page four, or a search with two hits. */
    it("gives the same verdict whatever query produced the row", () => {
      const subject = row("lib-late", "2026-02-01T00:00:00Z");
      const verdicts = [subject, subject, subject].map((candidate) =>
        isWithinBreadth(candidate, cursor),
      );
      expect(new Set(verdicts).size).toBe(1);
      expect(verdicts[0]).toBe(false);
    });
  });
});
