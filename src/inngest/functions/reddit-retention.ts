/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: redditRetentionFunction, reddit.retention, cron,
 *   SOMEBODY_ELSES_CONTENT, WHAT_EXPIRES_IS_THE_CACHED_SOURCE,
 *   EVALUATE_EVERY_DAY_FIRE_RARELY, RETENTION_IS_DERIVED_NOT_STORED,
 *   NEVER_DELETE_THE_CUSTOMERS_WORK
 *
 * WHAT:  Removes the cached Reddit thread from projects whose retention window
 *        has passed, and says what it did every day either way.
 *
 * WHY:   SOMEBODY_ELSES_CONTENT is the reason there is a clock at all. A
 *        thread's title, body and comments are other people's words, obtained
 *        under an API agreement that does not grant indefinite storage, and the
 *        people who wrote them can delete them. Keeping a copy forever is a
 *        commitment nobody made.
 *
 *        WHAT_EXPIRES_IS_THE_CACHED_SOURCE, and this is the phase's step 12
 *        read as narrowly as it can honestly be read. The sweep removes
 *        `settings.script.sourceText`, `settings.script.thread` and the
 *        `settings.reddit` snapshot — the copy of somebody else's thread. It
 *        does NOT touch the script, the narration audio, the timeline or any
 *        render.
 *
 *        NEVER_DELETE_THE_CUSTOMERS_WORK is why. Those are the customer's own
 *        derived work and they SPENT CREDITS on them; deleting a finished video
 *        on a schedule would be taking back something they paid for, and this
 *        app's own privacy copy currently promises the opposite ("your projects
 *        and media stay until you delete them"). If the owner decides the
 *        outputs themselves must expire, that is a separate decision with legal
 *        copy attached and a customer notification behind it — not a side
 *        effect of a retention cron. The visible consequence of this sweep is
 *        that the original thread text is no longer shown on the project and a
 *        re-condensation needs a fresh fetch.
 *
 *        RETENTION_IS_DERIVED_NOT_STORED. The window is `createdAt` plus
 *        `REDDIT_RETENTION_DAYS`, computed here and on the project screen from
 *        the same function, rather than a column written at creation. A stored
 *        date would be a second source of truth that goes stale the moment an
 *        operator changes the window — which is exactly the thing they will do
 *        once, deliberately, after reading their own terms.
 *
 *        NOTHING IS SILENT. The phase is explicit — "show the expiry date on
 *        the project page rather than deleting silently" — so the date is on
 *        the screen from the moment the project is created (`projects.get`
 *        returns it), and this run logs its verdict every day including the
 *        quiet ones. EVALUATE_EVERY_DAY_FIRE_RARELY, the same posture as the
 *        cost alert: a check that only writes something when it acts has a
 *        silence nobody can distinguish from a broken cron.
 *
 *        It is a CRON rather than a per-project timer because expiry is a date
 *        and not an event: there is nothing to react to, and a scheduled job
 *        per project would be tens of thousands of timers to express one
 *        daily sweep.
 * WHERE: Registered in src/inngest/functions/index.ts, served at /api/inngest.
 */

import { z } from "zod";

import { inngestClient } from "@/lib/adapters/jobs/inngest/client";
import { prisma } from "@/lib/config/prisma";
import { logLine, newRequestId } from "@/lib/observability";
import { jsonObjectSchema } from "@/lib/types/json";
import { REDDIT_RETENTION_DAYS, redditExpiresAt } from "@/lib/types/reddit";

/**
 * SOURCE OF TRUTH KEYWORDS: SWEEP_BATCH, BOUNDED_SWEEP
 *
 * How many projects one run will clear. BOUNDED_SWEEP: a backlog — the first
 * run after the window is shortened, or after the cron has been down — must
 * not be one unbounded transaction over every Reddit project ever made. The
 * remainder is picked up tomorrow, and the run says how much it left.
 */
const SWEEP_BATCH = 200;

/**
 * SOURCE OF TRUTH KEYWORDS: strippedSettingsSchema, SETTINGS_ARE_MERGED
 *
 * WHAT:  The keys the sweep removes from `Project.settings`.
 * WHY:   Named rather than computed, so what this job deletes is readable in
 *        one place. `sourceText` and `thread` are the thread's words;
 *        everything else under `script` — the target length, the tone, whether
 *        to condense — is the CUSTOMER's request and stays, so the project
 *        still explains what was asked for after the source is gone.
 * WHERE: The sweep below.
 */
