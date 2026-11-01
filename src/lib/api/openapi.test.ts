/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: openapi test, buildOpenApiDocument,
 *   GENERATED_FROM_THE_SCHEMAS, EVERY_ROUTE_IS_DESCRIBED,
 *   THE_ERROR_CODES_ARE_ENUMERATED
 *
 * WHAT:  That the document describes every route the API serves, that the
 *        request schemas really are generated from the Zod schemas, and that
 *        the error vocabulary in the document is the one the code emits.
 *
 * WHY:   EVERY_ROUTE_IS_DESCRIBED is asserted against the FILESYSTEM rather
 *        than against a list in this test, which is the only version of the
 *        assertion worth writing. A route added under `src/app/api/v1/`
 *        without a path in the document is an endpoint no generated client can
 *        reach and no reviewer would notice — the API works, the docs are
 *        silently incomplete. Reading the directory makes forgetting
 *        impossible.
 *
 *        THE_ERROR_CODES_ARE_ENUMERATED from the constant, so a code added to
 *        `API_ERROR_CODES` cannot be returned by the API and left out of its
 *        own description.
 *
 *        GENERATED_FROM_THE_SCHEMAS is checked by asserting a constraint that
 *        exists only in the Zod schema — if somebody replaced the generation
 *        with a hand-written object, the constraint would be the first thing
 *        to go missing.
 * WHERE: `npm test`.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { API_ERROR_CODES } from "@/lib/types/api";

import { buildOpenApiDocument } from "./openapi";

const API_DIR = join(
  fileURLToPath(new URL("../../..", import.meta.url)),
  "src",
  "app",
  "api",
  "v1",
);

const document = buildOpenApiDocument("https://example.test");

/* The document's shape is JSON, so reading into it needs narrowing rather than
 * casts. These two helpers are the whole of it. */
function record(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

function paths(): Record<string, unknown> {
  return record(record(document)["paths"]);
}

/**
 * Every route file under src/app/api/v1, as the URL path it serves — so the
 * assertion below is about what EXISTS rather than what somebody remembered.
 * `_lib` is skipped because a leading underscore is Next's own "not a route",
 * and `openapi.json` describes itself and is not part of the API it documents.
 */
function routePathsOnDisk(dir: string, prefix: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_")) continue;
      found.push(...routePathsOnDisk(join(dir, entry.name), `${prefix}/${entry.name}`));
      continue;
    }
    if (entry.name === "route.ts") found.push(prefix);
  }

  return found;
}

describe("the document", () => {
  it("is OpenAPI 3.1, so its schemas are JSON Schema", () => {
    /* OPENAPI_3_1_IS_JSON_SCHEMA — what makes Zod's output usable directly. */
    expect(record(document)["openapi"]).toBe("3.1.0");
  });

  it("describes bearer authentication once, and requires it globally", () => {
    const components = record(record(document)["components"]);
    const schemes = record(components["securitySchemes"]);
    const apiKey = record(schemes["apiKey"]);
    expect(apiKey["scheme"]).toBe("bearer");
    expect(record(document)["security"]).toEqual([{ apiKey: [] }]);
  });

  it("points at the server it was asked about", () => {
    expect(record(document)["servers"]).toEqual([
      { url: "https://example.test" },
    ]);
  });
});

describe("coverage", () => {
  it("describes every route that exists on disk", () => {
    /* EVERY_ROUTE_IS_DESCRIBED — see the file header. */
    const onDisk = routePathsOnDisk(API_DIR, "/api/v1")
      /* The document describes the API, not itself. */
      .filter((path) => !path.endsWith("/openapi.json"))
      /* Next's `[id]` is OpenAPI's `{id}`. */
      .map((path) => path.replaceAll(/\[(\w+)\]/g, "{$1}"))
      .sort();

    expect(onDisk.length).toBeGreaterThan(0);
    expect(Object.keys(paths()).sort()).toEqual(onDisk);
  });

  it("gives every documented path at least one operation", () => {
    for (const [path, value] of Object.entries(paths())) {
      const operations = Object.keys(record(value));
      expect(operations.length, `${path} has no operations`).toBeGreaterThan(0);
    }
  });

  it("documents a 401 on every operation", () => {
    /* Every endpoint is key-authenticated, so every one of them can answer
     * 401 — a generated client that did not know that would treat an expired
     * key as an unexpected failure. */
    for (const [path, value] of Object.entries(paths())) {
      for (const [method, operation] of Object.entries(record(value))) {
        const responses = record(record(operation)["responses"]);
        expect(
          Object.keys(responses),
          `${method.toUpperCase()} ${path}`,
        ).toContain("401");
      }
    }
  });
});

describe("the error component", () => {
  it("enumerates exactly the codes the code can emit", () => {
    /* THE_ERROR_CODES_ARE_ENUMERATED — generated from the constant. */
    const components = record(record(document)["components"]);
    const schemas = record(components["schemas"]);
    const error = record(schemas["Error"]);
    const properties = record(error["properties"]);
    const code = record(record(properties["error"])["properties"]);
    const codes = record(code["code"])["enum"];

    expect(codes).toEqual(Object.values(API_ERROR_CODES));
  });
});

describe("request schemas", () => {
  it("carries a constraint that only the Zod schema knows", () => {
    /* GENERATED_FROM_THE_SCHEMAS. `title` on a project is `min(1).max(120)` in
     * `createProjectSchema`; a hand-written document would describe a plain
     * string, so the presence of the bound is the evidence of generation. */
    const projects = record(paths()["/api/v1/projects"]);
    const post = record(projects["post"]);
    const body = record(post["requestBody"]);
    const content = record(body["content"]);
    const json = record(content["application/json"]);
    const schema = record(json["schema"]);
    const properties = record(schema["properties"]);
    const title = record(properties["title"]);

    expect(title["type"]).toBe("string");
    expect(title["minLength"]).toBe(1);
  });

  it("never asks a client for organizationId", () => {
    /* THE_KEY_SUPPLIES_THE_TENANT — a body field for it would be a caller
     * asserting its own tenancy. */
    expect(JSON.stringify(paths())).not.toContain("organizationId");
  });

  it("carries no `$schema`, which is invalid inside an OpenAPI schema object", () => {
    /* Zod emits it for a standalone document; the dialect is declared once at
     * the top of an OpenAPI file and a stray `$schema` makes validators
     * complain about a document that is otherwise fine. */
    expect(JSON.stringify(paths())).not.toContain("$schema");
  });

  it("describes the Idempotency-Key header on every POST", () => {
    for (const [path, value] of Object.entries(paths())) {
      const post = record(value)["post"];
      if (post === undefined) continue;

      const parameters = record(post)["parameters"];
      const names = Array.isArray(parameters)
        ? parameters.map((parameter) => record(parameter)["name"])
        : [];
      expect(names, `POST ${path}`).toContain("Idempotency-Key");
    }
  });
});
