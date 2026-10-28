/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: REDDIT_ERROR_COPY, redditErrorMessage,
 *   REDDIT_URL_REFUSAL_COPY, redditUrlRefusalMessage, REDDIT_SPEAKER_TAGS,
 *   redditSpeakerTagSchema, RedditSpeakerTag, redditDraftSchema,
 *   redditBlockDraftSchema, REDDIT_RETENTION_DAYS, redditExpiresAt,
 *   redditThreadSnapshotSchema, condenseSettingsSchema, startRedditStorySchema,
 *   previewRedditThreadSchema, EVERY_FAILURE_OFFERS_THE_FALLBACK,
 *   TAGS_ARE_ROLES_NOT_USERNAMES
 *
 * WHAT:  The vocabulary of a Reddit story — the five failure messages, the
 *        three speaker roles, the shape the MODEL must return when it condenses
 *        a thread, the retention window, and the input schema of every
 *        `redditStories.*` procedure.
 *
 * WHY:   EVERY_FAILURE_OFFERS_THE_FALLBACK, which is the phase's step 2 turned
 *        into data. Five of the failures are things a customer can act on, so
 *        each gets its OWN sentence naming the action — and every one of them
 *        ends by pointing at pasting the text, because that path always works
 *        and they have the thread in front of them. Written as a full `Record`
 *        over the union, so a new failure reason is a compile error here rather
 *        than a case that falls through to "something went wrong".
 *
 *        The copy lives here and not in the adapter deliberately: the adapter
 *        returns a REASON (a closed union), and a provider inventing
 *        customer-facing sentences is how two surfaces end up explaining the
 *        same failure differently. The same split as the moderation seam.
 *
 *        TAGS_ARE_ROLES_NOT_USERNAMES. A speaker tag is `narrator`, `op` or
 *        `commenter`, never a Reddit username — the adapter's
 *        AUTHOR_IS_DISPLAY_ONLY says why that matters, and there is a second
 *        reason here: tags become `Speaker` rows that a customer assigns voices
 *        to, and a cast that changed its member names every time a different
 *        thread was used would make voice assignment meaningless. Three roles
 *        cover every thread; a fourth would need a voice of its own.
 * WHERE: src/lib/script/reddit-prompt.ts, src/lib/script/condense.ts,
 *        src/trpc/routers/reddit.ts and the Reddit input panel.
 *        Re-exported from src/lib/types.
 */

import { z } from "zod";

import type { RedditFetchError } from "@/lib/adapters/reddit/types";
import type { RedditUrlRefusal } from "@/lib/adapters/reddit/url";
import { SCRIPT_BLOCK_MAX_CHARS, SCRIPT_BLOCK_MIN_CHARS } from "./script";

/**
 * SOURCE OF TRUTH KEYWORDS: REDDIT_ERROR_COPY, redditErrorMessage,
 *   EVERY_FAILURE_OFFERS_THE_FALLBACK
 *
 * WHAT:  What to tell somebody for each way a thread can be unusable.
 * WHY:   See the file header. Four of these name an action the customer can
 *        take; the fifth (`rate_limited`) is ours and says so honestly rather
 *        than implying they did something wrong — telling a customer to "try a
 *        different thread" when the problem is our own API budget sends them
 *        to try four more and fail four more times.
 * WHERE: The scripts/reddit router's refusals and the input panel.
 */
export const REDDIT_ERROR_COPY: Readonly<Record<RedditFetchError, string>> = {
  deleted:
    "The person who posted that thread deleted it, so there is nothing left to read. Pick another thread, or paste the text you saved.",
  removed:
    "That thread was removed by the subreddit's moderators. Pick another thread, or paste the text if you still have it.",
  private:
    "That subreddit is private, so we cannot read it. Pick a thread from a public subreddit, or paste the text instead.",
  quarantined:
    "That subreddit is quarantined, and we do not make videos from quarantined communities. Pick another thread, or paste your own text.",
  not_found:
    "We could not find that thread — the link may be mistyped or the post may be gone. Check the link, or paste the text instead.",
  rate_limited:
    "We are reading more threads than Reddit currently allows, so this one has to wait. Try again in a few minutes, or paste the text to carry on now.",
  unavailable:
    "Reddit could not be reached just now. Try again shortly, or paste the thread text instead.",
};

