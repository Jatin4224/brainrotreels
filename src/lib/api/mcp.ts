/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: JSON_RPC_ERRORS, jsonRpcResult, jsonRpcError,
 *   parseJsonRpcRequest, negotiateProtocolVersion, mcpToolResult, mcpToolError,
 *   NO_SDK_FOR_A_STATELESS_SERVER, A_TOOL_FAILURE_IS_NOT_A_PROTOCOL_FAILURE,
 *   STRUCTURED_PLUS_A_SENTENCE
 *
 * WHAT:  The JSON-RPC 2.0 and MCP envelopes the `/api/mcp` endpoint speaks.
 *        Pure: no request, no database, no operations.
 *
 * WHY:   NO_SDK_FOR_A_STATELESS_SERVER, and this is the decision to argue with
 *        first. `@modelcontextprotocol/sdk` is not a dependency of this
 *        project and was not added, which deserves a reason rather than a
 *        shrug.
 *
 *        What this server is: seven tools, no resources, no prompts, no
 *        sampling, no roots, no server-initiated messages, no sessions. Every
 *        call is one POST in and one JSON object out. The protocol surface
 *        that leaves is three methods — `initialize`, `tools/list`,
 *        `tools/call` — plus a notification to ignore and a ping to answer.
 *        That is this file, and it is testable without a transport.
 *
 *        What the SDK is mostly for is the part we do not use: session
 *        management, the SSE stream for server-initiated messages, and the
 *        client side. Taking it would put a dependency with a moving API into
 *        a route handler that runs on every agent call, to save about a
 *        hundred lines of envelope construction, and would make the wire
 *        format something we read from a changelog rather than from a file.
 *
 *        The honest limit, stated so the next person can reverse this: the
 *        moment this server needs RESOURCES, PROMPTS, SAMPLING or a
 *        server-initiated stream, the SDK becomes the right answer and this
 *        file becomes a liability. It is sized for exactly what step 14 asks
 *        for.
 *
 *        A_TOOL_FAILURE_IS_NOT_A_PROTOCOL_FAILURE is the distinction that
 *        matters most to an agent, and the one most often got wrong. A tool
 *        that could not do its job — no such project, not enough credits —
 *        returns a SUCCESSFUL JSON-RPC response carrying `isError: true` and
 *        the message, because the model is supposed to READ that and adapt. A
 *        JSON-RPC error is for the protocol being broken: an unknown method,
 *        a malformed envelope. Reporting "not enough credits" as a JSON-RPC
 *        error hides it from the model inside the client's transport layer,
 *        where it becomes "the tool call failed" with no way to act on it.
 *
 *        STRUCTURED_PLUS_A_SENTENCE is the phase's step 15 — "results are
 *        structured JSON plus a one-line human summary" — and MCP's own result
 *        shape fits it exactly: `content` is what a person watching the agent
 *        reads, `structuredContent` is what the agent parses. Sending only one
 *        of them makes the transcript unreadable or the data unusable.
 * WHERE: src/app/api/mcp/route.ts, and src/lib/api/mcp-tools.ts.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: MCP_PROTOCOL_VERSIONS, negotiateProtocolVersion
 *
 * The revisions this server can speak, newest first. MCP versions its spec by
 * DATE and the handshake is a negotiation rather than an assertion: the client
 * states what it wants and the server answers with what it will actually use.
 *
 * Listing more than one matters because agent clients upgrade on their own
 * schedule. A server that answered only with its newest version would refuse
 * a client that is six weeks behind, for no reason — the tool surface is
 * identical across these revisions.
 */
export const MCP_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export type McpProtocolVersion = (typeof MCP_PROTOCOL_VERSIONS)[number];

/** What we answer with when the client asks for something we do not know. */
export const MCP_DEFAULT_PROTOCOL_VERSION: McpProtocolVersion =
  MCP_PROTOCOL_VERSIONS[0];

/**
 * SOURCE OF TRUTH KEYWORDS: negotiateProtocolVersion, ECHO_WHAT_WE_SUPPORT
 *
 * WHAT:  The version this session will use.
 * WHY:   ECHO_WHAT_WE_SUPPORT. The client's request is honoured when we know
 *        it, because a client that asked for a revision and was answered with
 *        a different one has to decide whether to continue — and most will
 *        simply work with what they asked for. When we do not know it we
 *        answer with our newest rather than failing: the client then decides,
 *        which is what the specification asks of both sides.
 * WHERE: The `initialize` handler.
 */
export function negotiateProtocolVersion(
  requested: unknown,
): McpProtocolVersion {
  const supported: readonly string[] = MCP_PROTOCOL_VERSIONS;
  return typeof requested === "string" && supported.includes(requested)
    ? (requested as McpProtocolVersion)
    : MCP_DEFAULT_PROTOCOL_VERSION;
}

