<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Phase 12 — the Reddit story format

Every phase before this one built a capability. This one builds the **first
complete format**: a Reddit thread becomes a narrated video with a title card,
several voices, a character on screen for each of them, captions and a looping
background.

Read this before Phases 13 and 14. Both add a format, and the two extension
points below (`SCRIPT_WRITERS` and the existing `GENERATORS`) are where they
plug in — neither phase should need to touch a workflow.

## The one-sentence version

A Reddit story is **the existing pipeline with two registry entries**: a
`SCRIPT_WRITERS` entry that condenses a thread into speaker-tagged blocks, and a
`GENERATORS` entry that assembles them into a document with a card and avatars.
There is **no Reddit-specific workflow** — the script workflow resolves the
writer from `Project.kind`, and everything it already did (the credit hold, the
retry classification, the refund on every path, the one transaction that saves
and charges) serves this format unchanged.

## Where the code lives

| Path | Contains | Reaches a provider? |
| --- | --- | --- |
| `src/lib/adapters/reddit/url.ts` | the host allowlist and the post-id parser | **no** — pure |
| `src/lib/adapters/reddit/types.ts` | `RedditAdapter`, the five failures | **no** — pure |
| `src/lib/adapters/reddit/official/` | the OAuth app and the API calls | Reddit |
| `src/lib/types/reddit.ts` | the refusal copy, the roles, the retention window | **no** — pure |
| `src/lib/types/avatar.ts` | the three states, the artwork set, the manifest | **no** — pure |
| `src/lib/script/reddit-prompt.ts` | the fence, the role labels, the restated boundary | **no** — pure |
| `src/lib/script/condense.ts` | the model call and the free duration estimate | the LLM seam |
| `src/lib/script/writers.ts` | **`SCRIPT_WRITERS` — the new extension point** | no |
| `src/lib/generators/common.ts` | what every format shares | **no** — pure |
| `src/lib/generators/reddit-story.ts` | the card and the avatars | **no** — pure |
| `src/lib/generators/avatar-windows.ts` | the flicker maths | **no** — pure |
| `src/lib/captions/speakers.ts` | the per-speaker tint and its name tag | **no** — pure |
| `src/remotion/components/reddit-card.tsx` | the title scene | no |
| `src/remotion/components/avatar-overlay.tsx` | the character | no |
| `src/services/avatars.service.ts` | the `avatar` table and the assignment | no |
| `src/trpc/routers/reddit.ts` | `preview` (free) and `start` | via the adapter |
| `src/inngest/functions/reddit-retention.ts` | the daily expiry sweep | no |

## The seven decisions worth knowing

### 1. Five failures, not one — and every one of them offers the fallback

A thread can be unavailable for five distinct reasons and **four of them are
things the customer can act on**: deleted means pick another, removed means the
same, private means they cannot use it at all, quarantined means we will not,
and a 404 is usually a typo. The fifth, `rate_limited`, is ours and says so
honestly rather than implying they did something wrong.

Collapsing those into "could not fetch thread" turns four actionable situations
into one dead end. So the adapter returns a **closed union** and the copy lives
in `lib/types` — written as a full `Record`, so a new reason is a compile error
rather than a case that falls through. Grep `FIVE_FAILURES_NOT_ONE` and
`EVERY_FAILURE_OFFERS_THE_FALLBACK`.

**Reddit does not answer 404 for a deleted post.** It answers 200 with a listing
whose author is `[deleted]` or whose selftext is `[removed]`, and a naive client
makes a video out of the word "removed". The five cases are read from three
places — the status code, the API's own `reason` field, and the post's
sentinels. Grep `DELETED_IS_NOT_MISSING`.

### 2. A query parameter is not a host

The phase says it in one line: "a URL that merely contains 'reddit' in a query
parameter is not a Reddit URL". Every obvious implementation is wrong in the
same way — `includes('reddit.com')` matches `https://evil.example/?next=reddit.com`,
`endsWith` matches `notreddit.com`, a prefix check matches
`reddit.com.evil.example`. So the **hostname** is compared against a fixed list
of exact strings and nothing else is consulted.

