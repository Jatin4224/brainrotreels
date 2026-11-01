/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: mcp test, parseJsonRpcRequest, negotiateProtocolVersion,
 *   mcpToolResult, mcpToolError, A_NOTIFICATION_WANTS_NO_ANSWER,
 *   STRUCTURED_PLUS_A_SENTENCE, THE_DESCRIPTION_IS_THE_INTERFACE,
 *   WORK_OUTLIVES_THE_CONNECTION
 *
 * WHAT:  That the JSON-RPC envelopes are well-formed, that a notification is
 *        recognised as wanting no answer, that version negotiation honours a
 *        client we support, and that every tool carries the things a model
 *        depends on.
 *
 * WHY:   Writing the protocol by hand instead of taking the SDK means the
 *        protocol is ours to get right, so the parts a client's transport
 *        layer is strict about are tested rather than assumed. The two that
 *        bite are A_NOTIFICATION_WANTS_NO_ANSWER — answering
 *        `notifications/initialized` is a violation some clients treat as a
 *        hard error — and the `jsonrpc` field, which a client will reject the
 *        whole message over.
 *
 *        THE_DESCRIPTION_IS_THE_INTERFACE is asserted because it is the one
 *        part of this surface that cannot be checked by a type. A tool
 *        description is the entire interface a MODEL sees; a tool added without
 *        the asynchronous caveat is a tool an agent will retry, and a retried
 *        `start_render` is a second paid render. Nothing else in the codebase
 *        would notice.
 * WHERE: `npm test`.
 */

import { describe, expect, it } from "vitest";

import {
  JSON_RPC_ERRORS,
  MCP_DEFAULT_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  jsonRpcError,
  jsonRpcResult,
  mcpToolError,
  mcpToolResult,
  negotiateProtocolVersion,
  parseJsonRpcRequest,
} from "./mcp";
import { MCP_TOOL_NAMES, listMcpTools } from "./mcp-tools";

describe("parsing a JSON-RPC message", () => {
  it("accepts a well-formed request", () => {
    const parsed = parseJsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.method).toBe("tools/list");
    expect(parsed.request.id).toBe(1);
    expect(parsed.request.isNotification).toBe(false);
  });

  it("recognises a notification as wanting no answer", () => {
    /* A_NOTIFICATION_WANTS_NO_ANSWER — answering this is a protocol violation
     * that some clients treat as a hard error. */
    const parsed = parseJsonRpcRequest({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.isNotification).toBe(true);
    expect(parsed.request.id).toBeNull();
  });

  it("treats an explicit null id as a notification", () => {
    /* Some clients send `id: null` rather than omitting it. Both mean "do not
     * answer", and treating the first as a request would send a response to a
     * message that wants none. */
    const parsed = parseJsonRpcRequest({
      jsonrpc: "2.0",
      id: null,
      method: "notifications/initialized",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.isNotification).toBe(true);
  });

  it("accepts a string id, which the specification allows", () => {
    const parsed = parseJsonRpcRequest({
      jsonrpc: "2.0",
      id: "abc",
      method: "ping",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.id).toBe("abc");
  });

  it("defaults missing or malformed params to an empty object", () => {
    /* So every handler can read `params["x"]` without guarding. */
    for (const params of [undefined, null, "nonsense", [1, 2]]) {
      const parsed = parseJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params,
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.request.params).toEqual({});
    }
  });

  it("refuses a message without the version marker", () => {
    expect(parseJsonRpcRequest({ id: 1, method: "ping" }).ok).toBe(false);
    expect(
      parseJsonRpcRequest({ jsonrpc: "1.0", id: 1, method: "ping" }).ok,
    ).toBe(false);
  });

  it("refuses a message with no method", () => {
    expect(parseJsonRpcRequest({ jsonrpc: "2.0", id: 1 }).ok).toBe(false);
    expect(
      parseJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "" }).ok,
    ).toBe(false);
  });

  it("refuses an id that is neither a string nor a number", () => {
    expect(
      parseJsonRpcRequest({ jsonrpc: "2.0", id: { a: 1 }, method: "ping" }).ok,
    ).toBe(false);
  });

  it("refuses a batch, which the current revision removed", () => {
    const parsed = parseJsonRpcRequest([
      { jsonrpc: "2.0", id: 1, method: "ping" },
    ]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("Batched");
  });

  it("refuses something that is not an object", () => {
    expect(parseJsonRpcRequest(null).ok).toBe(false);
    expect(parseJsonRpcRequest("ping").ok).toBe(false);
    expect(parseJsonRpcRequest(7).ok).toBe(false);
  });
});

describe("version negotiation", () => {
  it("echoes a version we support", () => {
    /* ECHO_WHAT_WE_SUPPORT — a client that asked for a revision and got a
     * different one has to decide whether to continue. */
    for (const version of MCP_PROTOCOL_VERSIONS) {
      expect(negotiateProtocolVersion(version)).toBe(version);
    }
  });

  it("answers with our newest for anything else", () => {
    expect(negotiateProtocolVersion("1999-01-01")).toBe(
      MCP_DEFAULT_PROTOCOL_VERSION,
    );
    expect(negotiateProtocolVersion(undefined)).toBe(
      MCP_DEFAULT_PROTOCOL_VERSION,
    );
    expect(negotiateProtocolVersion(42)).toBe(MCP_DEFAULT_PROTOCOL_VERSION);
  });

  it("supports more than one revision, because clients upgrade slowly", () => {
    expect(MCP_PROTOCOL_VERSIONS.length).toBeGreaterThan(1);
  });
});

