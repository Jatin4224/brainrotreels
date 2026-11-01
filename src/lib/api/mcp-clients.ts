/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: McpClientConfig, mcpClientConfigs, MCP_SERVER_LABEL,
 *   THE_CONFIG_IS_COPY_PASTE, A_CLIENT_NEEDS_ITS_OWN_BLOCK,
 *   THE_KEY_IS_A_PLACEHOLDER, NOT_SERVER_ONLY_ON_PURPOSE
 *
 * WHAT:  The configuration each agent client needs to reach this MCP server,
 *        one entry per client, with the file it goes in.
 *
 * WHY:   THE_CONFIG_IS_COPY_PASTE is the phase's step 17, and the gap it
 *        closes is specific: a single generic `mcpServers` block is correct
 *        for nobody. The JSON is nearly the same across clients, but the thing
 *        a person is actually stuck on is WHERE IT GOES — Claude Desktop reads
 *        a different file from Cursor, and Claude Code does not want a file at
 *        all, it wants a command. Shipping one block and leaving the location
 *        to the reader is where an integration stalls.
 *
 *        A_CLIENT_NEEDS_ITS_OWN_BLOCK, so each entry carries its own `path`
 *        (or `command`) alongside its snippet, and the UI renders them as
 *        separate labelled blocks rather than one block with a paragraph of
 *        caveats.
 *
 *        THE_KEY_IS_A_PLACEHOLDER in every snippet, never the customer's real
 *        key. A live credential inside a block that also gets screenshotted,
 *        pasted into a ticket and committed to a dotfiles repo is how keys
 *        leak, and the real one is shown once on the developers screen where
 *        the warning about it is.
 *
 *        NOT_SERVER_ONLY_ON_PURPOSE, which is the one deliberate deviation
 *        from the rule that `src/lib/api/` is server-side. This module reads
 *        nothing, touches no database and holds no secret — it formats a
 *        string from an origin. The developers panel is a CLIENT component and
 *        has to render these, so marking it `server-only` would force either a
 *        duplicate copy in the panel or a pointless prop drill of
 *        pre-rendered JSON. `mcp-tools.ts` next door stays `server-only`
 *        because it holds the dispatcher.
 * WHERE: The developers screen (`/dashboard/settings/developers`) and the
 *        public API reference (`/docs/api`).
 */

import { APP_SLUG } from "@/lib/config/branding";

/**
 * The name the server appears under in a client's tool list. The app's slug,
 * so a person with several MCP servers configured can tell which is which, and
 * so renaming the product does not leave a stale name in a shipped snippet.
 */
export const MCP_SERVER_LABEL = APP_SLUG;

/** The placeholder every snippet uses in place of a real key. */
export const MCP_KEY_PLACEHOLDER = "brr_live_…";

export interface McpClientConfig {
  /** The client, as a person refers to it. */
  client: string;
  /**
   * Where the snippet goes: a config file path, or the command to run. One or
   * the other is the thing the reader is missing — see
   * A_CLIENT_NEEDS_ITS_OWN_BLOCK.
   */
  target: string;
  /** `json` or `bash`, for the block's header label. */
  language: "json" | "bash";
  /** The snippet itself, with the deployment's real origin in it. */
  snippet: string;
  /** One sentence of what to do after pasting it. */
  note: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: mcpClientConfigs, THE_ORIGIN_IS_PASSED_IN
 *
 * WHAT:  Every client's configuration, for this deployment.
 * WHY:   THE_ORIGIN_IS_PASSED_IN rather than read from the environment, so a
 *        preview deployment hands out its own URL and this module stays pure
 *        enough for a test and for a client component. Same argument as
 *        `buildOpenApiDocument`.
 *
 *        A function rather than a constant because the origin is the one thing
 *        that varies, and a constant would have to be built at module load
 *        from an environment variable that is wrong on every preview.
 * WHERE: See the file header.
 */
export function mcpClientConfigs(origin: string): McpClientConfig[] {
  const url = `${origin}/api/mcp`;

  /* The remote-server shape both desktop clients read: a named entry with a
   * url and the headers to send with every request. */
  const jsonBlock = JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_LABEL]: {
          url,
          headers: { Authorization: `Bearer ${MCP_KEY_PLACEHOLDER}` },
        },
      },
    },
    null,
    2,
  );

  return [
    {
      client: "Claude Code",
      target: "Run this in your terminal",
      language: "bash",
      /* A command, not a file. Claude Code owns its own config and editing it
       * by hand is the path that goes wrong. */
      snippet: `claude mcp add --transport http ${MCP_SERVER_LABEL} ${url} \\\n  --header "Authorization: Bearer ${MCP_KEY_PLACEHOLDER}"`,
      note: "Replace the placeholder with a key from above. Check it worked with `claude mcp list`.",
    },
    {
      client: "Claude Desktop",
      target:
        "~/Library/Application Support/Claude/claude_desktop_config.json (macOS) · %APPDATA%\\Claude\\claude_desktop_config.json (Windows)",
      language: "json",
      snippet: jsonBlock,
      note: "Merge this into the file's existing `mcpServers` object, then restart Claude Desktop.",
    },
    {
      client: "Cursor",
      target: "~/.cursor/mcp.json, or .cursor/mcp.json inside a project",
      language: "json",
      snippet: jsonBlock,
      note: "The project-local file wins where both exist. Cursor picks the change up without a restart.",
    },
  ];
}
