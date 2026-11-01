/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: buildOpenApiDocument, GENERATED_FROM_THE_SCHEMAS,
 *   OPENAPI_3_1_IS_JSON_SCHEMA, THE_ENVELOPE_IS_DESCRIBED_ONCE,
 *   RESPONSES_ARE_DESCRIBED_NOT_TYPED
 *
 * WHAT:  The OpenAPI 3.1 description of `/api/v1`, built from the same Zod
 *        schemas the routes validate with.
 *
 * WHY:   GENERATED_FROM_THE_SCHEMAS is the phase file's step 13 — "generated
 *        from the Zod schemas rather than hand-typed" — and the reason is the
 *        failure mode of the alternative. A hand-written document is correct
 *        on the day it is written and wrong the first time a field is
 *        tightened, and nothing fails: the API keeps working, the document
 *        keeps describing the old shape, and the client generated from it
 *        starts sending requests the server refuses. Deriving means a schema
 *        change reaches the document with nobody remembering to.
 *
 *        OPENAPI_3_1_IS_JSON_SCHEMA, which is what makes this cheap. 3.1
 *        aligned its schema object with JSON Schema 2020-12, and Zod 4 emits
 *        exactly that from `z.toJSONSchema()`. So there is no third-party
 *        converter and no second description of a type — the conversion is one
 *        function call per schema. Picking 3.0 would have required a
 *        translation layer for no benefit.
 *
 *        `io: "input"` matters: a schema with defaults has a different shape
 *        going in than coming out (`limit` is optional in a request and always
 *        present in the parsed value), and describing the OUTPUT shape to a
 *        client would tell them a field is required when it is not.
 *
 *        THE_ENVELOPE_IS_DESCRIBED_ONCE. Every response is
 *        `{ data, requestId }` or `{ error, requestId }`, so the envelope is a
 *        component and each operation references it. Repeating it per path
 *        would be two hundred lines of duplication and a drift surface.
 *
 *        RESPONSES_ARE_DESCRIBED_NOT_TYPED, and this is the honest limitation
 *        to state plainly: the `data` payloads are documented as objects
 *        rather than as exact schemas, because the operations return Prisma
 *        rows and composed views that have no Zod schema to derive from. A
 *        hand-written response schema is the very thing this file refuses to
 *        do for requests, so it is not done for responses either. What a
 *        client gets is exact REQUEST validation and an accurate list of
 *        endpoints, statuses and error codes — and `data` as an open object.
 *        Closing that gap means response schemas in `lib/types`, which is a
 *        larger change than this phase.
 *
 *        Pure: no request, no database, no environment. The route that serves
 *        it passes in the server URL.
 * WHERE: src/app/api/v1/openapi.json/route.ts.
 */

import { z } from "zod";

import {
  API_ERROR_CODES,
  apiBackgroundCatalogSchema,
  apiCaptionStyleCatalogSchema,
  apiCreateProjectSchema,
  apiCreateRenderSchema,
  apiGenerateScriptSchema,
  apiVoiceCatalogSchema,
} from "@/lib/types/api";

/* The document is JSON, so its type is JSON. It is not modelled as a nested
 * interface because OpenAPI's own shape is the schema here and a partial
 * hand-written mirror of it would be a second thing to keep right. */
type JsonRecord = Record<string, unknown>;

/* `$schema` is correct in a standalone JSON Schema document and WRONG inside
 * an OpenAPI schema object, where the dialect is declared once at the top. */
function schemaOf(schema: z.ZodType): JsonRecord {
  const generated: JsonRecord = {
    ...(z.toJSONSchema(schema, { io: "input" }) as JsonRecord),
  };
  delete generated["$schema"];
  return generated;
}

/* Each path's `data` payload, described rather than derived — see
 * RESPONSES_ARE_DESCRIBED_NOT_TYPED. */
function dataObject(description: string): JsonRecord {
  return { type: "object", description, additionalProperties: true };
}

function okResponse(description: string, dataDescription: string): JsonRecord {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["data", "requestId"],
          properties: {
            data: dataObject(dataDescription),
            requestId: { type: "string" },
          },
        },
      },
    },
  };
}

/* The failure responses every endpoint can return. Listed per status so a
 * generated client has a branch per status, and the shared error component
 * carries the enumerated codes. */
const ERROR_RESPONSES: JsonRecord = {
  "400": errorResponse("The request was malformed or failed validation."),
  "401": errorResponse("The API key is missing, malformed or unknown."),
  "403": errorResponse(
    "The plan does not include this, or the action was refused.",
  ),
  "404": errorResponse("No such thing, or not visible to this workspace."),
  "409": errorResponse("An Idempotency-Key conflict, or a concurrent change."),
  "412": errorResponse("The project is not in a state that allows this yet."),
  "422": errorResponse("Well-formed, and impossible to act on."),
  "429": errorResponse("A quota or rate limit was reached."),
  "500": errorResponse("Something failed on our side. Quote the requestId."),
};

function errorResponse(description: string): JsonRecord {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
      },
    },
  };
}

const IDEMPOTENCY_PARAMETER: JsonRecord = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description:
    "A unique string per request. Repeating a request with the same key replays the original response instead of doing the work twice. Reusing a key for a different request is a 409.",
  schema: { type: "string", maxLength: 255 },
};

function jsonBody(schema: z.ZodType): JsonRecord {
  return {
    required: true,
    content: { "application/json": { schema: schemaOf(schema) } },
  };
}

/* A query schema becomes one parameter per property, which is what OpenAPI
 * wants — there is no "query object" in the specification. */
