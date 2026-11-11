/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: ApiKeysPanel, SHOWN_ONCE_NEVER_AGAIN,
 *   A_CLIENT_NEEDS_ITS_OWN_BLOCK, mcpClientConfigs, CodeBlock,
 *   REVOKED_NOT_DELETED, THE_SCREEN_IS_NOT_GATED, ZOD_SCHEMA_IS_THE_FORM,
 *   THEME_TOKENS_ONLY
 *
 * WHAT:  The developers screen: what the API is, the workspace's keys, and the
 *        one-time reveal of a key that has just been minted.
 *
 * WHY:   SHOWN_ONCE_NEVER_AGAIN drives the whole layout. A minted key is
 *        returned by exactly one mutation and stored nowhere, so this
 *        component holds it in state, shows it in a panel that cannot be
 *        mistaken for a row in the table, and says plainly that closing it
 *        loses the key. Everything about that panel is deliberate: it is
 *        dismissible only by an explicit action, the copy button is the
 *        primary control, and it does not reappear.
 *
 *        It is NOT stored in `localStorage` "for convenience". A secret that
 *        survives a refresh is a secret sitting in a browser profile, and the
 *        recovery path is already cheap — mint another and revoke this one.
 *
 *        REVOKED_NOT_DELETED. Revoked keys stay in the table, greyed, with
 *        their date. "I turned that off in March" is the answer to "why did my
 *        script stop working", and hiding them makes a revocation look like a
 *        deletion.
 *
 *        ZOD_SCHEMA_IS_THE_FORM, per CLAUDE.md rule 5: the resolver is
 *        `createApiKeySchema`, the same schema the procedure validates with,
 *        so the 60-character limit a customer meets on screen is the one the
 *        server enforces.
 *
 *        THEME_TOKENS_ONLY — this is dashboard chrome, so every colour is a
 *        token. The key itself is rendered in a muted block rather than
 *        anything that looks like a warning: it is a secret, not an error.
 * WHERE: /dashboard/settings/developers.
 */

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { CodeBlock } from "@/components/global/code-block";
import { SettingsSection } from "@/components/global/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActiveOrganizationId } from "@/hooks/use-active-organization";
import {
  MCP_KEY_PLACEHOLDER,
  mcpClientConfigs,
} from "@/lib/api/mcp-clients";
import { createApiKeySchema, type CreateApiKeyValues } from "@/lib/types/api";
import { trpc } from "@/trpc/react-provider";

/**
 * SOURCE OF TRUTH KEYWORDS: ApiKeysPanel, THE_ORIGIN_COMES_FROM_THE_SERVER
 *
 * THE_ORIGIN_COMES_FROM_THE_SERVER. The snippets below contain a URL, and it
 * has to be the URL of the deployment the customer is looking at — a curl
 * command or an MCP config copied from a preview and silently pointing at
 * production is a mistake nobody spots in a code block.
 *
 * It is a PROP rather than `window.location.origin` in an effect for two
 * reasons: an effect that only sets state is the pattern
 * `react-hooks/set-state-in-effect` exists to catch, and reading `window`
 * during render would make the server's markup differ from the client's. The
 * page is already a server component, so it knows the host from the request
 * headers and passes it down — no effect, no hydration mismatch, and accurate
 * on every deployment.
 */
