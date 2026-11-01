/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: reference.test, buildApiReference, mcpClientConfigs,
 *   THE_PAGE_IS_THE_DOCUMENT, NOTHING_IS_HAND_LISTED_TWICE,
 *   A_CLIENT_NEEDS_ITS_OWN_BLOCK
 *
 * WHAT:  That the reference page's data genuinely comes from the OpenAPI
 *        document, and that each agent client's config block is complete.
 *
 * WHY:   THE_PAGE_IS_THE_DOCUMENT is a promise that is easy to make and easy
 *        to quietly break — somebody adds an endpoint to the document and
 *        hand-writes a card for it, or the flattening drops a parameter and
 *        the page simply shows one fewer row. Neither fails anything at
 *        runtime. So the assertions here are about COVERAGE: every path in the
 *        document appears, every required body field appears, and the error
 *        vocabulary is the one the envelope actually uses.
 *
 *        The tests deliberately avoid asserting exact copy. Summaries and
 *        descriptions are written for a reader and will be improved; pinning
 *        them would make editing a sentence a test failure, which teaches
 *        people to stop editing sentences.
 * WHERE: src/lib/api/reference.ts and src/lib/api/mcp-clients.ts.
 */

import { describe, expect, it } from "vitest";

import { mcpClientConfigs, MCP_KEY_PLACEHOLDER } from "./mcp-clients";
import { buildOpenApiDocument } from "./openapi";
import { buildApiReference } from "./reference";
import { API_ERROR_CODES } from "@/lib/types/api";

const ORIGIN = "https://example.test";

describe("buildApiReference", () => {
  it("lists every path in the OpenAPI document and invents none", () => {
    /* NOTHING_IS_HAND_LISTED_TWICE — the set of endpoints is derived, so the
     * two must agree exactly in both directions. */
    const document = buildOpenApiDocument(ORIGIN);
    const documented = Object.keys(
      document["paths"] as Record<string, unknown>,
    );

    const reference = buildApiReference(ORIGIN);
    const rendered = [...new Set(reference.endpoints.map((e) => e.path))];

    expect(rendered.sort()).toEqual(documented.sort());
  });

  it("covers the nine endpoints the phase names", () => {
    const reference = buildApiReference(ORIGIN);
    const routes = reference.endpoints.map((e) => `${e.method} ${e.path}`);

    expect(routes).toContain("POST /api/v1/projects");
    expect(routes).toContain("POST /api/v1/scripts");
    expect(routes).toContain("POST /api/v1/projects/{id}/voices");
    expect(routes).toContain("POST /api/v1/renders");
    expect(routes).toContain("GET /api/v1/renders/{id}");
    expect(routes).toContain("GET /api/v1/outputs/{id}");
    expect(routes).toContain("GET /api/v1/catalog/voices");
    expect(routes).toContain("GET /api/v1/catalog/backgrounds");
    expect(routes).toContain("GET /api/v1/catalog/caption-styles");
  });

  it("carries the server URL it was given, so a preview describes itself", () => {
    expect(buildApiReference(ORIGIN).serverUrl).toBe(ORIGIN);
  });

  it("flattens a POST's body into named fields with a required flag", () => {
    const reference = buildApiReference(ORIGIN);
    const create = reference.endpoints.find(
      (e) => e.path === "/api/v1/projects" && e.method === "POST",
    );

    expect(create).toBeDefined();
    if (create === undefined) return;

    /* `title` is required on `createProjectSchema`, which this is derived
     * from — so a reader is told to send it. */
    const title = create.body.find((field) => field.name === "title");
    expect(title).toBeDefined();
    expect(title?.required).toBe(true);
  });

  it("renders an enum as its values, not as 'string'", () => {
    /* A_TYPE_IS_FOR_A_READER. The permitted values are the actual answer to
     * "what goes here" and are invisible in the JSON unless you open it. */
    const reference = buildApiReference(ORIGIN);
    const create = reference.endpoints.find(
      (e) => e.path === "/api/v1/projects" && e.method === "POST",
    );
    const aspect = create?.body.find((field) => field.name === "aspect");

    expect(aspect).toBeDefined();
    expect(aspect?.type).toContain('"9:16"');
  });

  it("never describes organizationId as a field a caller sends", () => {
    /* THE_KEY_SUPPLIES_THE_TENANT. A documented `organizationId` would invite
     * a caller to assert its own tenancy, which is the one field that must
     * come from the key. */
    const reference = buildApiReference(ORIGIN);

    for (const endpoint of reference.endpoints) {
      const names = [...endpoint.body, ...endpoint.parameters].map(
        (field) => field.name,
      );
      expect(names).not.toContain("organizationId");
    }
  });

  it("offers Idempotency-Key as a header on the POSTs and not on the reads", () => {
    const reference = buildApiReference(ORIGIN);

    const hasKey = (method: string, path: string) =>
      reference.endpoints
        .find((e) => e.method === method && e.path === path)
        ?.parameters.some((p) => p.name === "Idempotency-Key") ?? false;

    expect(hasKey("POST", "/api/v1/renders")).toBe(true);
    /* A read has nothing to deduplicate, so documenting the header there
     * would promise a guarantee the route does not implement. */
    expect(hasKey("GET", "/api/v1/renders/{id}")).toBe(false);
  });

  it("exposes the whole error vocabulary a client may branch on", () => {
    const reference = buildApiReference(ORIGIN);

    expect(reference.errorCodes.sort()).toEqual(
      Object.values(API_ERROR_CODES).sort(),
    );
  });

  it("collects the failure statuses once rather than per endpoint", () => {
    /* They are identical on every endpoint, so the page shows one table. */
    const reference = buildApiReference(ORIGIN);
    const statuses = reference.errorStatuses.map((entry) => entry.status);

    expect(statuses).toContain("401");
    expect(statuses).toContain("429");
    expect(statuses).toContain("500");
    /* De-duplicated: a status appears once however many endpoints return it. */
    expect(new Set(statuses).size).toBe(statuses.length);
    /* And a success status is NOT in the failure table. */
    expect(statuses).not.toContain("200");
    expect(statuses).not.toContain("201");
  });

  it("gives each endpoint its own success status", () => {
    const reference = buildApiReference(ORIGIN);

    const created = reference.endpoints.find(
      (e) => e.method === "POST" && e.path === "/api/v1/projects",
    );
    /* A creation says 201; that is the only reason to override 200. */
    expect(created?.success?.status).toBe("201");

    const read = reference.endpoints.find(
      (e) => e.method === "GET" && e.path === "/api/v1/catalog/voices",
    );
    expect(read?.success?.status).toBe("200");
  });
});