const scriptKeepSchema = z
  .object({
    sourceKind: z.unknown().optional(),
    sourceTitle: z.unknown().optional(),
    truncated: z.unknown().optional(),
    targetSeconds: z.unknown().optional(),
    tone: z.unknown().optional(),
    condense: z.unknown().optional(),
  })
  .passthrough();

export const redditRetentionFunction = inngestClient.createFunction(
  {
    id: "reddit-retention",
    name: "Expire cached Reddit threads",
    /* Just after midnight UTC, a few minutes clear of the cost alert so the two
     * do not contend for the same worker. The hour is arbitrary; nothing
     * downstream depends on it. */
    triggers: [{ cron: "40 0 * * *" }],
    /* One retry. The work is a bounded read and an update per row — if it fails
     * twice the database is having a worse day than the retention policy is,
     * and tomorrow's run picks up everything this one missed. */
    retries: 1,
  },
  async ({ step }) => {
    /* A cron has no request behind it, so it mints its own id — every line this
     * run emits still ties together (ID_IS_CARRIED_NOT_DERIVED). */
    const requestId = newRequestId();

    const result = await step.run("sweep", async () => {
      const cutoff = new Date(
        Date.now() - REDDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );

      /* Reddit projects old enough to have expired. The `settings` filter is
       * deliberately absent — jsonb path filtering would tie this query to a
       * shape the sweep itself changes, and the per-row check below is exact. */
      const candidates = await prisma.project.findMany({
        where: { kind: "reddit-story", createdAt: { lte: cutoff } },
        select: { id: true, createdAt: true, settings: true },
        orderBy: { createdAt: "asc" },
        take: SWEEP_BATCH,
      });

      let cleared = 0;
      let alreadyClear = 0;

      for (const project of candidates) {
        const parsed = jsonObjectSchema.safeParse(project.settings);
        const bag = parsed.success ? parsed.data : {};

        const script = jsonObjectSchema.safeParse(bag["script"]);
        const hasSource =
          script.success &&
          (typeof script.data["sourceText"] === "string" ||
            script.data["thread"] !== undefined);
        const hasSnapshot = bag["reddit"] !== undefined;

        if (!hasSource && !hasSnapshot) {
          alreadyClear += 1;
          continue;
        }

        /* SETTINGS_ARE_MERGED — the keys this job owns are removed and
         * everything else is written back untouched. The customer's REQUEST
         * (what length, what tone, whether to condense) survives, so the
         * project still explains itself after its source is gone. */
        const keptScript = script.success
          ? scriptKeepSchema.parse(script.data)
          : undefined;

        const next: Record<string, unknown> = { ...bag };
        delete next["reddit"];
        if (keptScript === undefined) {
          delete next["script"];
        } else {
          delete (keptScript as Record<string, unknown>)["sourceText"];
          delete (keptScript as Record<string, unknown>)["thread"];
          next["script"] = keptScript;
        }

        await prisma.project.update({
          where: { id: project.id },
          data: { settings: jsonObjectSchema.parse(next) },
        });
        cleared += 1;
      }

      return {
        windowDays: REDDIT_RETENTION_DAYS,
        examined: candidates.length,
        cleared,
        alreadyClear,
        /* A full batch means there is more waiting. Reported rather than
         * inferred, so an operator can see a backlog draining. */
        moreToDo: candidates.length === SWEEP_BATCH,
        oldestExpiry:
          candidates[0] === undefined
            ? null
            : redditExpiresAt(candidates[0].createdAt).toISOString(),
      };
    });

    /* EVALUATE_EVERY_DAY_FIRE_RARELY — the quiet days are logged too. A sweep
     * that only spoke when it deleted something would have a silence nobody
     * could tell from a broken cron. */
    logLine({
      requestId,
      logger: "retention",
      level: result.cleared > 0 ? "info" : "debug",
      event: "reddit.retention.swept",
      /* The fields are listed rather than spread, because `data` is typed to
       * JSON scalars and spreading a wider object would be a cast. */
      data: {
        windowDays: result.windowDays,
        examined: result.examined,
        cleared: result.cleared,
        alreadyClear: result.alreadyClear,
        moreToDo: result.moreToDo,
        oldestExpiry: result.oldestExpiry,
      },
    });

    return result;
  },
);
