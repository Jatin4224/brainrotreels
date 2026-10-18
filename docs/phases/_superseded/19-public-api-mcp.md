# Phase 19: Public REST API and MCP server

**Feature:** Feature 10
**Depends on:** phases 10 and 11

## Goal

Developers and AI agents can do everything the web app does, under the same quotas and plan gates.

## Build

- API keys: create/revoke UI, stored hashed with a visible prefix, `last_used_at`.
- `/api/v1` with `Authorization: Bearer <key>`: `POST /projects`, `POST /scripts`, `POST /projects/:id/voices`, `POST /renders`, `GET /renders/:id`, `GET /outputs/:id`, `GET /catalog/{voices,backgrounds,caption-styles}`.
- Shared handlers: REST, MCP and the internal API call the same domain functions.
- Standard codes, JSON errors with `code` and `message`, `requestId` on every response, `Idempotency-Key` on POSTs, cursor pagination.
- Per-key daily quota in Redis; concurrency and quotas are shared per USER across web, REST and MCP so one surface cannot starve another.
- `/api/mcp` server with tools `create_project`, `generate_script`, `assign_voices`, `list_backgrounds`, `start_render`, `get_render`, `fetch_output`; results are structured JSON plus a short summary.
- OpenAPI document and a docs page.

## Data

- `api_keys` (id, user_id, prefix, hash, daily_quota, last_used_at).

## Done when

- [ ] A script using only an API key creates a project, generates a script, assigns voices, renders and downloads the MP4.
- [ ] The same flow works from an MCP client.
- [ ] Repeating a POST with the same Idempotency-Key does not create a second render.
- [ ] Exceeding the daily quota returns 429.
- [ ] A plan without API access gets a clear 403-style error.

## Not in this phase

- New video features.
