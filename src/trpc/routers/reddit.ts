/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: redditRouter, redditStories.preview,
 *   redditStories.start, DURATION_BEFORE_GENERATION, REFUSE_BEFORE_PAYING,
 *   EVERY_FAILURE_OFFERS_THE_FALLBACK, FIVE_FAILURES_NOT_ONE,
 *   SNAPSHOT_IS_WHAT_THE_CARD_SHOWS, URL_IS_VALIDATED_TWICE
 *
 * WHAT:  The two Reddit procedures: look at a thread for free, then start a
 *        story from it.
 *
 * WHY:   DURATION_BEFORE_GENERATION is the phase's step 5 and the whole reason
 *        `preview` exists as a separate, FREE read. The customer has to see the
 *        final duration and the over-60-seconds warning BEFORE anything is
 *        generated — and that is not knowable from a URL, because the length of
 *        a thread depends on what is in it. So `preview` fetches, estimates
 *        from the real text with the SAME estimator the script uses, and writes
 *        nothing at all. It costs one Reddit request and no credits.
 *
 *        REFUSE_BEFORE_PAYING, as `scripts.generate` does: the credit check
 *        happens before the fetch, so a workspace with no balance is not made
 *        to wait for a download it cannot use.
 *
 *        FIVE_FAILURES_NOT_ONE and EVERY_FAILURE_OFFERS_THE_FALLBACK. Both
 *        procedures surface the adapter's REASON as its own sentence
 *        (`redditErrorMessage`), and every one of those sentences ends by
 *        pointing at pasting the text — which is a first-class arm of the input
 *        schema rather than a consolation. The copy lives in lib/types so the
 *        panel can show the same words for a refusal it can detect itself.
 *
 *        URL_IS_VALIDATED_TWICE, and the two checks answer different questions.
 *        `parseRedditThreadUrl` says "is this a Reddit thread link" — a host
 *        allowlist and a base-36 post id, pure and free, so a bad link is
 *        refused before a request is made. The adapter then calls OUR api host
 *        with nothing of the customer's but that validated id, which is why
 *        there is no SSRF question on this path at all (see the note on
 *        `fromReddit`).
 *
 *        Both procedures are gated by the `redditStories` FLAG, automatically:
 *        the resource declares one, so section 10 of the procedure builder
 *        refuses every verb — reads included — when the operator turns the
 *        format off. That is the kill switch described on the registry entry
 *        (A_FLAG_NOT_A_LIMIT), and it is the reason neither handler checks
 *        anything about availability itself.
 * WHERE: Mounted as `redditStories` in src/trpc/routers/_app.ts. The model call
 *        is handed to the EXISTING script workflow via `script/requested`,
 *        which resolves the writer from the project's kind
 *        (ONE_WORKFLOW_MANY_WRITERS) — there is no Reddit-specific workflow.
 */

import { TRPCError } from "@trpc/server";

import { createStructuredError, createTRPCRouter } from "../init";
import { protectedProcedure } from "../procedures";
import { permissions } from "@/lib/permissions";
import { ERROR_CODES } from "@/lib/errors";
import { enqueue } from "@/lib/adapters/jobs";
import { parseRedditThreadUrl } from "@/lib/adapters/reddit/url";
import { estimateThreadSeconds } from "@/lib/script/condense";
import { SourceExtractionError, extractSource } from "@/lib/script";
import { getBalance } from "@/services/credits.service";
import { estimate } from "@/lib/credits";
import { findProjectForOrganization } from "@/services/projects.service";
import { jsonObjectSchema } from "@/lib/types/json";
import {
  previewRedditThreadSchema,
  redditUrlRefusalMessage,
  startRedditStorySchema,
} from "@/lib/types/reddit";
import { getRedditAdapter, RedditError } from "@/lib/adapters/reddit";
import { redditErrorMessage } from "@/lib/types/reddit";
import { estimateSpokenSeconds, SCRIPT_WARN_SECONDS } from "@/lib/types/script";

