/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: buildApiReference, ApiReference, ApiReferenceEndpoint,
 *   ApiReferenceParameter, THE_PAGE_IS_THE_DOCUMENT,
 *   ONE_DESCRIPTION_TWO_RENDERINGS, NOTHING_IS_HAND_LISTED_TWICE
 *
 * WHAT:  The OpenAPI document flattened into the shape a page renders: a list
 *        of endpoints, each with its method, path, summary, parameters and
 *        request body fields.
 *
 * WHY:   THE_PAGE_IS_THE_DOCUMENT, and this is the whole reason this module
 *        exists rather than a hand-written reference page. The phase file's
 *        step 13 asks for a document "generated from the Zod schemas rather
 *        than hand-typed" and a docs page — and a docs page typed by hand
 *        beside a generated document is exactly the drift the generation was
 *        meant to prevent, just moved one file along. It would be correct on
 *        the day it was written and wrong the first time a field changed, with
 *        nothing failing.
 *
 *        ONE_DESCRIPTION_TWO_RENDERINGS. `buildOpenApiDocument` stays the
 *        single source: a machine reads it as JSON at
 *        `/api/v1/openapi.json`, and a person reads this projection of the
 *        same object at `/docs/api`. Adding an endpoint means adding it to the
 *        document, once, and both surfaces gain it.
 *
 *        NOTHING_IS_HAND_LISTED_TWICE, including the error codes and the
 *        statuses: they are read back off the document's own components and
 *        responses. The one thing this file writes itself is the CONVENTIONS
 *        prose — the envelope, idempotency, pagination, the shared quota —
 *        because those are facts about the whole API that OpenAPI has no field
 *        for, and a sentence a person needs is not derivable from a schema.
 *
 *        Flattening happens HERE rather than in the page because walking an
 *        untyped JSON tree is the part worth having types for and worth
 *        testing: the page then renders a typed list and contains no
 *        `as`-casts of its own. Pure — it takes an origin and returns data, so
 *        a test calls it with no framework.
 * WHERE: src/app/(marketing)/docs/api/page.tsx.
 */

import { buildOpenApiDocument } from "./openapi";

export interface ApiReferenceParameter {
  name: string;
  /** `path`, `query` or `header`. */
  location: string;
  required: boolean;
  /** `string`, `integer`, `string (enum)` — written for a reader, not a parser. */
  type: string;
  description: string | null;
}

export interface ApiReferenceEndpoint {
  method: string;
  path: string;
  summary: string;
  description: string | null;
  parameters: ApiReferenceParameter[];
  /** The request body's fields, flattened the same way. Empty for a GET. */
  body: ApiReferenceParameter[];
  /** The success status and what it means. */
  success: { status: string; description: string } | null;
}

export interface ApiReference {
  title: string;
  description: string;
  version: string;
  serverUrl: string;
  /** How to authenticate, from the document's own security scheme. */
  authDescription: string;
  endpoints: ApiReferenceEndpoint[];
  /** Every error code a client may branch on, read off the Error component. */
  errorCodes: string[];
  /** Every failure status the API returns, with what it means. */
  errorStatuses: { status: string; description: string }[];
}

/* The document is JSON, so reading it is JSON-shaped. These helpers do the
 * narrowing once, in one place, so nothing below reaches into an `unknown`
 * with a cast. */
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * SOURCE OF TRUTH KEYWORDS: describeType, A_TYPE_IS_FOR_A_READER
 *
 * WHAT:  A JSON Schema fragment as a short phrase — `string`, `integer`,
 *        `"9:16" | "16:9"`, `string[]`.
 * WHY:   A_TYPE_IS_FOR_A_READER. The generated schema is accurate and verbose;
 *        a reference table needs the one line that tells somebody what to
 *        send. An enum is rendered as its VALUES rather than as "string",
 *        because the values are the actual answer to "what goes here" and are
 *        otherwise invisible without opening the JSON.
 *
 *        Unions come out of Zod as `anyOf`, which is how an optional field
 *        with a default appears; the first branch is the one worth naming.
 * WHERE: buildApiReference, for both parameters and body fields.
 */
function describeType(schema: JsonRecord | null): string {
  if (schema === null) return "unknown";

  const enumValues = schema["enum"];
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return enumValues
      .map((value) => (typeof value === "string" ? `"${value}"` : String(value)))
      .join(" | ");
  }

  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    const branches = anyOf
      .map((branch) => describeType(asRecord(branch)))
      /* `null` as a union branch means "optional", which the `required` column
       * already says. Naming it twice reads as a type a client must send. */
      .filter((branch) => branch !== "null");
    return branches.length > 0 ? branches.join(" | ") : "null";
  }

  const type = asString(schema["type"]);
  if (type === "array") {
    return `${describeType(asRecord(schema["items"]))}[]`;
  }
  return type ?? "object";
}

