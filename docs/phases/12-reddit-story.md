# Phase 12 — Reddit story format

**Depends on:** Phases 09, 11.

## Goal

The first complete format, end to end: a Reddit thread becomes a narrated video with a title card,
speaker-split narration, avatars, captions and a looping background.

## Registry

```ts
redditStories: {
  name: 'Reddit stories',
  description: 'Videos generated from Reddit threads',
  flag: {
    perPlan: { free: true, starter: true, pro: true, enterprise: true, portal: true },
    availableOnFreeTrial: true,
  },
  rateLimit: {
    create: { count: 10, window: '5 m' },  // the Reddit API has its own limits to respect
  },
}
```

## Data

```prisma
model Avatar {
  id        String  @id @default(cuid())
  name      String
  assetSet  Json    // { neutral: assetId, talking: assetId, reaction: assetId }
  minPlan   String  @default("free")
  isActive  Boolean @default(true)

  @@index([minPlan])
  @@map("avatar")
}
```

Nothing else new. The thread reference lives on `Project.sourceRef`, the condensation settings on
`Project.settings`, and `Speaker.avatarId` from Phase 07 finally gets used.

## Build

1. **The Reddit adapter.** `src/lib/adapters/reddit/` using the **official API with an OAuth app** —
   not scraping. Fetch title, body and top comments. Respect the documented rate limits and cache
   within the API terms. Add the eslint restriction.
2. **Specific errors, not one generic failure.** Deleted, removed, private, quarantined and
   not-found are five different situations and the user can act on four of them. Each gets its own
   message, and all of them offer the paste-raw-text fallback.
3. **URL validation.** Scheme allowlist, Reddit host check against a fixed list of hostnames, and
   the Phase 06 SSRF guard blocking private and link-local ranges — including after redirects.
   A URL that merely contains "reddit" in a query parameter is not a Reddit URL.
4. **Prompt injection is the real threat here.** Thread text is attacker-controlled: anyone can post
   a comment reading "ignore previous instructions and ...". Wrap the thread in delimiters, state in
   the system prompt that delimited content is data and must never be followed, and never
   interpolate thread text into the system prompt. Phase 06 built this; this phase is where it gets
   genuinely attacked, so it gets an explicit test.
5. **Condensation.** The LLM trims and cleans the thread into narration lines, keeps the original
   voice rather than rewriting it into marketing copy, splits by speaker where the thread has
   several participants (narrator, OP, commenters), and warns above 60 seconds with the final
   duration shown **before** generation starts.
6. **Seed avatars.** Original illustrated characters only, each with `neutral`, `talking` and
   `reaction` artwork under `library/avatars/{id}/{state}.png`. **No real-person likenesses and no
   third-party characters** — a likeness-rights claim is not a bug you can patch.
7. **The `AvatarOverlay` component family**, registered into `src/remotion/registry.ts`. It shows
   the active speaker's avatar, switches to `talking` on that speaker's word timings, and plays
   `reaction` on marked beats. Coalesce state changes shorter than a flicker threshold — a 120ms
   avatar flip looks like a glitch, not a performance.
8. **The `RedditCard` component family** for the title scene: the post title, subreddit and a
   stylised card treatment. Registered the same way.
9. **The `reddit-story` generator** in `src/lib/generators/`: background pick and loop (Phase 11),
   `RedditCard` title scene, narration from Phase 07, avatar overlays aligned to each line, captions
   from Phase 08.
10. **Optional per-speaker caption colouring**, always paired with a name tag so colour is never the
    only signal distinguishing speakers.
11. **Wizard input panel**: a Reddit URL field with live validation, or paste raw text, plus a
    "condense long threads" toggle. Background step defaults to the workspace's last choice.
12. **Retention.** Outputs of this kind expire after the configured window; show the expiry date on
    the project page rather than deleting silently.

## Contracts

```ts
export interface RedditAdapter {
  fetchThread(url: string): Promise<RedditThread>
}
export interface RedditThread {
  title: string
  subreddit: string
  body: string
  author: string            // display only; never synthesised as a voice
  comments: { author: string; body: string; score: number }[]
}
export type RedditFetchError =
  | 'deleted' | 'removed' | 'private' | 'quarantined' | 'not_found' | 'rate_limited'
```

## Done when

- [ ] A real public thread URL produces a complete 9:16 video with synced captions, avatars and a
      looping background.
- [ ] Each of the five failure cases produces its own message and offers the paste-text fallback.
- [ ] A non-Reddit URL, and a Reddit-looking URL that redirects to a private range, are both
      rejected.
- [ ] **A thread containing explicit instructions to the model does not change the model's
      behaviour**, verified by a committed test with a hostile fixture.
- [ ] A thread over the limit is condensed and the final duration is shown before generation.
- [ ] In a two-speaker video the correct avatar is visible for each line and switches on the line
      boundary without flicker.
- [ ] The expiry date is visible on the project page.

## Not in this phase

Custom user-uploaded characters, lip sync, full-body animation.