describe("mcpClientConfigs", () => {
  it("covers Claude Code, Claude Desktop and Cursor", () => {
    /* A_CLIENT_NEEDS_ITS_OWN_BLOCK — the phase's step 17 asks for Claude and
     * Cursor by name. */
    const clients = mcpClientConfigs(ORIGIN).map((config) => config.client);

    expect(clients).toContain("Claude Code");
    expect(clients).toContain("Claude Desktop");
    expect(clients).toContain("Cursor");
  });

  it("gives every client a target, a snippet and a next step", () => {
    /* WHERE the config goes is the thing people are stuck on, so a block
     * without a target is the gap this module exists to close. */
    for (const config of mcpClientConfigs(ORIGIN)) {
      expect(config.target.length).toBeGreaterThan(0);
      expect(config.snippet.length).toBeGreaterThan(0);
      expect(config.note.length).toBeGreaterThan(0);
    }
  });

  it("points every snippet at the origin it was given", () => {
    for (const config of mcpClientConfigs(ORIGIN)) {
      expect(config.snippet).toContain(`${ORIGIN}/api/mcp`);
    }
  });

  it("never puts a real key in a snippet", () => {
    /* THE_KEY_IS_A_PLACEHOLDER. These blocks get screenshotted, pasted into
     * tickets and committed to dotfiles repos. */
    for (const config of mcpClientConfigs(ORIGIN)) {
      expect(config.snippet).toContain(MCP_KEY_PLACEHOLDER);
    }
  });

  it("emits valid JSON for the clients configured by file", () => {
    /* A block somebody pastes into a config file has to parse, or the first
     * thing they meet is their editor complaining. */
    for (const config of mcpClientConfigs(ORIGIN)) {
      if (config.language !== "json") continue;
      expect(() => JSON.parse(config.snippet)).not.toThrow();
    }
  });

  it("names the server under one label across every client", () => {
    /* RENAMING_BREAKS_A_SHIPPED_CONFIG — and so would two clients disagreeing
     * about the name in the first place. */
    const labels = mcpClientConfigs(ORIGIN).map((config) => {
      if (config.language !== "json") return null;
      const parsed: unknown = JSON.parse(config.snippet);
      const servers = (parsed as { mcpServers: Record<string, unknown> })
        .mcpServers;
      return Object.keys(servers)[0];
    });

    expect(new Set(labels.filter((label) => label !== null)).size).toBe(1);
  });
});
