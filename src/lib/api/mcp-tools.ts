/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MCP_TOOLS, listMcpTools, callMcpTool, defineTool,
 *   BoundTool, SEVEN_TOOLS_SEVEN_OPERATIONS, THE_DESCRIPTION_IS_THE_INTERFACE,
 *   WORK_OUTLIVES_THE_CONNECTION, ONE_GATE_ORDER_TWO_SURFACES,
 *   A_TOOL_FAILURE_IS_NOT_A_PROTOCOL_FAILURE, THE_FACTORY_CLOSES_OVER_THE_TYPES
 *
 * WHAT:  The tools the MCP server exposes, each bound to the same shared
 *        operation the REST API calls, and the dispatcher that runs one.
 *
 * WHY:   SEVEN_TOOLS_SEVEN_OPERATIONS. This table is the whole of 17c's
 *        business logic, which is the point: by the time the MCP server was
 *        written, every rule it needs already existed in
 *        `src/lib/api/operations/` and every gate in `src/lib/api/gates.ts`.
 *        A tool is a name, a description, a schema, a metered resource, a
 *        summary sentence and a one-line call. If that had not been true — if
 *        a tool had needed to re-check a plan or re-derive a price — 17a would
 *        have failed at its own purpose.
 *
 *        THE_DESCRIPTION_IS_THE_INTERFACE, and this is where MCP differs most
 *        from REST. A REST client is read by a programmer with the
 *        documentation open; a tool description is read by a MODEL deciding
 *        whether to call it, with nothing else to go on. So each description
 *        says what the tool does, what it costs, and what happens next —
 *        because a model that does not know a render is asynchronous will poll
 *        nothing, and one that does not know a script costs credits cannot
 *        warn anybody.
 *
 *        WORK_OUTLIVES_THE_CONNECTION is step 16, and it is in the
 *        descriptions on purpose. The expensive verbs queue durable work: a
 *        disconnect, a timeout or a client restart cancels nothing, so an
 *        agent that retries `start_render` after losing its connection has
 *        started a SECOND paid render. The only defence is telling the model,
 *        in the one text it is guaranteed to read.
 *
 *        ONE_GATE_ORDER_TWO_SURFACES: the dispatcher applies the same
 *        entitlement sequence the REST pipeline applies, by calling the same
 *        function. The MCP server has no gate logic of its own.
 *
 *        THE_FACTORY_CLOSES_OVER_THE_TYPES. The tools have different input and
 *        output types, so a plain array of them is a union that no longer
 *        knows element N's schema produces exactly what element N's operation
 *        accepts — the pairing is real and the type system cannot carry it
 *        through a lookup by name. `defineTool` is where each tool's two types
 *        are closed over, ONCE, inside a generic function: parse, run, count
 *        and summarise all happen where the relationship is still visible, and
 *        what comes out is a uniform `BoundTool`. No `any`, no assertion, and
 *        no way to hand one tool's input to another's operation.
 *
 *        SERVER-ONLY, because it reaches the operations. The envelopes it
 *        builds are pure and live in ./mcp.ts.
 * WHERE: src/app/api/mcp/route.ts.
 */

import "server-only";

import { z } from "zod";

import { isOperationError } from "@/lib/errors";
import type { LimitResourceKey } from "@/lib/resources";
import {
  apiBackgroundCatalogSchema,
  apiCreateProjectSchema,
  apiCreateRenderSchema,
  apiGenerateScriptSchema,
  apiVoiceCatalogSchema,
  type OperationContext,
} from "@/lib/types/api";

import { checkApiEntitlements, countApiUsage } from "./gates";
import { mcpToolError, mcpToolResult } from "./mcp";
import {
  assignVoiceOperation,
  createProjectOperation,
  createRenderOperation,
  generateScriptOperation,
  getOutputOperation,
  getRenderOperation,
  listBackgroundCatalogOperation,
  listVoiceCatalogOperation,
} from "./operations";

/**
 * SOURCE OF TRUTH KEYWORDS: BoundTool, THE_FACTORY_CLOSES_OVER_THE_TYPES
 *
 * One tool with its types already erased — the uniform shape the dispatcher
 * can hold in an array and look up by name. Everything type-dependent happened
 * inside `defineTool`.
 */
