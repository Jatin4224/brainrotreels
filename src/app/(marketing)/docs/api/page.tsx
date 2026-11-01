/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: ApiDocsPage, THE_PAGE_IS_THE_DOCUMENT,
 *   DOCS_ARE_PUBLIC, THE_CONVENTIONS_ARE_THE_HALF_NOBODY_DOCUMENTS,
 *   THEME_TOKENS_ONLY
 *
 * WHAT:  /docs/api — the human-readable API reference: how to authenticate,
 *        the conventions every endpoint shares, every endpoint with its
 *        parameters, the error vocabulary, and the MCP server.
 *
 * WHY:   DOCS_ARE_PUBLIC, which is why this is in the `(marketing)` group and
 *        not under `/dashboard`. Somebody deciding whether to integrate needs
 *        this BEFORE they have an account, and the group's NO_AUTH_IN_THIS_GROUP
 *        rule is exactly the property that lets it be served to an anonymous
 *        visitor. It contains no customer data — it describes shapes.
 *
 *        THE_PAGE_IS_THE_DOCUMENT. Every endpoint, parameter, type and error
 *        code here is read out of `buildOpenApiDocument` through
 *        `buildApiReference`. Nothing on this page is a second hand-written
 *        list, because a hand-written reference beside a generated OpenAPI
 *        document is the same drift the generator exists to prevent — it would
 *        simply be wrong in HTML instead of in JSON.
 *
 *        THE_CONVENTIONS_ARE_THE_HALF_NOBODY_DOCUMENTS, and they are the only
 *        prose written here. An endpoint list tells a reader what exists; the
 *        envelope, the idempotency header, the opaque cursor and the fact that
 *        quotas are SHARED with the dashboard are what they get wrong at
 *        three in the morning, and OpenAPI has no field for any of them.
 *
 *        THEME_TOKENS_ONLY throughout, so the reference is legible in both
 *        themes like every other surface.
 * WHERE: Linked from the marketing header and footer, and from the developers
 *        screen.
 */

import type { Metadata } from "next";

import { CodeBlock } from "@/components/global/code-block";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { mcpClientConfigs, MCP_KEY_PLACEHOLDER } from "@/lib/api/mcp-clients";
import {
  buildApiReference,
  type ApiReferenceEndpoint,
  type ApiReferenceParameter,
} from "@/lib/api/reference";
import { APP_NAME, APP_URL } from "@/lib/config/branding";

export const metadata: Metadata = {
  title: "API reference",
  description: `Create projects, write scripts, assign voices and render videos with the ${APP_NAME} API.`,
};

/**
 * SOURCE OF TRUTH KEYWORDS: CONVENTIONS, THE_CONVENTIONS_ARE_THE_HALF_NOBODY_DOCUMENTS
 *
 * The facts that hold for every endpoint. Written here rather than derived
 * because they are properties of the API as a whole — see the file header for
 * why that is the one thing this page is allowed to write itself.
 */
const CONVENTIONS = [
  {
    title: "One envelope, every response",
    body: "A success is `{ data, requestId }`. A failure is `{ error: { code, message }, requestId }`. There is no third shape, including for a 401 or a 405, so a client writes one parser.",
  },
  {
    title: "requestId is always present",
    body: "On successes as well as failures. Quote it in a support message and an operator can find the exact request in the logs.",
  },
  {
    title: "Idempotency-Key on every POST",
    body: "Send a unique string per request. Repeating a request with the same key replays the original response instead of doing the work twice — and a replay is never charged. Reusing a key for a different payload is a 409.",
  },
  {
    title: "Cursors are opaque",
    body: "Send `nextCursor` back as `cursor` untouched. It is a string today and may stop being an offset tomorrow; a client that parses it is relying on something never promised. `nextCursor` is null on the last page.",
  },
  {
    title: "Quotas are shared with the dashboard",
    body: "A render started through the API counts against the same monthly limit the dashboard counts against, because it is the same video on the same plan. This is intended: a key cannot be used to get a second allowance.",
  },
  {
    title: "A 429 tells you when to come back",
    body: "Both kinds of limit — a key's daily quota and a plan's monthly quota — answer with `RateLimit-Reset` and `Retry-After`, and the message names the reset time. Wait for it rather than retrying on a timer of your own.",
  },
  {
    title: "Work outlives the connection",
    body: "Scripts and renders return as soon as they are queued. Closing the connection cancels nothing, so poll the resource rather than retrying the request.",
  },
] as const;

