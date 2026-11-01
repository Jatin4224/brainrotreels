/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: POST /api/mcp, mcpRoute, STATELESS_JSON_TRANSPORT,
 *   HTTP_CARRIES_THE_AUTH_FAILURE, A_NOTIFICATION_WANTS_NO_ANSWER,
 *   INSTRUCTIONS_ARE_READ_BY_THE_MODEL, ONE_AUTHENTICATION_TWO_SURFACES
 *
 * WHAT:  The MCP endpoint. One JSON-RPC message in, one JSON object out,
 *        authenticated with the same API key the REST surface takes.
 *
 * WHY:   STATELESS_JSON_TRANSPORT. MCP's Streamable HTTP transport allows a
 *        server to answer a POST with either a JSON object or an SSE stream,
 *        and to offer a GET stream for server-initiated messages. This server
 *        does neither of the streaming halves, because it has nothing to
 *        stream: there are no subscriptions, no sampling requests, no progress
 *        notifications and no sessions. Every tool call is a request and a
 *        reply. Opening an SSE channel to carry one response would be
 *        machinery with no message to put in it, and a session id would be
 *        state with nothing to remember.
 *
 *        That has a real consequence worth stating: a client that REQUIRES a
 *        GET stream will not work against this endpoint. The specification
 *        makes the stream optional and the clients that matter here (Claude,
 *        Cursor) POST happily, but if that changes, the fix is a GET handler
 *        that holds an SSE connection open — not a redesign.
 *
 *        HTTP_CARRIES_THE_AUTH_FAILURE. An unauthenticated call is answered
 *        with the HTTP status from the refusal — 401 with `WWW-Authenticate`,
 *        403 for a plan, 429 for a quota — and a JSON-RPC error body as well.
 *        Both layers then see something sensible: an MCP client's transport
 *        handles bearer failures at the HTTP level, which is where its own
 *        authorization flow looks, while anything reading the body still gets
 *        a well-formed JSON-RPC error rather than a bare page.
 *
 *        ONE_AUTHENTICATION_TWO_SURFACES — the key check, the revocation
 *        filter, the `apiAccess` flag and the per-key daily quota are the same
 *        function the REST pipeline calls. This file renders the refusal; it
 *        does not decide it.
 *
 *        A_NOTIFICATION_WANTS_NO_ANSWER: `notifications/initialized` carries
 *        no id and gets a 202 with an empty body. Answering it with a
 *        JSON-RPC response is a protocol violation that some clients treat as
 *        a hard error.
 *
 *        INSTRUCTIONS_ARE_READ_BY_THE_MODEL. The `initialize` result carries
 *        `instructions`, which is the one place to put the ORDER the tools go
 *        in. A model holding eight tool descriptions still has to work out
 *        that a render needs a script and a script needs a project; saying so
 *        once, up front, is cheaper than hoping it infers the sequence from
 *        eight independent sentences.
 * WHERE: Configured in an agent client as the MCP server URL, with the key as
 *        a bearer token. The developers screen shows the copy-paste config.
 */

import { authenticateApiKey } from "@/lib/api/authenticate";
import {
  JSON_RPC_ERRORS,
  jsonRpcError,
  jsonRpcResult,
  negotiateProtocolVersion,
  parseJsonRpcRequest,
  type JsonRpcResponse,
} from "@/lib/api/mcp";
import { callMcpTool, listMcpTools } from "@/lib/api/mcp-tools";
import { APP_NAME } from "@/lib/config/branding";
import { resolveRequestId } from "@/lib/observability";

/* The slowest tool is `generate_script`, which fetches the customer's source
 * before returning. The same reasoning as the REST script route, with room for
 * the handshake. */
export const maxDuration = 60;

/**
 * SOURCE OF TRUTH KEYWORDS: INSTRUCTIONS_ARE_READ_BY_THE_MODEL
 *
 * Read by the model once, at connection. It states the ORDER, because that is
 * the thing eight independent tool descriptions cannot convey — and it repeats
 * the two facts that cost money if ignored.
 */