This is a **separate check from the SSRF guard**, and both have to hold: this one
asks "is this the service we meant to call", `assertFetchableUrl` asks "is this
address one our server may reach". Note that on this path the SSRF question does
not arise at all — nothing customer-supplied becomes a URL we fetch. The only
thing taken from the input is a base-36 post id, validated against a character
class, and the host is ours. Grep `HOST_IS_AN_ALLOWLIST`,
`A_QUERY_PARAM_IS_NOT_A_HOST` and `POST_ID_IS_BASE36`.

**Share links are refused by name.** `/r/<sub>/s/<code>` carries no post id, and
resolving one means following a redirect to find out what the customer meant —
a new attack surface for a convenience. "Open it and copy the address bar" is a
two-second fix. Grep `SHARE_LINKS_ARE_REFUSED`.

### 3. Prompt injection: four properties, and the schema underneath them

This is the path the phase means when it says the defence "gets genuinely
attacked". Every other source is at least chosen by the customer — they picked
the article, they wrote the text. A thread is written by strangers, any of whom
can post "ignore previous instructions", and the customer has no idea it is
there.

Phase 06 built the defence; this phase **uses** it and adds one thing. Four
properties, each with a test:

1. **`condenseSystemPrompt()` takes no arguments.** Not the title, not the
   subreddit, not a tone. There is no parameter through which thread text could
   reach the operator channel, which is the strongest available form of
   `UNTRUSTED_TEXT_IS_NEVER_SYSTEM`.
2. **The delimiter is stripped**, in any case, so a comment writing the closing
   marker cannot end the fence early.
3. **The task is restated after the fence.** On a long thread the system prompt
   is thousands of tokens away and the hostile text is adjacent to the answer,
   so the last thing the model reads has to be ours. Grep
   `TASK_IS_RESTATED_AFTER`.
4. **Usernames never reach the model.** The flattened thread labels participants
   by role — "Original poster", "Reply 1" — and drops every handle. A username
   is text its owner chose, so `u/Ignore_previous_instructions` would otherwise
   be a heading the model reads. Grep `USERNAMES_NEVER_REACH_THE_MODEL`.

None of this is a guarantee. **The schema is what holds**: `redditDraftSchema`
constrains the answer to a title and blocks whose `speaker` is one of three
literals, so a model talked into anything still cannot return anything but a
script. The committed test fixture puts an attack in every field — title, body,
subreddit, each comment, each username — and asserts all four properties plus
the schema's refusals.

The test deliberately **does not call a model**. One that asked Claude whether it
had been injected would cost money per run, be non-deterministic, and prove
nothing about the next model version. What is testable is the prompt this code
builds.

### 4. One workflow, many writers

`GENERATORS` decides how a kind becomes a timeline **document**. `SCRIPT_WRITERS`
— new here — decides how a kind becomes a **script**. Phase 09 built the first
and left the second hard-coded, because there was one format.

Before this registry, `script-generate` would have needed
`if (kind === 'reddit-story')` to pick a different path, and the generator
registry's own header says what that costs: "the moment a kind name appears
inside `project-generate.ts`, that property is gone and every later format pays
for it". Now the workflow resolves the writer from the project's kind and is
otherwise unchanged. Grep `ONE_WORKFLOW_MANY_WRITERS` and
`THE_OTHER_EXTENSION_POINT`.

`WrittenScript` is the shared return shape, and `speakerTag` on a block is the
only thing Phase 12 added to it — **optional**, because a voiceover script has
no cast and `splitScriptIntoLines` already defaults an absent tag to `narrator`.

### 5. Everything a format shares now lives in one place

A Reddit story and a voiceover differ in exactly two ways — a title card and
avatar overlays — and are identical in five: the narration lane, the background
(footage or backdrop), the music bed, the cast record and the settings read.
Those five moved to `src/lib/generators/common.ts`.

Not for tidiness. Two copies of "a background shorter than the narration loops,
and one with no measured duration does not" is two places for it to stop being
true, and the second copy is always the one that is wrong. Grep
`COMPOSED_FROM_COMMON` and `SHARED_BY_EVERY_FORMAT`.