/* An object schema's properties as reader-facing rows. Shared by parameters
 * and request bodies because both are "a list of fields with a type and
 * whether you must send it". */
function flattenProperties(schema: JsonRecord | null): ApiReferenceParameter[] {
  if (schema === null) return [];

  const properties = asRecord(schema["properties"]);
  if (properties === null) return [];

  const required = Array.isArray(schema["required"]) ? schema["required"] : [];

  return Object.entries(properties).map(([name, raw]): ApiReferenceParameter => {
    const property = asRecord(raw);
    return {
      name,
      location: "body",
      required: required.includes(name),
      type: describeType(property),
      description: asString(property?.["description"]),
    };
  });
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildApiReference, THE_PAGE_IS_THE_DOCUMENT
 *
 * WHAT:  The whole reference, flattened from the OpenAPI document.
 * WHY:   Takes the origin for the same reason `buildOpenApiDocument` does —
 *        the page shows a base URL a reader will copy, and it must be the
 *        deployment they are looking at.
 * WHERE: /docs/api.
 */
export function buildApiReference(serverUrl: string): ApiReference {
  const document = buildOpenApiDocument(serverUrl);

  const info = asRecord(document["info"]);
  const components = asRecord(document["components"]);
  const paths = asRecord(document["paths"]) ?? {};

  const endpoints: ApiReferenceEndpoint[] = [];
  /* Collected across every endpoint and de-duplicated, because the failure
   * statuses are identical on all of them — ERROR_RESPONSES is one object
   * spread into each. Listing them once at the top of the page is the honest
   * rendering of that. */
  const errorStatuses = new Map<string, string>();

  for (const [path, rawOperations] of Object.entries(paths)) {
    const operations = asRecord(rawOperations);
    if (operations === null) continue;

    for (const [method, rawOperation] of Object.entries(operations)) {
      const operation = asRecord(rawOperation);
      if (operation === null) continue;

      const parameters: ApiReferenceParameter[] = (
        Array.isArray(operation["parameters"]) ? operation["parameters"] : []
      ).flatMap((raw): ApiReferenceParameter[] => {
        const parameter = asRecord(raw);
        const name = asString(parameter?.["name"]);
        if (parameter === null || name === null) return [];
        return [
          {
            name,
            location: asString(parameter["in"]) ?? "query",
            required: parameter["required"] === true,
            type: describeType(asRecord(parameter["schema"])),
            description: asString(parameter["description"]),
          },
        ];
      });

      const bodySchema = asRecord(
        asRecord(
          asRecord(asRecord(operation["requestBody"])?.["content"])?.[
            "application/json"
          ],
        )?.["schema"],
      );

      const responses = asRecord(operation["responses"]) ?? {};
      let success: ApiReferenceEndpoint["success"] = null;

      for (const [status, rawResponse] of Object.entries(responses)) {
        const description =
          asString(asRecord(rawResponse)?.["description"]) ?? "";
        /* 2xx is this endpoint's own; everything else is shared and belongs in
         * the page's one failure table. */
        if (status.startsWith("2")) {
          success ??= { status, description };
        } else {
          errorStatuses.set(status, description);
        }
      }

      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: asString(operation["summary"]) ?? path,
        description: asString(operation["description"]),
        parameters,
        body: flattenProperties(bodySchema),
        success,
      });
    }
  }

  const errorCodeEnum = asRecord(
    asRecord(
      asRecord(asRecord(components?.["schemas"])?.["Error"])?.["properties"],
    )?.["error"],
  );
  const codes =
    asRecord(asRecord(errorCodeEnum?.["properties"])?.["code"])?.["enum"];

  return {
    title: asString(info?.["title"]) ?? "API",
    description: asString(info?.["description"]) ?? "",
    version: asString(info?.["version"]) ?? "1.0.0",
    serverUrl,
    authDescription:
      asString(
        asRecord(asRecord(components?.["securitySchemes"])?.["apiKey"])?.[
          "description"
        ],
      ) ?? "Send a workspace API key as `Authorization: Bearer <key>`.",
    /* Grouped so the page reads in the order somebody integrates: create a
     * project, write, cast, render, collect — then the catalogues. The
     * document's own key order already is that order, so this preserves it
     * rather than sorting. */
    endpoints,
    errorCodes: Array.isArray(codes)
      ? codes.filter((code): code is string => typeof code === "string")
      : [],
    errorStatuses: [...errorStatuses.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, description]) => ({ status, description })),
  };
}