const INSTRUCTIONS = [
  "Make short-form videos end to end.",
  "",
  "The order matters: create_project, then generate_script, then assign_voices",
  "for every speaker, then start_render. Poll get_render until it is finished,",
  "then fetch_output for a download link.",
  "",
  "Two things to hold on to. generate_script and start_render COST CREDITS and",
  "queue work that keeps running after the call returns, so never retry one",
  "because a connection dropped — poll instead. And anything a plan does not",
  "include comes back marked `locked` rather than hidden, so you can tell the",
  "person what upgrading would give them.",
].join("\n");

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return rpc(
      jsonRpcError(null, JSON_RPC_ERRORS.parse, "Expected a JSON body."),
      200,
      requestId,
    );
  }

  const parsed = parseJsonRpcRequest(payload);
  if (!parsed.ok) {
    return rpc(
      jsonRpcError(null, JSON_RPC_ERRORS.invalidRequest, parsed.message),
      200,
      requestId,
    );
  }

  const { id, method, params, isNotification } = parsed.request;

  /* A_NOTIFICATION_WANTS_NO_ANSWER. Checked before authentication, because a
   * notification has nowhere to put a refusal — and the only one we expect
   * carries no instruction to act on. */
  if (isNotification) {
    return new Response(null, { status: 202 });
  }

  const auth = await authenticateApiKey({
    authorization: request.headers.get("authorization"),
    requestId,
  });
  if (!auth.ok) {
    /* HTTP_CARRIES_THE_AUTH_FAILURE — the status AND a JSON-RPC body. */
    return rpc(
      jsonRpcError(id, JSON_RPC_ERRORS.invalidRequest, auth.refusal.message),
      auth.refusal.status,
      requestId,
      auth.refusal.headers,
    );
  }

  switch (method) {
    case "initialize":
      return rpc(
        jsonRpcResult(id, {
          protocolVersion: negotiateProtocolVersion(params["protocolVersion"]),
          /* Tools and nothing else — see STATELESS_JSON_TRANSPORT.
           * `listChanged: false` because the set is compiled in, so a client
           * that would otherwise subscribe knows not to. */
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: "brainrotreels",
            title: `${APP_NAME} video tools`,
            version: "1.0.0",
          },
          instructions: INSTRUCTIONS,
        }),
        200,
        requestId,
      );

    case "ping":
      /* The specification's keep-alive: an empty result is the whole answer. */
      return rpc(jsonRpcResult(id, {}), 200, requestId);

    case "tools/list":
      return rpc(
        jsonRpcResult(id, { tools: listMcpTools() }),
        200,
        requestId,
      );

    case "tools/call": {
      const name = params["name"];
      if (typeof name !== "string") {
        return rpc(
          jsonRpcError(
            id,
            JSON_RPC_ERRORS.invalidParams,
            "Expected `name` to be a tool name.",
          ),
          200,
          requestId,
        );
      }

      const rawArguments = params["arguments"];
      const toolArguments: Record<string, unknown> =
        rawArguments !== null &&
        typeof rawArguments === "object" &&
        !Array.isArray(rawArguments)
          ? { ...rawArguments }
          : {};

      const outcome = await callMcpTool({
        operation: auth.caller.operation,
        name,
        arguments: toolArguments,
      });

      /* AN_UNKNOWN_TOOL_IS_A_PROTOCOL_FAILURE — the client is working from a
       * tools/list it never read, which is not a tool failing. */
      if (outcome.unknownTool) {
        return rpc(
          jsonRpcError(
            id,
            JSON_RPC_ERRORS.methodNotFound,
            `No tool named "${name}". Call tools/list for the available tools.`,
          ),
          200,
          requestId,
        );
      }

      /* Everything else, including a refusal, is a SUCCESSFUL JSON-RPC
       * response carrying a tool result — see
       * A_TOOL_FAILURE_IS_NOT_A_PROTOCOL_FAILURE. */
      return rpc(jsonRpcResult(id, outcome.result), 200, requestId);
    }

    default:
      return rpc(
        jsonRpcError(
          id,
          JSON_RPC_ERRORS.methodNotFound,
          `This server does not implement "${method}". It exposes tools only.`,
        ),
        200,
        requestId,
      );
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: GET /api/mcp, STATELESS_JSON_TRANSPORT
 *
 * WHAT:  Refuses the SSE stream this server does not offer.
 * WHY:   A GET on an MCP endpoint means "open a stream for server-initiated
 *        messages", and this server never initiates any. Answering 405 with a
 *        reason is how a client learns that in one request, rather than
 *        holding a connection open waiting for messages that will never come.
 *        The `Allow` header says what to do instead.
 */
export function GET(): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: JSON_RPC_ERRORS.invalidRequest,
        message:
          "This MCP server is request/response only and offers no event stream. POST a JSON-RPC message instead.",
      },
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: DELETE /api/mcp, STATELESS_JSON_TRANSPORT
 *
 * A DELETE ends a session, and this server has none to end — every call stands
 * alone. Answered rather than left to Next's bodiless 405 so a client that
 * tries to clean up gets a sentence explaining there was nothing to clean.
 */
export function DELETE(): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: JSON_RPC_ERRORS.invalidRequest,
        message:
          "This MCP server is stateless, so there is no session to terminate.",
      },
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}

/* One place that writes a JSON-RPC response, so the content type, the cache
 * header and the request id cannot differ between branches. The request id
 * goes in a HEADER rather than the body, because the body shape belongs to
 * JSON-RPC and adding a field to it would be our own extension. */
function rpc(
  body: JsonRpcResponse,
  status: number,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "x-request-id": requestId,
      ...headers,
    },
  });
}