### 6. The avatar maths is in the generator, and it had to be

A render component receives `item`, `assets`, `frames` and `canvas` and **not the
document** (`RENDER_COMPONENT_CONTRACT`), so `AvatarOverlay` cannot read
`doc.words` and could not derive a talking state if it wanted to. The windows
and the state spans are therefore computed in the generator and the component
looks up the frame it is on. That is also the right place: a frame must be a
pure function of its number for Phase 04's render reuse to be correct.

**The flicker rule works at two levels, and which level does what is the part
worth understanding:**

- A **window** breaks on the **speaker and only the speaker**. A pause does not
  break it — a character leaving the screen mid-thought and returning is a
  bigger switch than the flicker the rule was written to prevent. A pause inside
  a window becomes a `neutral` stretch: the character standing there, not
  talking.
- **Inside** a window, a gap shorter than `AVATAR_FLICKER_MS` (180ms) is absorbed
  into the talking around it rather than becoming a sub-200ms flash. This is
  where the threshold earns its keep.
- A window shorter than the threshold is **dropped, and then the neighbours are
  re-merged**. Dropping alone would leave a hole where the surrounding
  character blinked off and back on — the same flicker wearing a different hat.
  Grep `DROP_THEN_REMERGE`.

**Talking is per LINE, not per word**, and that is a deliberate reading of the
phase at a coarser grain than it is written. Word timings are available — aligned
words carry a speaker — and using them directly would shut the mouth on every
comma, which is exactly the sub-200ms flip the same phase forbids two sentences
later. A line is the measured unit of audio. Grep
`TALKING_IS_PER_LINE_NOT_PER_WORD`.

**`reaction` has no beat marker, so the rule is the entrance.** The phase asks
for it to "play on marked beats" and nothing in the document marks a beat;
inventing one would be a document concept with one consumer and no author. The
rule chosen needs no new concept and is what these videos actually look like: a
character reacts for a moment as it arrives, then speaks. Grep
`REACTION_IS_THE_ENTRANCE`.

### 7. Colour is never the only signal

Per-speaker caption colouring returns a colour **and** a name tag from one
function, so there is no way to use the tint without the tag. The phase requires
the pairing, and the reason is not decoration: roughly one man in twelve cannot
reliably distinguish two tinted captions, and for them colour alone carries no
attribution at all. Returning them separately would make "colour only" a
one-line shortcut somebody takes under deadline.

The colour is **derived from the speaker tag**, not stored — so the same speaker
is the same colour in every video, re-generating cannot reshuffle them, and
there is no new document field to contradict. `narrator` is pinned to plain
white, because it is the voice in most of every video and tinting it would
colour most captions in the product for no informational gain. Every tint is
held to the same contrast threshold Phase 08 applies to the caption library.
Grep `COLOUR_IS_NEVER_THE_ONLY_SIGNAL`, `COLOUR_IS_DERIVED_NOT_STORED` and
`NARRATOR_IS_ALWAYS_WHITE`.

## Retention: what expires is the cached source

The phase's step 12 says outputs "expire after the configured window; show the
expiry date on the project page rather than deleting silently". It is implemented
as narrowly as it can honestly be read, and the narrowing is a decision rather
than a shortcut:

**The sweep removes our copy of somebody else's thread** — the flattened source
text, the structured thread and the snapshot. It does **not** touch the script,
the narration audio, the timeline or any render.

Those are the customer's own derived work and they **spent credits** on them.
Deleting a finished video on a schedule would be taking back something they paid
for, and this app's privacy copy promises the opposite. If the owner wants the
outputs themselves to expire, that is a separate decision with legal copy and a
customer notification attached — not a side effect of a retention cron. Grep
`WHAT_EXPIRES_IS_THE_CACHED_SOURCE` and `NEVER_DELETE_THE_CUSTOMERS_WORK`.