function queryParameters(schema: z.ZodType): JsonRecord[] {
  const generated = schemaOf(schema);
  const properties = generated["properties"];
  if (properties === undefined || typeof properties !== "object") return [];

  const required = Array.isArray(generated["required"])
    ? generated["required"]
    : [];

  return Object.entries(properties as Record<string, unknown>).map(
    ([name, property]): JsonRecord => ({
      name,
      in: "query",
      required: required.includes(name),
      schema: property,
    }),
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildOpenApiDocument
 *
 * WHAT:  The whole document.
 * WHY:   Takes the server URL rather than reading it from the environment, so
 *        this stays pure and a preview deployment describes itself rather than
 *        production.
 * WHERE: The openapi.json route.
 */
export function buildOpenApiDocument(serverUrl: string): JsonRecord {
  return {
    openapi: "3.1.0",
    info: {
      title: "Video API",
      version: "1.0.0",
      description:
        "Create projects, write scripts, assign voices and render short-form videos. Every endpoint is authenticated with a workspace API key and answers with `{ data, requestId }` or `{ error, requestId }`.",
    },
    servers: [{ url: serverUrl }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description:
            "A workspace API key, created under Settings → Developers. Send it as `Authorization: Bearer <key>`.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error", "requestId"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                /* Generated from the constant, so a new code cannot be added
                 * to the API and left out of its own description. */
                code: {
                  type: "string",
                  enum: Object.values(API_ERROR_CODES),
                },
                message: {
                  type: "string",
                  description: "A sentence written for a person to read.",
                },
              },
            },
            requestId: {
              type: "string",
              description:
                "Quote this when reporting a problem. Present on every response.",
            },
          },
        },
      },
    },
    paths: {
      "/api/v1/projects": {
        post: {
          summary: "Create a project",
          description:
            "Counts against the monthly `projects` limit, shared with the dashboard.",
          parameters: [IDEMPOTENCY_PARAMETER],
          requestBody: jsonBody(apiCreateProjectSchema),
          responses: {
            "201": okResponse("The project that was created.", "The project."),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/scripts": {
        post: {
          summary: "Write a script for a project",
          description:
            "Reads the source synchronously and queues the writing. Costs credits, refused before the fetch if the workspace cannot pay. Poll the project to see the script arrive.",
          parameters: [IDEMPOTENCY_PARAMETER],
          requestBody: jsonBody(apiGenerateScriptSchema),
          responses: {
            "200": okResponse(
              "The writing was queued.",
              "`queued`, the cost, and what was extracted from the source.",
            ),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/projects/{id}/voices": {
        post: {
          summary: "Assign a voice to a speaker",
          description:
            "The speaker must belong to the project named in the path. Returns whether the project's cast is now complete.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "The project the speaker belongs to.",
              schema: { type: "string" },
            },
            IDEMPOTENCY_PARAMETER,
          ],
          requestBody: jsonBody(
            z.object({
              speakerId: z.string().min(1),
              voiceId: z.string().min(1),
            }),
          ),
          responses: {
            "200": okResponse(
              "The assignment, and the cast's completeness.",
              "`speakerId`, `voiceId` and `assignments`.",
            ),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/renders": {
        post: {
          summary: "Render a project",
          description:
            "Returns as soon as the render is queued. A render of a document already rendered at this resolution returns the existing one and costs nothing. Poll `/api/v1/renders/{id}`.",
          parameters: [IDEMPOTENCY_PARAMETER],
          requestBody: jsonBody(apiCreateRenderSchema),
          responses: {
            "201": okResponse(
              "The render, whether it was reused, and its cost.",
              "`render`, `reused` and `cost`.",
            ),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/renders/{id}": {
        get: {
          summary: "Read a render",
          description:
            "Its status, and a signed download URL once there is something to download. Not limited by the monthly render quota, so a workspace at its limit can still collect what it paid for.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": okResponse(
              "The render and its URLs.",
              "`render`, `downloadUrl` and `posterUrl`.",
            ),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/outputs/{id}": {
        get: {
          summary: "Get a download URL for an output",
          description:
            "A short-lived signed URL. Download it directly; do not store the URL.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "The asset id of the output.",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": okResponse(
              "The signed URL and how long it lasts.",
              "`url` and `expiresInSeconds`.",
            ),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/catalog/voices": {
        get: {
          summary: "List voices",
          description:
            "Every voice, including ones above this plan — those come back with `locked: true` and an upgrade message rather than being hidden.",
          parameters: queryParameters(apiVoiceCatalogSchema),
          responses: {
            "200": okResponse(
              "The voices.",
              "`plan`, `premiumEnabled`, `upgradeMessage` and `voices`.",
            ),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/catalog/caption-styles": {
        get: {
          summary: "List caption styles",
          description:
            "Each style with its availability and whether it passes the contrast check.",
          parameters: queryParameters(apiCaptionStyleCatalogSchema),
          responses: {
            "200": okResponse(
              "The caption styles.",
              "`plan`, `families` and `styles`.",
            ),
            ...ERROR_RESPONSES,
          },
        },
      },
      "/api/v1/catalog/backgrounds": {
        get: {
          summary: "List background library assets",
          description:
            "Cursor-paginated. Send `nextCursor` back as `cursor` to get the next page; it is opaque and must not be parsed.",
          parameters: queryParameters(apiBackgroundCatalogSchema),
          responses: {
            "200": okResponse(
              "A page of backgrounds.",
              "`backgrounds`, `total` and `nextCursor`.",
            ),
            ...ERROR_RESPONSES,
          },
        },
      },
    },
  };
}