export function redditErrorMessage(reason: RedditFetchError): string {
  return REDDIT_ERROR_COPY[reason];
}

/**
 * SOURCE OF TRUTH KEYWORDS: REDDIT_URL_REFUSAL_COPY, redditUrlRefusalMessage
 *
 * WHAT:  What to tell somebody whose link is not a thread link.
 * WHY:   These are caught BEFORE any request, in the form, which is the whole
 *        reason they are separate from the fetch failures above: a refusal that
 *        costs nothing can be shown as you type. Each names the fix — and
 *        `share_link` names the exact one, because "copy the full link instead
 *        of the share link" is a two-second action and "invalid URL" is a dead
 *        end.
 * WHERE: `redditStories.preview`, and the field's live validation.
 */
export const REDDIT_URL_REFUSAL_COPY: Readonly<
  Record<RedditUrlRefusal, string>
> = {
  unparseable: "That does not look like a web address.",
  wrong_scheme: "Reddit links must start with https://.",
  not_reddit:
    "That is not a Reddit link. Paste a link to a Reddit thread, or paste the text instead.",
  share_link:
    "That is a Reddit share link, which does not name the thread. Open it, then copy the link from your browser's address bar.",
  no_post_id:
    "That link points at Reddit but not at a single thread. Open the thread itself and copy its link.",
};

export function redditUrlRefusalMessage(refusal: RedditUrlRefusal): string {
  /* A full Record over the union, so this cannot miss — the index signature is
   * what noUncheckedIndexedAccess widens, not the data. */
  return REDDIT_URL_REFUSAL_COPY[refusal] ?? REDDIT_URL_REFUSAL_COPY.unparseable;
}

/**
 * SOURCE OF TRUTH KEYWORDS: REDDIT_SPEAKER_TAGS, redditSpeakerTagSchema,
 *   RedditSpeakerTag, TAGS_ARE_ROLES_NOT_USERNAMES
 *
 * WHAT:  Who speaks in a Reddit story.
 * WHY:   See TAGS_ARE_ROLES_NOT_USERNAMES in the file header. Three roles, and
 *        the reason there are exactly three is that each one needs its own
 *        VOICE and its own AVATAR: the narrator frames the story, the original
 *        poster tells it, and the comments answer. A fourth role would be a
 *        fourth cast member for a thread that may not have one, and
 *        `validateAssignments` refuses to generate until every speaker has a
 *        voice — so an invented role is a video that cannot be made.
 *
 *        `narrator` is FIRST and is the default
 *        (`splitScriptIntoLines`'s own default tag), so a single-voice thread
 *        casts exactly one speaker and nothing changes for the simple case.
 * WHERE: The condensation schema; the Speaker rows the pipeline upserts.
 */
export const REDDIT_SPEAKER_TAGS = ["narrator", "op", "commenter"] as const;

export const redditSpeakerTagSchema = z.enum(REDDIT_SPEAKER_TAGS);

export type RedditSpeakerTag = z.infer<typeof redditSpeakerTagSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: REDDIT_SPEAKER_LABELS
 *
 * WHAT:  What each role is called on screen and in a caption name tag.
 * WHY:   A full Record so a new role cannot ship without a label — a caption
 *        tag reading "commenter" in lower case next to one reading "OP" is the
 *        kind of detail that makes a generated video look generated. Kept
 *        beside the tuple for the same reason PIPELINE_STAGE_LABELS is.
 * WHERE: The caption name tag (COLOUR_IS_NEVER_THE_ONLY_SIGNAL) and the voice
 *        assignment panel.
 */
export const REDDIT_SPEAKER_LABELS: Readonly<Record<RedditSpeakerTag, string>> =
  {
    narrator: "Narrator",
    op: "OP",
    commenter: "Reply",
  };