/**
 * SOURCE OF TRUTH KEYWORDS: JSON_RPC_ERRORS
 *
 * The standard codes, used for their standard meanings. They are part of
 * JSON-RPC rather than of MCP, which is why they are numbers rather than our
 * own vocabulary — a client's transport layer branches on these before any MCP
 * code sees them.
 */
export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export type JsonRpcErrorCode =
  (typeof JSON_RPC_ERRORS)[keyof typeof JSON_RPC_ERRORS];

/** A JSON-RPC id is a string, a number, or absent for a notification. */
export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params: Record<string, unknown>;
  /** True when the message carried no id and therefore wants no response. */
  isNotification: boolean;
}

/**
 * SOURCE OF TRUTH KEYWORDS: parseJsonRpcRequest, A_NOTIFICATION_WANTS_NO_ANSWER
 *
 * WHAT:  One JSON-RPC message, or why it is not one.
 *
 * WHY:   A_NOTIFICATION_WANTS_NO_ANSWER. `notifications/initialized` arrives
 *        with no `id`, and answering it is a protocol violation that some
 *        clients treat as a hard error. So the absence of an id is carried
 *        explicitly rather than defaulted to something, and the caller decides
 *        to stay silent.
 *
 *        Batches are deliberately NOT supported: the 2025-06-18 revision
 *        removed them, and accepting an array here would mean implementing
 *        semantics the current specification does not have.
 * WHERE: The route handler, on every POST.
 */
export function parseJsonRpcRequest(
  payload: unknown,
): { ok: true; request: JsonRpcRequest } | { ok: false; message: string } {
  if (Array.isArray(payload)) {
    return {
      ok: false,
      message:
        "Batched requests are not supported. Send one JSON-RPC message per request.",
    };
  }

  if (payload === null || typeof payload !== "object") {
    return { ok: false, message: "Expected a JSON-RPC object." };
  }

  const record: Record<string, unknown> = { ...payload };

  if (record["jsonrpc"] !== "2.0") {
    return { ok: false, message: 'Expected `jsonrpc` to be "2.0".' };
  }

  const method = record["method"];
  if (typeof method !== "string" || method.length === 0) {
    return { ok: false, message: "Expected a `method` name." };
  }

  const rawId = record["id"];
  const hasId = "id" in record && rawId !== null && rawId !== undefined;
  if (hasId && typeof rawId !== "string" && typeof rawId !== "number") {
    return { ok: false, message: "`id` must be a string or a number." };
  }

  const rawParams = record["params"];
  const params: Record<string, unknown> =
    rawParams !== null && typeof rawParams === "object" && !Array.isArray(rawParams)
      ? { ...rawParams }
      : {};

  return {
    ok: true,
    request: {
      id: hasId ? (rawId as string | number) : null,
      method,
      params,
      isNotification: !hasId,
    },
  };
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: Record<string, unknown>;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: { code: number; message: string };
}

/**
 * SOURCE OF TRUTH KEYWORDS: JsonRpcResponse
 *
 * Either answer. Named so the transport can hold one without widening it to
 * `Record<string, unknown>`, which would let a malformed envelope through the
 * one function whose job is to write well-formed ones.
 */
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export function jsonRpcResult(
  id: JsonRpcId,
  result: Record<string, unknown>,
): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

export function jsonRpcError(
  id: JsonRpcId,
  code: JsonRpcErrorCode,
  message: string,
): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * SOURCE OF TRUTH KEYWORDS: mcpToolResult, STRUCTURED_PLUS_A_SENTENCE
 *
 * WHAT:  A successful tool call: one sentence for a person, the data for the
 *        agent.
 * WHY:   See STRUCTURED_PLUS_A_SENTENCE in the file header. `content` is
 *        rendered in the transcript a person is watching; `structuredContent`
 *        is what the model reads fields out of. The same information twice, in
 *        two registers, because the two readers need different things.
 * WHERE: Every tool's success path.
 */
export function mcpToolResult(
  summary: string,
  data: unknown,
): Record<string, unknown> {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: { result: data },
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: mcpToolError, A_TOOL_FAILURE_IS_NOT_A_PROTOCOL_FAILURE
 *
 * WHAT:  A tool that could not do its job.
 * WHY:   `isError: true` inside a SUCCESSFUL JSON-RPC response — see the file
 *        header. The message is the operation's own customer-facing sentence,
 *        because that is already written for a reader and is the thing a model
 *        can act on ("not enough credits" is actionable; "tool call failed" is
 *        not).
 * WHERE: The dispatcher, for every operation failure and refusal.
 */
export function mcpToolError(message: string): Record<string, unknown> {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