interface BoundTool {
  name: string;
  title: string;
  description: string;
  /** JSON Schema for `tools/list`, generated from the tool's Zod schema. */
  inputSchema: Record<string, unknown>;
  /** The verb's own metered resource, when it has one. */
  resource: LimitResourceKey | undefined;
  /**
   * Parses, runs, counts and summarises. Returns a finished MCP tool result,
   * including the `isError: true` kind — see
   * A_TOOL_FAILURE_IS_NOT_A_PROTOCOL_FAILURE.
   */
  invoke: (
    operation: OperationContext,
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
}

/**
 * SOURCE OF TRUTH KEYWORDS: defineTool, THE_FACTORY_CLOSES_OVER_THE_TYPES,
 *   COUNTED_AFTER_SUCCESS
 *
 * WHAT:  Turns a typed tool definition into a uniform `BoundTool`.
 * WHY:   See THE_FACTORY_CLOSES_OVER_THE_TYPES in the file header. `TInput`
 *        and `TOutput` are related here and only here: the schema parses into
 *        `TInput`, `run` takes `TInput` and returns `TOutput`, and `summary`
 *        and `consumed` read `TOutput`. The caller gets a closure.
 * WHERE: Every entry in MCP_TOOL_LIST.
 */
function defineTool<TInput, TOutput>(definition: {
  name: string;
  title: string;
  description: string;
  schema: z.ZodType<TInput>;
  resource?: LimitResourceKey;
  run: (operation: OperationContext, input: TInput) => Promise<TOutput>;
  summary: (output: TOutput) => string;
  /** False when this success consumed nothing. Defaults to always consuming. */
  consumed?: (output: TOutput) => boolean;
}): BoundTool {
  const inputSchema: Record<string, unknown> = {
    ...(z.toJSONSchema(definition.schema, { io: "input" }) as Record<
      string,
      unknown
    >),
  };
  /* Invalid inside a tool's inputSchema, where no dialect is declared. */
  delete inputSchema["$schema"];

  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema,
    resource: definition.resource,

    async invoke(operation, args) {
      const parsed = definition.schema.safeParse(args);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path.join(".");
        return mcpToolError(
          issue === undefined
            ? "Those arguments could not be validated."
            : path !== undefined && path.length > 0
              ? `${path}: ${issue.message}`
              : issue.message,
        );
      }

      try {
        const output = await definition.run(operation, parsed.data);

        /* COUNTED_AFTER_SUCCESS, with the same conditional the REST route
         * uses — a reused render consumed nothing. */
        await countApiUsage({
          organizationId: operation.organizationId,
          resource: definition.resource,
          consumed:
            definition.consumed === undefined || definition.consumed(output),
        });

        return mcpToolResult(definition.summary(output), output);
      } catch (error) {
        /* A_TOOL_FAILURE_IS_NOT_A_PROTOCOL_FAILURE — the model reads this and
         * adapts, so an operation's own customer-facing sentence travels as
         * written. */
        if (isOperationError(error)) return mcpToolError(error.message);

        console.error(`[api/mcp] ${definition.name} failed`, {
          requestId: operation.requestId,
          error,
        });
        return mcpToolError(
          "Something went wrong on our side. The request id is in our logs.",
        );
      }
    },
  };
}

/* The caveat every expensive tool repeats, in the one text a model is
 * guaranteed to read. See WORK_OUTLIVES_THE_CONNECTION. */
const ASYNC_CAVEAT =
  "The work continues on our servers after this returns, so losing the connection cancels nothing — do not retry it, poll instead.";

/**
 * SOURCE OF TRUTH KEYWORDS: MCP_TOOL_LIST, SEVEN_TOOLS_SEVEN_OPERATIONS
 *
 * The tools, named as the phase file names them. The names are snake_case
 * because that is the convention models are trained on, and they are part of a
 * public contract: renaming one breaks every agent configuration that mentions
 * it.
 *
 * The phase file lists seven; `list_voices` is the eighth and is here because
 * `assign_voices` is unusable without it — a model has no other way to learn a
 * voice id, and telling it to read a REST catalogue it cannot call would be a
 * dead end. The REST surface has the same three catalogues; the MCP surface
 * exposes the two an agent needs to complete a video.
 */