describe("the response envelopes", () => {
  it("builds a result with the version marker and the id", () => {
    expect(jsonRpcResult(7, { tools: [] })).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { tools: [] },
    });
  });

  it("builds an error with a standard code", () => {
    expect(jsonRpcError(7, JSON_RPC_ERRORS.methodNotFound, "No such thing")).toEqual(
      {
        jsonrpc: "2.0",
        id: 7,
        error: { code: -32601, message: "No such thing" },
      },
    );
  });

  it("uses the standard JSON-RPC code numbers", () => {
    /* A client's transport branches on these before any MCP code sees them, so
     * they are not ours to choose. */
    expect(JSON_RPC_ERRORS).toEqual({
      parse: -32700,
      invalidRequest: -32600,
      methodNotFound: -32601,
      invalidParams: -32602,
      internal: -32603,
    });
  });
});

describe("a tool result", () => {
  it("carries a sentence for a person and the data for the agent", () => {
    /* STRUCTURED_PLUS_A_SENTENCE — the phase's step 15. */
    const result = mcpToolResult("Created project \"Demo\".", { id: "p_1" });

    expect(result["content"]).toEqual([
      { type: "text", text: 'Created project "Demo".' },
    ]);
    expect(result["structuredContent"]).toEqual({ result: { id: "p_1" } });
    expect(result["isError"]).toBeUndefined();
  });

  it("marks a failure as a tool error rather than throwing", () => {
    /* A_TOOL_FAILURE_IS_NOT_A_PROTOCOL_FAILURE — the model has to be able to
     * read this and adapt. */
    const result = mcpToolError("Not enough credits.");

    expect(result["isError"]).toBe(true);
    expect(result["content"]).toEqual([
      { type: "text", text: "Not enough credits." },
    ]);
    /* No structured content on an error: there is no data, and an empty object
     * would have a model looking for fields in it. */
    expect(result["structuredContent"]).toBeUndefined();
  });
});

describe("the tool catalogue", () => {
  const tools = listMcpTools();

  it("exposes every tool the phase file names", () => {
    /* The names are a public contract — renaming one breaks every agent
     * configuration that mentions it. */
    for (const name of [
      "create_project",
      "generate_script",
      "assign_voices",
      "start_render",
      "get_render",
      "fetch_output",
      "list_backgrounds",
    ]) {
      expect(MCP_TOOL_NAMES).toContain(name);
    }
  });

  it("lists each tool once", () => {
    expect(new Set(MCP_TOOL_NAMES).size).toBe(MCP_TOOL_NAMES.length);
  });

  it("gives every tool a name, a title, a description and a schema", () => {
    expect(tools.length).toBe(MCP_TOOL_NAMES.length);

    for (const tool of tools) {
      expect(typeof tool["name"]).toBe("string");
      expect(typeof tool["title"]).toBe("string");
      /* THE_DESCRIPTION_IS_THE_INTERFACE — a model has nothing else to go on,
       * so a one-word description is a tool it will use wrongly. */
      expect(String(tool["description"]).length).toBeGreaterThan(60);

      const schema = tool["inputSchema"];
      expect(schema).toBeTypeOf("object");
      expect(JSON.stringify(schema)).not.toContain("$schema");
    }
  });

  it("warns the model that paid work outlives the connection", () => {
    /**
     * WORK_OUTLIVES_THE_CONNECTION — step 16, and the assertion that earns its
     * place. The two tools that queue durable paid work must say so, because
     * an agent that retries one after a dropped connection has started a
     * second render or paid for a second script. Nothing else would catch a
     * tool added without the caveat.
     */
    for (const name of ["generate_script", "start_render"]) {
      const tool = tools.find((entry) => entry["name"] === name);
      expect(tool, name).toBeDefined();
      expect(String(tool?.["description"]), name).toContain("do not retry");
    }
  });

  it("tells the model which tools cost credits", () => {
    for (const name of ["generate_script", "start_render"]) {
      const tool = tools.find((entry) => entry["name"] === name);
      expect(String(tool?.["description"]), name).toContain("COSTS CREDITS");
    }
  });

  it("describes the schema that only Zod knows", () => {
    /* THE_SCHEMA_IS_GENERATED — the same evidence the OpenAPI test looks for:
     * a constraint a hand-written schema would not have carried. */
    const create = tools.find((entry) => entry["name"] === "create_project");
    const schema = create?.["inputSchema"] as
      | { properties?: Record<string, { minLength?: number }> }
      | undefined;

    expect(schema?.properties?.["title"]?.minLength).toBe(1);
  });

  it("never asks a model for an organizationId", () => {
    /* THE_KEY_SUPPLIES_THE_TENANT — a tool argument for it would be a model
     * guessing at tenancy. */
    expect(JSON.stringify(tools)).not.toContain("organizationId");
  });
});