/**
 * SOURCE OF TRUTH KEYWORDS: redditBlockDraftSchema, redditDraftSchema,
 *   MODEL_OUTPUT_SCHEMA, SPEAKER_IS_THE_ONLY_ADDITION
 *
 * WHAT:  What a model returns when it condenses a thread.
 *
 * WHY:   SPEAKER_IS_THE_ONLY_ADDITION. This is `scriptDraftSchema` with one
 *        extra field, and it is a SEPARATE schema rather than an optional field
 *        on that one for a reason that matters at the boundary: for a
 *        voiceover script there is no speaker to choose and a model offering
 *        one would be inventing a cast, while for a thread the speaker is
 *        required and a model omitting it would silently narrate a reply in the
 *        poster's voice. Required here, absent there — which an optional field
 *        on a shared schema cannot express.
 *
 *        `speaker` is a closed enum, so the model cannot invent a role and
 *        cannot smuggle a username into a field that becomes a `Speaker` row.
 *        That is also the injection-relevant part: every value that leaves this
 *        schema and reaches the database is from a fixed set.
 *
 *        Everything else is inherited deliberately — no `position` (order is
 *        the array's), no id, no duration. See MODEL_OUTPUT_SCHEMA in
 *        ./script for the full argument.
 * WHERE: Passed as `schema` to the LLM adapter by src/lib/script/condense.ts.
 */
export const redditBlockDraftSchema = z
  .object({
    sectionType: z.enum(["hook", "body", "cta"]),
    speaker: redditSpeakerTagSchema,
    narrationText: z
      .string()
      .min(SCRIPT_BLOCK_MIN_CHARS)
      .max(SCRIPT_BLOCK_MAX_CHARS),
  })
  .strict();

export type RedditBlockDraft = z.infer<typeof redditBlockDraftSchema>;

/** The same cap as a script: an unbounded array is unbounded rows per request. */
export const REDDIT_MAX_BLOCKS = 40;

export const redditDraftSchema = z
  .object({
    title: z.string().min(1).max(200),
    blocks: z.array(redditBlockDraftSchema).min(1).max(REDDIT_MAX_BLOCKS),
  })
  .strict();

export type RedditDraft = z.infer<typeof redditDraftSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: redditThreadSnapshotSchema, RedditThreadSnapshot,
 *   SNAPSHOT_IS_WHAT_THE_CARD_SHOWS
 *
 * WHAT:  The thread facts kept on `Project.settings.reddit`.
 *
 * WHY:   SNAPSHOT_IS_WHAT_THE_CARD_SHOWS. The title card needs the title, the
 *        subreddit and the poster's name at RENDER time, long after the fetch —
 *        and re-fetching the thread to draw a card would make a render depend
 *        on somebody else's uptime and on a post still existing, which is
 *        exactly the dependency a deterministic render must not have.
 *
 *        It is deliberately the SMALLEST set that draws the card. Every extra
 *        field would be one more piece of somebody else's content under a
 *        retention clock (see REDDIT_RETENTION_DAYS), and the comments are NOT
 *        snapshotted at all: they exist in the generated script, which is the
 *        customer's own derived work.
 *
 *        `fetchedAt` is an ISO string rather than a Date because this is jsonb
 *        — a Date round-trips as a string anyway, and typing it as one makes
 *        the parse honest about what comes back.
 * WHERE: Written by `redditStories.start`; read by the generator and by the
 *        retention sweep.
 */
export const redditThreadSnapshotSchema = z
  .object({
    url: z.string().trim().min(1).max(2_000),
    title: z.string().trim().min(1).max(400),
    subreddit: z.string().trim().max(100),
    author: z.string().trim().max(100),
    commentCount: z.number().int().min(0).max(1_000),
    fetchedAt: z.string().min(1).max(40),
  })
  .strict();

export type RedditThreadSnapshot = z.infer<typeof redditThreadSnapshotSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: REDDIT_RETENTION_DAYS, redditExpiresAt,
 *   isRedditExpired, RETENTION_IS_DERIVED_NOT_STORED, SOMEBODY_ELSES_CONTENT
 *
 * WHAT:  How long a project may keep the thread it was made from, and when a
 *        given project's copy expires.
 *
 * WHY:   SOMEBODY_ELSES_CONTENT is the reason there is a clock at all. A
 *        thread's title, body and comments are other people's words, obtained
 *        under an API agreement that does not grant indefinite storage, and the
 *        people who wrote them can delete them. Keeping a copy forever is a
 *        commitment nobody made.
 *
 *        WHAT EXPIRES IS THE CACHED SOURCE, not the customer's video. The
 *        script, the narration, the timeline and any render are the customer's
 *        own derived work and are theirs to keep — deleting those would be
 *        taking back something they spent credits on, which is a different and
 *        much larger product decision. The sweep removes
 *        `settings.script.sourceText` and the thread snapshot; the project is
 *        otherwise untouched, and the only visible consequence is that the
 *        original thread text is no longer shown and a re-condensation needs a
 *        fresh fetch.
 *
 *        RETENTION_IS_DERIVED_NOT_STORED. The expiry is `createdAt` plus the
 *        window, computed wherever it is needed, rather than a column written
 *        at creation. A stored date would be a second source of truth that goes
 *        stale the moment the window is changed — and changing the window is
 *        exactly the thing an operator will do once, deliberately, after
 *        reading their own terms.
 *
 *        Thirty days is a default, not a legal position. It is long enough that
 *        a customer who made a video last month can still see where it came
 *        from, and short enough to be defensible. Grep this symbol before
 *        quoting it anywhere that matters.
 * WHERE: `projects.get`'s reddit block, the script screen's notice, and the
 *        retention sweep in src/inngest/functions/reddit-retention.ts.
 */