const MCP_TOOL_LIST: readonly BoundTool[] = [
  defineTool({
    name: "create_project",
    title: "Create a project",
    description:
      "Creates an empty video project and returns it. A project is the container everything else attaches to: scripts, voices and renders all name one. Counts against the workspace's monthly project allowance.",
    schema: apiCreateProjectSchema,
    resource: "projects",
    run: createProjectOperation,
    summary: (project) => `Created project "${project.title}" (${project.id}).`,
  }),

  defineTool({
    name: "generate_script",
    title: "Write a script",
    description: `Reads a source — a URL, a document or raw text — and writes a narration script for a project. COSTS CREDITS, and is refused before anything is fetched if the workspace cannot afford it. The source is read while you wait; the writing happens afterwards. ${ASYNC_CAVEAT}`,
    schema: apiGenerateScriptSchema,
    run: generateScriptOperation,
    summary: (result) =>
      `Queued a script costing ${result.cost.total} credits, from ${result.source.characters} characters of ${result.source.kind}.`,
  }),

  defineTool({
    name: "assign_voices",
    title: "Assign a voice to a speaker",
    description:
      "Gives one of a project's speakers a voice from the catalogue. Call `list_voices` first to find an id. A project cannot be narrated until every speaker has a voice, and the result says which are still missing.",
    schema: z.object({
      projectId: z.string().min(1),
      speakerId: z.string().min(1),
      voiceId: z.string().min(1),
    }),
    run: assignVoiceOperation,
    summary: (result) =>
      result.assignments.ok
        ? "Voice assigned. Every speaker now has one."
        : `Voice assigned. Still unassigned: ${
            result.assignments.unassigned.join(", ") || "none"
          }.`,
  }),

  defineTool({
    name: "start_render",
    title: "Render a project",
    description: `Starts rendering a project's timeline into a video and returns immediately with a render id. COSTS CREDITS unless this exact video has already been rendered at this resolution, in which case the existing one is returned for free. Poll \`get_render\` for progress. ${ASYNC_CAVEAT}`,
    schema: apiCreateRenderSchema,
    resource: "renders",
    run: createRenderOperation,
    summary: (result) =>
      result.reused
        ? "This video had already been rendered, so the existing render was returned and nothing was charged."
        : `Render queued, costing ${result.cost?.total ?? 0} credits. Poll get_render for progress.`,
    /* REUSE_COSTS_NOTHING — the same rule the REST route applies, from the
     * same report. */
    consumed: (result) => !result.reused,
  }),

  defineTool({
    name: "get_render",
    title: "Check a render",
    description:
      "Reads a render's status and, once it has finished, a download URL that expires. Safe to poll — it costs no credits and is not limited by the render allowance, so a workspace at its monthly limit can still collect what it has already paid for.",
    schema: z.object({ renderId: z.string().min(1) }),
    run: (operation, input) =>
      getRenderOperation(operation, { id: input.renderId }),
    summary: (result) =>
      result.downloadUrl === null
        ? `Render is ${result.render.status}.`
        : `Render is ${result.render.status} and ready to download.`,
  }),

  defineTool({
    name: "fetch_output",
    title: "Get a download link",
    description:
      "Returns a temporary signed URL for a finished file. Download it promptly and do not store the URL — it expires, and a new one can always be requested.",
    schema: z.object({ assetId: z.string().min(1) }),
    run: (operation, input) =>
      getOutputOperation(operation, { assetId: input.assetId }),
    summary: (result) =>
      `Download link ready, valid for about ${Math.round(
        result.expiresInSeconds / 60,
      )} minutes.`,
  }),

  defineTool({
    name: "list_backgrounds",
    title: "List background footage",
    description:
      "Lists the shared background library. Items above the workspace's plan are included and marked `locked: true` rather than hidden, so you can tell a person what upgrading would give them. Paginated — send `nextCursor` back as `cursor`, and treat it as opaque.",
    schema: apiBackgroundCatalogSchema,
    run: (operation, input) =>
      listBackgroundCatalogOperation(operation, {
        ...(input.search !== undefined ? { search: input.search } : {}),
        skip: decodeCursor(input.cursor),
        take: input.limit,
      }),
    summary: (result) =>
      `${result.backgrounds.length} background${
        result.backgrounds.length === 1 ? "" : "s"
      } of ${result.total}.`,
  }),

  defineTool({
    name: "list_voices",
    title: "List voices",
    description:
      "Lists every narration voice, including ones above the workspace's plan — those are marked `locked: true` rather than hidden. Use an id from here with `assign_voices`.",
    schema: apiVoiceCatalogSchema,
    run: listVoiceCatalogOperation,
    summary: (result) =>
      `${result.voices.length} voice${
        result.voices.length === 1 ? "" : "s"
      } available.`,
  }),
];

