/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: project-kinds test, CREATABLE_PROJECT_KINDS,
 *   PROJECT_KINDS, SCRIPT_WRITERS, A_FORMAT_NEEDS_A_WRITER, hasScriptWriter
 *
 * WHAT:  That every format the create form offers has a script writer behind
 *        it, and that the offered list is a real subset of the kinds the system
 *        understands.
 *
 * WHY:   A_FORMAT_NEEDS_A_WRITER. `CREATABLE_PROJECT_KINDS` has to be written
 *        out by hand rather than derived from `SCRIPT_WRITERS`, because the
 *        writer registry imports the LLM adapter and the create form is a
 *        client component — deriving it there would ship the provider SDK to
 *        the browser. This test is what that hand-written list is traded for:
 *        the drift it would otherwise allow is caught here instead, in a node
 *        test that may import the registry freely.
 *
 *        The failure it prevents is not theoretical and it is not cheap.
 *        `motion` was offered in the form with no writer entry, and
 *        `motionGenerator.skips` does not skip `script` — so starting one
 *        showed an estimate, took the credit hold, and then refused the kind at
 *        the `script` stage. A format that cannot finish must not be
 *        selectable, and the moment to notice a new one is when it is added.
 *
 *        Asserted in both directions on purpose. The subset check catches a
 *        kind offered that the schema would reject; the writer check catches a
 *        kind offered that the pipeline cannot write. A kind with a writer that
 *        is deliberately NOT offered yet is allowed — that is a product choice,
 *        not drift.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import { CREATABLE_PROJECT_KINDS, PROJECT_KINDS } from "./project";
import { hasScriptWriter } from "@/lib/script/writers";

describe("CREATABLE_PROJECT_KINDS", () => {
  it("only offers kinds the system understands", () => {
    for (const kind of CREATABLE_PROJECT_KINDS) {
      expect(PROJECT_KINDS).toContain(kind);
    }
  });

  it("only offers kinds that have a script writer", () => {
    for (const kind of CREATABLE_PROJECT_KINDS) {
      expect(
        hasScriptWriter(kind),
        `"${kind}" is offered in the create form but has no SCRIPT_WRITERS entry, so its run would fail at the script stage after taking a credit hold.`,
      ).toBe(true);
    }
  });

  it("is not empty — a product with no startable format is not shippable", () => {
    expect(CREATABLE_PROJECT_KINDS.length).toBeGreaterThan(0);
  });

  /* Documents the one current difference rather than asserting the lists are
   * equal: `motion` is understood, generated and editable, and is withheld from
   * the form only because nothing writes its script yet. When a motion writer
   * lands, this expectation is the thing that should fail and be deleted. */
  it("withholds motion until it has a writer", () => {
    expect(PROJECT_KINDS).toContain("motion");
    expect(hasScriptWriter("motion")).toBe(false);
    expect(CREATABLE_PROJECT_KINDS as readonly string[]).not.toContain(
      "motion",
    );
  });
});