/**
 * SOURCE OF TRUTH KEYWORDS: ApiDocsPage, NO_AUTH_IN_THIS_GROUP,
 *   THE_CONFIGURED_URL_KEEPS_THIS_STATIC
 *
 * THE_CONFIGURED_URL_KEEPS_THIS_STATIC, and it is the one deliberate
 * difference from the developers screen, which resolves the request's own
 * origin. The `(marketing)` group's contract is that nothing beneath it reads
 * `headers()` or a cookie, so the whole group stays static and serves an
 * anonymous visitor at landing-page speed — and a single `headers()` call here
 * would opt this page out of that silently.
 *
 * So the base URL is the CONFIGURED one. The cost is that a preview deployment
 * shows the production URL in its snippets, which for a public reference page
 * is the right trade: the audience is somebody deciding whether to integrate,
 * and the URL they should be copying is the real one. The developers screen
 * inside the dashboard is where a customer gets their own deployment's origin,
 * and that page is already dynamic.
 */
export default function ApiDocsPage() {
  const reference = buildApiReference(APP_URL);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-12">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {reference.title}
          </h1>
          <Badge variant="outline">v{reference.version}</Badge>
        </div>
        <p className="text-muted-foreground">{reference.description}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Authentication</h2>
        <p className="text-muted-foreground text-sm">
          {reference.authDescription}
        </p>
        <CodeBlock
          language="bash"
          copyLabel="Command copied."
          code={`curl ${reference.serverUrl}/api/v1/catalog/voices \\
  -H "Authorization: Bearer ${MCP_KEY_PLACEHOLDER}"`}
          caption={
            <>
              Every endpoint is relative to{" "}
              <code className="font-mono text-xs">{reference.serverUrl}</code>.
              Create a key under Settings → Developers; it acts for the whole
              workspace, and revoking it takes effect immediately.
            </>
          }
        />
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight">Conventions</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {CONVENTIONS.map((convention) => (
            <Card key={convention.title}>
              <CardContent className="flex flex-col gap-1 py-4">
                <p className="text-sm font-medium">{convention.title}</p>
                <p className="text-muted-foreground text-sm">
                  {convention.body}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">Endpoints</h2>
          <p className="text-muted-foreground text-sm">
            In the order you would use them: create a project, write a script,
            cast the voices, render, collect the file. The catalogues tell you
            what you may choose from.
          </p>
        </div>

        {reference.endpoints.map((endpoint) => (
          <EndpointSection
            key={`${endpoint.method} ${endpoint.path}`}
            endpoint={endpoint}
            origin={reference.serverUrl}
          />
        ))}
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">Errors</h2>
          <p className="text-muted-foreground text-sm">
            Branch on <code className="font-mono text-xs">error.code</code>, not
            on the status or the message. A code is stable; the copy is written
            for a person and improves.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {reference.errorCodes.map((code) => (
            <Badge key={code} variant="secondary" className="font-mono">
              {code}
            </Badge>
          ))}
        </div>

        <div className="min-w-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Status</TableHead>
                <TableHead>Means</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reference.errorStatuses.map((entry) => (
                <TableRow key={entry.status}>
                  <TableCell className="font-mono text-xs">
                    {entry.status}
                  </TableCell>
                  <TableCell className="text-sm">{entry.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <Separator />

      {/* The MCP server is the same operations over a different transport, so
          it belongs in the same reference rather than in a page of its own —
          an agent author and an API author are the same reader. */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">
            Agents (MCP)
          </h2>
          <p className="text-muted-foreground text-sm">
            The same verbs as tools, authenticated with the same key, over the
            Model Context Protocol at{" "}
            <code className="font-mono text-xs">
              {reference.serverUrl}/api/mcp
            </code>
            . Quotas and entitlements are shared with the REST API and the
            dashboard.
          </p>
        </div>

        {mcpClientConfigs(reference.serverUrl).map((config) => (
          <div key={config.client} className="flex flex-col gap-1.5">
            <div>
              <p className="text-sm font-medium">{config.client}</p>
              <p className="text-muted-foreground font-mono text-xs break-all">
                {config.target}
              </p>
            </div>
            <CodeBlock
              language={config.language}
              code={config.snippet}
              caption={config.note}
              copyLabel={`${config.client} config copied.`}
            />
          </div>
        ))}
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold tracking-tight">
          Generate a client
        </h2>
        <p className="text-muted-foreground text-sm">
          The OpenAPI 3.1 description is generated from the same schemas the
          endpoints validate with, so a generated client cannot disagree with
          the server. Point your generator at it rather than hand-writing
          types.
        </p>
        <CodeBlock
          language="http"
          copyLabel="URL copied."
          code={`${reference.serverUrl}/api/v1/openapi.json`}
        />
      </section>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: EndpointSection, A_REFERENCE_ROW_IS_A_TABLE
 *
 * WHAT:  One endpoint: its method and path, what it does, and every field it
 *        takes.
 * WHY:   A_REFERENCE_ROW_IS_A_TABLE. Parameters and body fields are the same
 *        four facts — name, where it goes, whether it is required, its type —
 *        so they render as one table with a `where` column rather than as two
 *        sections a reader has to cross-reference. The path parameters and the
 *        `Idempotency-Key` header then appear beside the body fields, which is
 *        how somebody actually builds the request.
 * WHERE: This page, once per endpoint from the document.
 */
function EndpointSection({
  endpoint,
  origin,
}: {
  endpoint: ApiReferenceEndpoint;
  origin: string;
}) {
  const fields: ApiReferenceParameter[] = [
    ...endpoint.parameters,
    ...endpoint.body,
  ];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={endpoint.method === "GET" ? "secondary" : "default"}
              className="font-mono"
            >
              {endpoint.method}
            </Badge>
            <code className="font-mono text-sm break-all">{endpoint.path}</code>
          </div>
          <p className="text-sm font-medium">{endpoint.summary}</p>
          {endpoint.description !== null && (
            <p className="text-muted-foreground text-sm">
              {endpoint.description}
            </p>
          )}
          {endpoint.success !== null && (
            <p className="text-muted-foreground text-sm">
              <span className="font-mono text-xs">
                {endpoint.success.status}
              </span>{" "}
              — {endpoint.success.description}
            </p>
          )}
        </div>

        {fields.length > 0 && (
          <div className="min-w-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead className="w-20">Where</TableHead>
                  <TableHead className="w-24">Required</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field) => (
                  <TableRow key={`${field.location}:${field.name}`}>
                    <TableCell className="font-mono text-xs">
                      {field.name}
                      {field.description !== null && (
                        <span className="text-muted-foreground block font-sans text-xs">
                          {field.description}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {field.location}
                    </TableCell>
                    <TableCell className="text-xs">
                      {field.required ? "yes" : "no"}
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all">
                      {field.type}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <CodeBlock
          language="bash"
          copyLabel="Command copied."
          code={curlFor(endpoint, origin)}
        />
      </CardContent>
    </Card>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: curlFor, A_RUNNABLE_EXAMPLE_BEATS_A_TABLE
 *
 * WHAT:  A curl command for one endpoint, with its required body fields as a
 *        skeleton payload.
 * WHY:   A_RUNNABLE_EXAMPLE_BEATS_A_TABLE for the first call somebody makes.
 *        The table is what they come back to; the command is what gets them a
 *        `200` in the first minute, which is the thing that decides whether
 *        they keep going.
 *
 *        Built from the endpoint's own REQUIRED fields rather than written
 *        per endpoint, so a new required field appears in the example without
 *        anybody remembering. The values are type placeholders, not fabricated
 *        data that might look real enough to be pasted unchanged.
 * WHERE: EndpointSection.
 */
function curlFor(endpoint: ApiReferenceEndpoint, origin: string): string {
  /* Path parameters are shown as `{id}` in the document; a copied command
   * should carry something a reader will obviously replace. */
  const path = endpoint.path.replace(/\{(\w+)\}/g, "<$1>");

  const lines = [
    `curl -X ${endpoint.method} ${origin}${path} \\`,
    `  -H "Authorization: Bearer ${MCP_KEY_PLACEHOLDER}"`,
  ];

  const required = endpoint.body.filter((field) => field.required);
  if (required.length === 0) return lines.join("\n");

  const payload = required
    .map((field) => `"${field.name}": ${placeholderFor(field.type)}`)
    .join(", ");

  return [
    lines[0],
    `  -H "Authorization: Bearer ${MCP_KEY_PLACEHOLDER}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{ ${payload} }'`,
  ].join("\n");
}

/* A placeholder that matches the field's type, so the skeleton is valid JSON
 * a reader edits rather than one they have to repair. An enum shows its first
 * value, which is a real answer rather than a placeholder. */
function placeholderFor(type: string): string {
  if (type.startsWith('"')) return type.split(" | ")[0] ?? '"…"';
  if (type === "integer" || type === "number") return "0";
  if (type === "boolean") return "false";
  if (type.endsWith("[]")) return "[]";
  if (type === "object") return "{}";
  return '"…"';
}
