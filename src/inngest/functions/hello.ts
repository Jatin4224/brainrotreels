/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: helloFunction, hello/requested, WIRING_PROOF,
 *   inngest step, workflow template
 *
 * WHAT:  A two-step no-op workflow that proves the Inngest wiring end to end.
 * WHY:   WIRING_PROOF. Before any real pipeline exists there has to be one
 *        function that answers "does an event sent from the app actually reach
 *        a running workflow" — otherwise the first failure in Phase 09 is
 *        ambiguous between a broken pipeline and a broken connection.
 *        Two steps rather than one on purpose: it demonstrates that step
 *        results are memoised independently, which is the property every later
 *        workflow depends on for resumability.
 *        Keep it. It costs nothing and it is the first thing to run when the
 *        queue misbehaves.
 * WHERE: Registered in src/inngest/functions/index.ts, served at /api/inngest.
 */

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";

/* Inngest v4 takes two arguments, with the trigger inside options — v3's
 * three-argument `(config, trigger, handler)` form no longer type-checks. */
export const helloFunction = inngestClient.createFunction(
  {
    id: "hello",
    name: "Hello (wiring proof)",
    triggers: [{ event: "hello/requested" }],
  },
  async ({ event, step }) => {
    const greeted = await step.run("greet", () => {
      const name =
        typeof event.data["name"] === "string" ? event.data["name"] : "world";
      return { greeting: `hello, ${name}` };
    });

    /* A second step so the run shows two independently memoised results. */
    const stamped = await step.run("stamp", () => ({
      ...greeted,
      at: new Date().toISOString(),
    }));

    return stamped;
  },
);