The window is **derived** (`createdAt` + `REDDIT_RETENTION_DAYS`) rather than
stored, so changing it changes every project at once instead of leaving old rows
on the old window. The date is on the project screen from the moment the project
exists, not once it is nearly due — and the sweep logs its verdict every day,
including the quiet ones, because a check that only speaks when it acts has a
silence nobody can tell from a broken cron.

A project whose thread has been swept still **renders**: the generator emits no
card and the story is otherwise unchanged. That is what makes the sweep
survivable.

## Two manifests, both empty, for two different reasons

They look alike and they are not.

**Backgrounds** (Phase 11) are empty because a licensing **position** has to be
settled by the owner. **Avatars** are empty because the **artwork does not
exist**: the phase requires original illustrated characters, three drawn frames
each, and nobody has drawn them. There is no honest way for code to produce
them, and a row pointing at artwork that is not there would fail its ingest and
sit `failed` in the catalogue forever.

What the avatar manifest enforces in the meantime is the part that matters. **No
real-person likenesses and no third-party characters, ever** — the phase states
it as a legal position because a likeness-rights claim is not a bug you can
patch. No schema can look at a PNG and tell whose face it is, so every row must
carry a written `provenance` statement and the schema refuses the words people
type when they have not checked. The real review is a person reading the diff;
this stops a row existing without anyone having written down what they verified.
Grep `LIKENESS_IS_ATTESTED`.

Avatar artwork is **not a special path**: it goes through the Phase 11 library
pipeline as `kind: 'avatar'` entries in the background manifest, lands in
`library/avatars/…`, and the avatar sync then resolves those manifest keys to
Asset ids. Two syncs, in that order, because the second needs the ids the first
mints. Grep `ARTWORK_MUST_EXIST_FIRST`.

## The free preview, and why it is two clicks

The customer must see the final duration and the over-60-seconds warning
**before** anything is generated, and that is not knowable from a URL. So
`redditStories.preview` fetches, estimates with the same `estimateSpokenSeconds`
the script pacing uses, and writes nothing. No credits.

It is a **deliberate second click** rather than a debounced lookup as you type.
Every lookup is a request against Reddit's API under our shared credentials, so
a debounce would spend that budget on half-typed links — and the resource's own
rate limit would start refusing the customer who is typing carefully. Grep
`DURATION_BEFORE_GENERATION` and `THEIR_RATE_LIMIT_NOT_OURS`.

The link is validated **locally first**, with the same pure parser the server
uses, so "that is a share link, open it and copy the address bar" appears with
no request at all. That is the whole reason the parser is credential-free.

## Two things that look odd and are not

**`redditStories` is a flag that is true on every plan.** It is not an upsell —
a Reddit story costs the same credits as any other video. It is a **kill switch**.
This is the one feature that depends on a third party's API terms, and if Reddit
changes them or suspends the app, the operator needs to turn the format off for
everybody in one edit without a deploy. Flipping those booleans makes the
factory's flag gate refuse every verb, reads included. Grep `A_FLAG_NOT_A_LIMIT`.

**`Avatar.assetSet` is one jsonb column, not three.** Three nullable columns
would be the same data with a worse property: a row could exist with `talking`
set and `neutral` null, which is a character that cannot be drawn at rest and
the renderer would discover it mid-video. One value parsed as a whole is either a
complete set or it is refused. Grep `A_SET_IS_COMPLETE_OR_REFUSED`.

## What is NOT in this phase

- **Custom user-uploaded characters, lip sync and full-body animation** — the
  phase excludes all three.
- **A character picker in the UI.** `avatars.list` and `avatars.assign` exist and
  are gated, but nothing on the cast screen calls them, because the catalogue is
  empty until the artwork is commissioned — a picker would be a grid with
  nothing in it. The pipeline already reads `Speaker.avatarId`, so the format
  works the moment a character exists and a row points at it.
- **A portal console for either sync.** `avatars.sync` and
  `backgroundLibrary.sync` have no screen, the same state `voices.sync` has been
  in since Phase 07.
- **A music picker** — still Phase 11's outstanding item, and the music licence
  category is still unresolved in the generator (grep
  `MUSIC_LICENCE_IS_NOT_RESOLVED_YET`).
