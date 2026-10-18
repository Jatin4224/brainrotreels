# Phase 09: Reddit story generator

**Feature:** Feature 5
**Depends on:** phases 06, 07 and 08

## Goal

Pasting a Reddit link produces a complete story video: condensed narration, gameplay background, avatars and captions.

## Build

- Reddit adapter using the official API with an OAuth app; respect rate limits; cache within the API terms.
- URL validation (only reddit hosts) and clear errors for deleted, private or removed threads; fallback: let the user paste the raw text.
- LLM condensation into a script, split into lines by speaker (narrator, OP, commenters).
- `reddit-story` generator: background pick + loop, `RedditCard` title scene, avatar overlays, narration, captions.
- `RedditCard` component family in the renderer.
- Wizard UI: paste link -> review script -> pick voices and background -> generate.
- Warn when the estimated length is over about 60 seconds.
- Retention rule for outputs (for example 7 days) as a lifecycle setting.

## Data

- Uses `projects.source_ref` for the thread reference; no new tables.

## Done when

- [ ] A public thread link produces a previewable and renderable story video.
- [ ] A deleted thread shows the paste-text fallback.
- [ ] A non-Reddit URL is rejected.
- [ ] Thread text containing instructions to the model does not change the model's behaviour (prompt-injection test).

## Not in this phase

- Scraping without the API.