export const redditRouter = createTRPCRouter({
  /**
   * SOURCE OF TRUTH KEYWORDS: redditStories.preview, DURATION_BEFORE_GENERATION
   *
   * WHAT:  What a thread is, and how long it would take to narrate.
   *
   * WHY:   A QUERY, so it is cacheable, re-runnable and costs nothing on the
   *        ledger — and it writes nothing, which is what lets the panel call it
   *        as somebody finishes pasting a link. The over-limit verdict comes
   *        from the same `estimateSpokenSeconds` the script pacing uses, so the
   *        number shown here and the number stored on the blocks later are the
   *        same arithmetic.
   *
   *        It REFUSES rather than returning a failure shape, because every
   *        refusal here is actionable and tRPC's error path is what the panel
   *        already renders. `UNPROCESSABLE_CONTENT` for a thread we reached and
   *        cannot use, which is the same code `scripts.generate` uses for a
   *        paywalled article.
   *
   *        The pasted-text arm does NOT call Reddit: it estimates the text as
   *        given. That is the point of the fallback — it works when the API
   *        does not.
   * WHERE: The Reddit input panel, as the link field settles.
   */
  preview: protectedProcedure({
    requirePermission: permissions.REDDIT_STORIES_READ,
  })
    .input(previewRedditThreadSchema)
    .query(async ({ input }) => {
      if (input.source.kind === "text") {
        const estimatedSeconds = estimateSpokenSeconds(input.source.value);
        return {
          kind: "text" as const,
          title: null,
          subreddit: null,
          author: null,
          commentCount: 0,
          characters: input.source.value.length,
          estimatedSeconds,
          overLimit: estimatedSeconds > SCRIPT_WARN_SECONDS,
          warnAtSeconds: SCRIPT_WARN_SECONDS,
        };
      }

      /* URL_IS_VALIDATED_TWICE — the free half, before any request. */
      const parsed = parseRedditThreadUrl(input.source.value);
      if (!parsed.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: redditUrlRefusalMessage(parsed.refusal),
        });
      }

      const reddit = await getRedditAdapter();
      try {
        const thread = await reddit.fetchThread(parsed.canonical);
        const pacing = estimateThreadSeconds(thread);

        return {
          kind: "reddit" as const,
          title: thread.title,
          subreddit: thread.subreddit,
          /* AUTHOR_IS_DISPLAY_ONLY — shown so the customer can confirm they
           * have the right thread, never synthesised. */
          author: thread.author,
          commentCount: thread.comments.length,
          characters: pacing.characters,
          estimatedSeconds: pacing.estimatedSeconds,
          overLimit: pacing.overLimit,
          warnAtSeconds: pacing.warnAtSeconds,
        };
      } catch (error) {
        if (error instanceof RedditError) {
          console.warn(`[redditStories.preview] ${error.detail}`);
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            /* FIVE_FAILURES_NOT_ONE — its own sentence, naming the action. */
            message: redditErrorMessage(error.reason),
          });
        }
        throw error;
      }
    }),

  /**
   * SOURCE OF TRUTH KEYWORDS: redditStories.start, REFUSE_BEFORE_PAYING,
   *   SNAPSHOT_IS_WHAT_THE_CARD_SHOWS, ONE_WORKFLOW_MANY_WRITERS
   *
   * WHAT:  Fetches the thread, records it on the project, and queues the
   *        condensation.
   *
   * WHY:   It is the Reddit twin of `scripts.generate` and does the same four
   *        things in the same order, deliberately: refuse for free, extract the
   *        source, write it to the project, enqueue. Keeping the shape
   *        identical is what lets the EXISTING script workflow serve both — the
   *        hold, the retry classification, the refund on every path and the one
   *        transaction that saves and charges are all Phase 06's, unchanged.
   *
   *        What it adds is the SNAPSHOT. `settings.reddit` keeps the title, the
   *        subreddit and the poster's name because the title card needs them at
   *        RENDER time, long after the fetch — and re-fetching to draw a card
   *        would make a render depend on a post still existing. The structured
   *        thread goes on `settings.script.thread` for the speaker split.
   *
   *        It does NOT accept a project of the wrong kind. A `voiceover`
   *        project handed a thread would get a Reddit script with no card and
   *        one voice, because the generator and the writer are both chosen from
   *        `Project.kind` — so the refusal is here rather than a surprise two
   *        stages later.
   * WHERE: The Reddit input panel's start button.
   */
  start: protectedProcedure({
    requirePermission: permissions.REDDIT_STORIES_CREATE,
    audit: { action: "start" },
    /* A Reddit fetch plus a settings write. The default ten seconds is tight
     * for a thread with a slow response. */
    txTimeout: 30_000,
  })
    .input(startRedditStorySchema)
    .mutation(async ({ ctx, input }) => {
      const project = await findProjectForOrganization(
        ctx.db,
        input.organizationId,
        input.projectId,
      );
      if (project === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      if (project.kind !== "reddit-story") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That project is not a Reddit story. Create a Reddit story project to use a thread.",
        });
      }

      /* REFUSE_BEFORE_PAYING — before the fetch, so a workspace with no
       * credits is not made to wait for a download it cannot use. The same
       * estimator the hold and the commit use. */
      const cost = estimate({
        kind: "script",
        durationSeconds: input.targetSeconds,
      });
      const available = await getBalance(input.organizationId, ctx.db);
      if (available < cost.total) {
        throw createStructuredError(
          "FORBIDDEN",
          `Making this video costs ${cost.total} credits and this workspace has ${available}.`,
          {
            errorCode: ERROR_CODES.INSUFFICIENT_CREDITS,
            resource: "credits",
            required: cost.total,
            available,
            message: `Not enough credits. ${cost.total} needed, ${available} available.`,
          },
        );
      }

      /* URL_IS_VALIDATED_TWICE — refused for free before a request. */
      if (input.source.kind === "url") {
        const parsed = parseRedditThreadUrl(input.source.value);
        if (!parsed.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: redditUrlRefusalMessage(parsed.refusal),
          });
        }
      }

      /* ONE EXTRACTION ENTRY POINT. The `reddit` arm calls the adapter and
       * returns the flattened prose plus the structured thread; the `text` arm
       * is the paste fallback and is the same function
       * (EVERY_FAILURE_OFFERS_THE_FALLBACK). */
      let extracted;
      try {
        extracted = await extractSource(
          input.source.kind === "url"
            ? { kind: "reddit", value: input.source.value }
            : { kind: "text", value: input.source.value },
        );
      } catch (error) {
        if (error instanceof SourceExtractionError) {
          console.warn(`[redditStories.start] ${error.detail}`);
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: error.message,
          });
        }
        throw error;
      }

      const existing = jsonObjectSchema.safeParse(project.settings);
      const bag = existing.success ? existing.data : {};
      const thread = extracted.thread;

      await ctx.db.project.update({
        where: { id: project.id },
        data: {
          sourceRef: extracted.finalUrl ?? input.source.value,
          settings: jsonObjectSchema.parse({
            ...bag,
            /* SETTINGS_ARE_MERGED — only the two keys this write owns. */
            script: {
              sourceKind: extracted.kind,
              sourceTitle: extracted.title ?? null,
              truncated: extracted.truncated,
              targetSeconds: input.targetSeconds,
              /* The tone is not a Reddit choice: KEEP_THE_ORIGINAL_VOICE means
               * the thread's own voice is the tone, and the condensation prompt
               * takes no tone at all. `casual` is stored because the stored
               * request schema the pipeline re-reads requires one. */
              tone: "casual",
              sourceText: extracted.text,
              condense: input.condense ?? true,
              ...(thread === undefined ? {} : { thread }),
            },
            /* SNAPSHOT_IS_WHAT_THE_CARD_SHOWS — the smallest set that draws
             * the title card, and the clock the retention sweep reads. */
            ...(thread === undefined
              ? {}
              : {
                  reddit: {
                    url: thread.permalink,
                    title: thread.title,
                    subreddit: thread.subreddit,
                    author: thread.author,
                    commentCount: thread.comments.length,
                    fetchedAt: new Date().toISOString(),
                  },
                }),
          }),
        },
      });

      /* The condensation goes to the EXISTING script workflow, which resolves
       * the writer from the project's kind. Keyed on the project and the
       * request's shape, so a double-click produces one run while a genuine
       * second attempt with a different thread produces another. */
      await enqueue({
        requestId: ctx.requestId,
        name: "script/requested",
        data: {
          projectId: project.id,
          organizationId: input.organizationId,
          targetSeconds: input.targetSeconds,
          tone: "casual",
        },
        id: `script-${project.id}-reddit-${extracted.text.length}-${input.condense === false ? "full" : "condensed"}`,
      });

      return {
        queued: true,
        cost,
        thread:
          thread === undefined
            ? null
            : {
                title: thread.title,
                subreddit: thread.subreddit,
                commentCount: thread.comments.length,
              },
        source: {
          kind: extracted.kind,
          truncated: extracted.truncated,
          characters: extracted.text.length,
        },
      };
    }),
});