export function ApiKeysPanel({
  origin,
  toolCount,
}: {
  origin: string;
  /**
   * How many MCP tools exist, counted from the table rather than written
   * here. A number in prose goes stale the first time a tool is added, and
   * the panel cannot import the table itself — it is `server-only`.
   */
  toolCount: number;
}) {
  const organizationId = useActiveOrganizationId();
  const utils = trpc.useUtils();

  /* The minted key lives here and nowhere else — see SHOWN_ONCE_NEVER_AGAIN. */
  const [minted, setMinted] = React.useState<{
    name: string;
    secret: string;
  } | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [revoking, setRevoking] = React.useState<{
    id: string;
    prefix: string;
  } | null>(null);

  const keys = trpc.apiKeys.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: organizationId !== undefined },
  );

  const form = useForm<CreateApiKeyValues>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: { organizationId: organizationId ?? "", name: "" },
  });

  const create = trpc.apiKeys.create.useMutation({
    onSuccess: (result) => {
      setMinted({ name: result.key.name, secret: result.secret });
      setCreating(false);
      form.reset({ organizationId: organizationId ?? "", name: "" });
      void utils.apiKeys.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const revoke = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => {
      setRevoking(null);
      void utils.apiKeys.list.invalidate();
      toast.success("Key revoked. It stops working immediately.");
    },
    onError: (error) => {
      setRevoking(null);
      toast.error(error.message);
    },
  });

  const onSubmit = (values: CreateApiKeyValues) => {
    if (organizationId === undefined) return;
    create.mutate({ ...values, organizationId });
  };

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        title="API keys"
        description="A key lets a program create projects, write scripts, assign voices and render videos on behalf of this workspace."
        label="Keys"
        labelDescription="Each key acts for the whole workspace. Revoke one the moment it leaks."
        contentWidth="full"
      >
        <div className="flex flex-col gap-4">
          {minted !== null && (
            <MintedKey
              name={minted.name}
              secret={minted.secret}
              onDismiss={() => setMinted(null)}
            />
          )}

          <div className="flex justify-end">
            {/* The button sits OUTSIDE the dialog rather than as its trigger,
                because the open state is already controlled here — and this
                component library takes a `render` prop rather than `asChild`,
                so a trigger wrapping a styled button is the longer way to the
                same place. */}
            <Button
              size="sm"
              disabled={organizationId === undefined}
              onClick={() => setCreating(true)}
            >
              Create key
            </Button>
            <Dialog open={creating} onOpenChange={setCreating}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create an API key</DialogTitle>
                  <DialogDescription>
                    Name it after the thing that will use it, so you can revoke
                    the right one later. The key is shown once and cannot be
                    recovered.
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-4"
                  >
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Production — video pipeline"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button type="submit" disabled={create.isPending}>
                        {create.isPending ? "Creating…" : "Create key"}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {keys.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : keys.error !== null ? (
            <p className="text-muted-foreground text-sm">{keys.error.message}</p>
          ) : keys.data.keys.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No keys yet. Create one to call the API from your own code.
            </p>
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.data.keys.map((key) => (
                    <TableRow
                      key={key.id}
                      className={
                        key.revokedAt !== null ? "text-muted-foreground" : ""
                      }
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          {key.name}
                          {key.revokedAt !== null && (
                            <Badge variant="outline">revoked</Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {key.prefix}…
                      </TableCell>
                      <TableCell className="text-sm">
                        {key.lastUsedAt === null
                          ? "never"
                          : formatDate(key.lastUsedAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDate(key.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {key.revokedAt === null && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setRevoking({ id: key.id, prefix: key.prefix })
                            }
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Using the API"
        description="Everything the dashboard does to make a video, your code can do too."
        label="Endpoints"
        labelDescription="Send the key as a bearer token. The reference lists every route and its shape."
        contentWidth="full"
      >
        <div className="flex flex-col gap-4">
          <CodeBlock
            language="bash"
            copyLabel="Command copied."
            code={`curl -X POST ${origin}/api/v1/projects \\
  -H "Authorization: Bearer ${MCP_KEY_PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"My video","kind":"voiceover","aspect":"9:16"}'`}
          />
          <p className="text-muted-foreground text-sm">
            The{" "}
            <a
              href="/docs/api"
              className="underline underline-offset-4"
              target="_blank"
              rel="noreferrer"
            >
              full reference
            </a>{" "}
            lists every endpoint, and the machine-readable description lives at{" "}
            <a
              href="/api/v1/openapi.json"
              className="underline underline-offset-4"
              target="_blank"
              rel="noreferrer"
            >
              <code className="font-mono text-xs">/api/v1/openapi.json</code>
            </a>{" "}
            — point a client generator at it rather than hand-writing types.
          </p>
        </div>
      </SettingsSection>

      {/* SOURCE OF TRUTH KEYWORDS: THE_CONFIG_IS_COPY_PASTE
          The phase's step 17. An MCP endpoint is useless without the JSON
          block that goes into a client's config file, and nobody types one
          from a description — so it is rendered ready to copy, with the real
          origin in it rather than a placeholder somebody has to notice. */}
      <SettingsSection
        title="Agents (MCP)"
        description="Let Claude, Cursor or your own agent make videos with the same key."
        label="MCP server"
        labelDescription={`${toolCount} tools: create a project, write a script, assign voices, render, poll, download, and browse the catalogues.`}
        contentWidth="full"
      >
        <div className="flex flex-col gap-6">
          <CodeBlock
            language="http"
            copyLabel="Endpoint copied."
            code={`${origin}/api/mcp`}
            caption="Replace the placeholder key in every block below with one from above."
          />

          {/* A_CLIENT_NEEDS_ITS_OWN_BLOCK — one block per client, each with
              the file it goes in or the command to run, because WHERE the
              config lives is the thing people are actually stuck on. The list
              comes from lib so this screen and /docs/api cannot disagree. */}
          {mcpClientConfigs(origin).map((config) => (
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

          <p className="text-muted-foreground text-sm">
            Rendering and script writing cost credits and keep running after
            the tool returns, so an agent should poll rather than retry. The
            tool descriptions say so, and they are what the model reads.
          </p>
        </div>
      </SettingsSection>

      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this key?</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking?.prefix}… stops working immediately, and anything using
              it will start failing. This cannot be undone — rotating means
              creating a new key first, then revoking the old one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoke.isPending}
              onClick={() => {
                if (organizationId === undefined || revoking === null) return;
                revoke.mutate({ organizationId, id: revoking.id });
              }}
            >
              {revoke.isPending ? "Revoking…" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: MintedKey, SHOWN_ONCE_NEVER_AGAIN
 *
 * The one-time reveal. Dismissible only by an explicit action, because a panel
 * that closed on a click outside would lose a secret the customer cannot get
 * back — and the copy button is the primary control for the same reason.
 */
function MintedKey({
  name,
  secret,
  onDismiss,
}: {
  name: string;
  secret: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success("Key copied.");
    } catch {
      /* A browser that refuses clipboard access (an insecure origin, a denied
       * permission) must not leave the customer thinking it copied. The key is
       * on screen and selectable, so saying so is the whole fix. */
      toast.error("Could not copy. Select the key and copy it manually.");
    }
  };

  return (
    <div className="tactile-raised flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div>
        <p className="text-sm font-medium">{name} is ready</p>
        <p className="text-muted-foreground text-sm">
          This is the only time this key is shown. Store it somewhere your code
          can read it; if you lose it, create another and revoke this one.
        </p>
      </div>
      <code className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
        {secret}
      </code>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy key"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          I have saved it
        </Button>
      </div>
    </div>
  );
}

/* A date a person can read, in their own locale, without a formatting library
 * for four columns. */
function formatDate(value: Date): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