/* The cursor encoding the backgrounds endpoint uses. Repeated rather than
 * shared because the REST route owns the HTTP shape and this owns the tool
 * shape, and both are three lines over base64url — if a third caller appears
 * it moves into the operation. */
function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;

  const decoded = Number.parseInt(
    Buffer.from(cursor, "base64url").toString("utf8"),
    10,
  );
  return Number.isSafeInteger(decoded) && decoded >= 0 ? decoded : 0;
}

/**
 * SOURCE OF TRUTH KEYWORDS: listMcpTools, THE_SCHEMA_IS_GENERATED
 *
 * WHAT:  The `tools/list` payload.
 * WHY:   THE_SCHEMA_IS_GENERATED — each `inputSchema` came from the tool's own
 *        Zod schema, which is the same mechanism the OpenAPI document uses and
 *        for the same reason: a hand-written JSON Schema beside a Zod one is
 *        two descriptions that drift, and here the drift would mean a model
 *        sending arguments the server refuses.
 * WHERE: The route's `tools/list` branch.
 */
export function listMcpTools(): Record<string, unknown>[] {
  return MCP_TOOL_LIST.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

/**
 * SOURCE OF TRUTH KEYWORDS: callMcpTool, ONE_GATE_ORDER_TWO_SURFACES,
 *   AN_UNKNOWN_TOOL_IS_A_PROTOCOL_FAILURE, NO_IDEMPOTENCY_KEY_IN_A_TOOL_CALL
 *
 * WHAT:  Runs one tool and returns an MCP tool result — successful or
 *        `isError: true` — or reports that no such tool exists.
 *
 * WHY:   The sequence mirrors the REST pipeline because it calls the same
 *        functions: gate, validate, run, count. Only the rendering of a
 *        refusal differs.
 *
 *        AN_UNKNOWN_TOOL_IS_A_PROTOCOL_FAILURE, which is why that one case is
 *        reported separately rather than as a tool error. A name we do not
 *        have means the client is working from a `tools/list` it never read —
 *        the protocol is being used wrongly, not a tool failing — so the route
 *        turns it into a JSON-RPC `methodNotFound`.
 *
 *        NO_IDEMPOTENCY_KEY_IN_A_TOOL_CALL, stated rather than hidden: MCP has
 *        no header for one and no place for a model to put it, so this surface
 *        does NOT have the REST API's replay guarantee. What protects a
 *        customer from a duplicated render is the description telling the
 *        model not to retry (WORK_OUTLIVES_THE_CONNECTION) and the reuse rule,
 *        which makes a second identical render free. A second SCRIPT is not
 *        free, which is why that description carries the same caveat.
 * WHERE: The route's `tools/call` branch.
 */
export async function callMcpTool(args: {
  operation: OperationContext;
  name: string;
  arguments: Record<string, unknown>;
}): Promise<
  { unknownTool: true } | { unknownTool: false; result: Record<string, unknown> }
> {
  const tool = MCP_TOOL_LIST.find((entry) => entry.name === args.name);
  if (tool === undefined) return { unknownTool: true };

  /* ONE_GATE_ORDER_TWO_SURFACES — the same function the REST pipeline calls,
   * so the order and the messages cannot drift. */
  const entitlements = await checkApiEntitlements({
    organizationId: args.operation.organizationId,
    resource: tool.resource,
  });
  if (!entitlements.allowed) {
    return {
      unknownTool: false,
      result: mcpToolError(entitlements.refusal.message),
    };
  }

  return {
    unknownTool: false,
    result: await tool.invoke(args.operation, args.arguments),
  };
}

/** The tool names, for the tests and for the developers screen. */
export const MCP_TOOL_NAMES: readonly string[] = MCP_TOOL_LIST.map(
  (tool) => tool.name,
);