export const REDDIT_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function redditExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + REDDIT_RETENTION_DAYS * DAY_MS);
}

export function isRedditExpired(createdAt: Date, now: Date = new Date()): boolean {
  return redditExpiresAt(createdAt).getTime() <= now.getTime();
}

/**
 * SOURCE OF TRUTH KEYWORDS: condenseSettingsSchema, CondenseSettings,
 *   CONDENSE_IS_A_CHOICE
 *
 * WHAT:  The per-project condensation preference, on
 *        `Project.settings.reddit.condense`.
 * WHY:   CONDENSE_IS_A_CHOICE, the phase's step 11 toggle. With it off, a long
 *        thread produces a long video and the warning is the whole of the
 *        product's opinion; with it on, the model is asked to cut to the target
 *        length. It is a preference that steers a RUN, so it lives on the
 *        project alongside the other generate settings rather than in the
 *        document the run produces — the same argument as
 *        GENERATE_SETTINGS_LIVE_ON_THE_PROJECT.
 * WHERE: Written by `redditStories.start`; read by the condenser.
 */
export const condenseSettingsSchema = z.object({
  condense: z.boolean().default(true),
});

export type CondenseSettings = z.infer<typeof condenseSettingsSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: previewRedditThreadSchema, startRedditStorySchema,
 *   DURATION_BEFORE_GENERATION
 *
 * WHAT:  The input contract of the two `redditStories.*` procedures.
 *
 * WHY:   DURATION_BEFORE_GENERATION is the phase's step 5 and the reason
 *        `preview` exists as a separate, FREE read. The customer has to be
 *        shown the final duration and the over-60-seconds warning BEFORE
 *        anything is generated — and that cannot be done from a URL alone,
 *        because the length of a thread is not knowable until it is fetched.
 *        So the preview fetches, estimates from the real text with the SAME
 *        estimator the script uses, and writes nothing. It costs a Reddit
 *        request and no credits, which is why it carries the resource's own
 *        rate limit rather than relying on the global one.
 *
 *        `source` mirrors `scriptSourceSchema`'s discriminated union rather
 *        than being a bare string, for the identical reason: a thread URL and
 *        pasted raw text are validated differently, and one `value: string`
 *        would make the kind a claim rather than a constraint. The paste
 *        fallback is a first-class arm here because EVERY failure above offers
 *        it.
 * WHERE: src/trpc/routers/reddit.ts and the Reddit input panel.
 */
export const REDDIT_RAW_TEXT_MAX_CHARS = 24_000;

export const redditSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    /* Properly checked by parseRedditThreadUrl server-side; this catches the
     * obvious before a request is made. */
    value: z.string().trim().url().max(2_000),
  }),
  z.object({
    kind: z.literal("text"),
    value: z.string().trim().min(1).max(REDDIT_RAW_TEXT_MAX_CHARS),
  }),
]);

export type RedditSource = z.infer<typeof redditSourceSchema>;

export const previewRedditThreadSchema = z.object({
  organizationId: z.string().min(1),
  source: redditSourceSchema,
});

export type PreviewRedditThreadValues = z.infer<
  typeof previewRedditThreadSchema
>;

export const startRedditStorySchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  source: redditSourceSchema,
  condense: z.boolean().optional(),
  /* The same bounds as a script's: below ten seconds there is no room for a
   * hook and a payoff, and above three minutes this is not the product. */
  targetSeconds: z.number().int().min(10).max(180),
});

export type StartRedditStoryValues = z.infer<typeof startRedditStorySchema>;
