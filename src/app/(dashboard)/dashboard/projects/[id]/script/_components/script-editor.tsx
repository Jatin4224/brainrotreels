/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: ScriptEditor, GenerateScriptForm, ScriptBlockRow,
 *   PACING_WARNS_NEVER_TRUNCATES, COST_ON_THE_BUTTON, POLL_WHILE_GENERATING,
 *   DRAFT_IS_LOCAL_UNTIL_BLUR, GENERATION_REPLACES_EVERYTHING
 *
 * WHAT:  The script surface: generate one, then edit it block by block.
 *
 * WHY:   DRAFT_IS_LOCAL_UNTIL_BLUR. Each block's textarea holds its own local
 *        draft and saves on blur, not on every keystroke. Saving per keystroke
 *        would be a mutation per character — and because every save recomputes
 *        the duration, the pacing total would flicker while somebody typed.
 *        Blur is also the moment a person has finished a thought, which is the
 *        right granularity for an undo-able unit.
 *
 *        POLL_WHILE_GENERATING: the model call runs in a workflow, so nothing
 *        pushes its completion to the browser. The list polls while the
 *        project is `generating` and stops by itself — the same mechanism and
 *        the same reason as the media table's POLL_WHILE_PROCESSING.
 *
 *        PACING_WARNS_NEVER_TRUNCATES: the running total is always visible and
 *        turns into a warning past the limit. Nothing is ever cut — the phase
 *        is explicit, and a script trimmed to fit loses the payoff at the end,
 *        where nobody notices until the video is made.
 *
 *        GENERATION_REPLACES_EVERYTHING: generating discards hand edits, so
 *        the button confirms first when a script already exists. The
 *        non-destructive path is the per-block regenerate.
 * WHERE: Rendered by /dashboard/projects/[id]/script.
 */

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { permissions } from "@/lib/permissions";
import {
  SCRIPT_TARGET_SECONDS_MAX,
  SCRIPT_TARGET_SECONDS_MIN,
  SCRIPT_TONES,
  SECTION_TYPES,
  generateScriptSchema,
  type GenerateScriptValues,
  type ScriptTone,
  type SectionType,
} from "@/lib/types/script";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { QuizInputPanel } from "./quiz-input-panel";
import { RedditInputPanel } from "./reddit-input-panel";

/** Two seconds, matching the media table — live enough, not a request storm. */
const GENERATING_POLL_MS = 2000;

const SECTION_LABEL: Readonly<Record<SectionType, string>> = {
  hook: "Hook",
  body: "Body",
  cta: "Call to action",
};

export function ScriptEditor({ projectId }: { projectId: string }) {
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();
  const enabled = organizationId !== undefined;

  const canWrite = hasPermission(permissions.SCRIPTS_UPDATE);
  const canGenerate = hasPermission(permissions.SCRIPTS_CREATE);

  const project = trpc.projects.get.useQuery(
    { organizationId: organizationId ?? "", id: projectId },
    { enabled, retry: false },
  );

  const script = trpc.scripts.list.useQuery(
    { organizationId: organizationId ?? "", projectId },
    {
      enabled,
      retry: false,
      placeholderData: (previous) => previous,
      /* POLL_WHILE_GENERATING — driven by the PROJECT's status, because the
       * script list is empty for the whole time the model is working and so
       * carries no signal of its own. Stops by itself when the status
       * settles. */
      refetchInterval: () =>
        project.data?.status === "generating" ? GENERATING_POLL_MS : false,
    },
  );

  /* The project query has to poll too, or the status that drives the poll
   * above never updates and the editor stays blank after a generation. */
  React.useEffect(() => {
    if (project.data?.status !== "generating") return;
    const timer = setInterval(() => void project.refetch(), GENERATING_POLL_MS);
    return () => clearInterval(timer);
  }, [project]);

  if (!enabled || project.isPending) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  const generating = project.data?.status === "generating";
  const blocks = script.data?.blocks ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* THE_INPUT_IS_PER_FORMAT. A Reddit story is started from a THREAD,
          not from an article and a tone — it has its own validation, its own
          five named failures, a condense toggle and a retention notice, and
          none of that belongs on the generic form. The kind decides which
          panel renders, which is the same thing the writer registry and the
          generator registry do server-side. */}
      {canGenerate ? (
        project.data?.kind === "reddit-story" ? (
          <RedditInputPanel
            organizationId={organizationId}
            projectId={projectId}
            hasExistingScript={blocks.length > 0}
            generating={generating}
            retention={project.data.reddit ?? null}
          />
        ) : project.data?.kind === "quiz" ? (
          /* THE_INPUT_IS_PER_FORMAT — a quiz is started from a topic or a
             typed question table, with a countdown length and a free
             single-question preview, and none of that belongs on the generic
             form either. Third kind, same switch. */
          <QuizInputPanel
            organizationId={organizationId}
            projectId={projectId}
            hasExistingScript={blocks.length > 0}
            generating={generating}
          />
        ) : (
          <GenerateScriptForm
            organizationId={organizationId}
            projectId={projectId}
            hasExistingScript={blocks.length > 0}
            generating={generating}
          />
        )
      ) : null}

      {project.data?.status === "failed" ? (
        <Alert variant="destructive">
          <AlertTitle>The last generation did not finish</AlertTitle>
          <AlertDescription>
            Nothing was charged for it. Try again, or paste the text directly.
          </AlertDescription>
        </Alert>
      ) : null}

      {generating ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Writing your script…</p>
            <p className="mt-1">
              This takes up to a minute. You can leave this page.
            </p>
          </CardContent>
        </Card>
      ) : blocks.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No script yet</p>
            <p className="mt-1">
              Give us a topic, a link or some text and we will write one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ScriptBlockList
          organizationId={organizationId}
          projectId={projectId}
          blocks={blocks}
          estimatedSeconds={script.data?.estimatedSeconds ?? 0}
          warnAtSeconds={script.data?.warnAtSeconds ?? 60}
          overLimit={script.data?.overLimit ?? false}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: GenerateScriptForm, COST_ON_THE_BUTTON,
 *   GENERATION_REPLACES_EVERYTHING, RHF_SHARED_SCHEMA
 *
 * WHY:   RHF_SHARED_SCHEMA — the form resolves against `generateScriptSchema`,
 *        the exact schema the server validates with, so a value the client
 *        accepts cannot be one the server refuses.
 *
 *        COST_ON_THE_BUTTON: the price comes from `scripts.estimateCost`, a
 *        server query using the same estimator the refusal and the hold use. A
 *        cost computed here would be a second implementation of pricing.
 */
function GenerateScriptForm({
  organizationId,
  projectId,
  hasExistingScript,
  generating,
}: {
  organizationId: string;
  projectId: string;
  hasExistingScript: boolean;
  generating: boolean;
}) {
  const utils = trpc.useUtils();
  const [confirming, setConfirming] = React.useState(false);

  const form = useForm<GenerateScriptValues>({
    resolver: zodResolver(generateScriptSchema),
    mode: "onTouched",
    defaultValues: {
      organizationId,
      projectId,
      source: { kind: "text", value: "" },
      tone: "casual",
      targetSeconds: 30,
    },
  });

  /* useWatch, not form.watch(): the React Compiler refuses to memoize a
   * component that calls `watch()`, because it returns a function whose
   * identity it cannot reason about. useWatch is a hook returning a value, so
   * the subscription is safe — the same choice, for the same reason, as the
   * create-project sheet. */
  const targetSeconds = useWatch({
    control: form.control,
    name: "targetSeconds",
  });
  const sourceKind = useWatch({ control: form.control, name: "source.kind" });

  const estimateQuery = trpc.scripts.estimateCost.useQuery(
    {
      organizationId,
      projectId,
      targetSeconds:
        typeof targetSeconds === "number" ? targetSeconds : 30,
    },
    { enabled: typeof targetSeconds === "number", retry: false },
  );

  const generate = trpc.scripts.generate.useMutation({
    onSuccess: (result) => {
      toast.success("Writing your script", {
        description: result.source.truncated
          ? "The source was long, so we used the first part of it."
          : "This takes up to a minute.",
      });
      setConfirming(false);
      void utils.scripts.invalidate();
      void utils.projects.invalidate();
      void utils.credits.invalidate();
    },
    onError: (error) => {
      toast.error("That script could not be started", {
        description: error.message,
      });
      setConfirming(false);
    },
  });

  const cost = estimateQuery.data?.cost ?? null;
  const affordable = estimateQuery.data?.affordable ?? true;
  const busy = generate.isPending || generating;

  function onSubmit(values: GenerateScriptValues) {
    /* GENERATION_REPLACES_EVERYTHING — confirm before discarding hand edits.
     * The confirmation is a second press rather than a dialog, because this is
     * a form the customer is already looking at and a modal over it would be
     * one more thing to dismiss. */
    if (hasExistingScript && !confirming) {
      setConfirming(true);
      return;
    }
    generate.mutate(values);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {hasExistingScript ? "Rewrite the script" : "Write a script"}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="source.kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        /* The value means something different per kind — a URL,
                         * a storage key, prose — so carrying it across would
                         * submit a URL as pasted text. */
                        form.setValue("source.value", "");
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="text">Paste text</SelectItem>
                        <SelectItem value="url">Link</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tone</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SCRIPT_TONES.map((tone: ScriptTone) => (
                          <SelectItem key={tone} value={tone}>
                            {tone.charAt(0).toUpperCase() + tone.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="targetSeconds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Length (seconds)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={SCRIPT_TARGET_SECONDS_MIN}
                        max={SCRIPT_TARGET_SECONDS_MAX}
                        value={field.value}
                        onChange={(event) =>
                          field.onChange(Number(event.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="source.value"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {sourceKind === "url" ? "Link" : "Your text"}
                  </FormLabel>
                  <FormControl>
                    {sourceKind === "url" ? (
                      <Input
                        placeholder="https://example.com/article"
                        {...field}
                      />
                    ) : (
                      <Textarea
                        rows={6}
                        placeholder="Paste an article, a transcript, or describe the topic…"
                        {...field}
                      />
                    )}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {confirming ? (
              <Alert>
                <AlertTitle>This replaces the current script</AlertTitle>
                <AlertDescription>
                  Any edits you have made will be lost. Press again to continue.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy}>
                {/* COST_ON_THE_BUTTON, switching to the remedy when the
                    balance is short — a disabled price tells somebody they
                    cannot proceed but not what to do about it. */}
                {busy
                  ? "Writing…"
                  : !affordable
                    ? "Top up credits"
                    : confirming
                      ? "Press again to replace"
                      : cost === null
                        ? "Write script"
                        : `Write script (${cost.total} credits)`}
              </Button>

              {confirming ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: ScriptBlockList, PACING_WARNS_NEVER_TRUNCATES,
 *   ORDER_IS_SENT_WHOLE
 *
 * WHY:   ORDER_IS_SENT_WHOLE — moving a block sends the COMPLETE new order,
 *        not a from/to pair. See the service for why a move pair produces an
 *        order nobody chose when two reorders race.
 *
 *        Up/down buttons rather than a drag library: reordering a handful of
 *        blocks is a keyboard-accessible operation that needs no dependency,
 *        and a drag surface that is not also keyboard-operable would be the
 *        only such control in this app.
 */
function ScriptBlockList({
  organizationId,
  projectId,
  blocks,
  estimatedSeconds,
  warnAtSeconds,
  overLimit,
  canWrite,
}: {
  organizationId: string;
  projectId: string;
  blocks: readonly {
    id: string;
    position: number;
    sectionType: string;
    narrationText: string;
    durationEstimate: number;
  }[];
  estimatedSeconds: number;
  warnAtSeconds: number;
  overLimit: boolean;
  canWrite: boolean;
}) {
  const utils = trpc.useUtils();

  const invalidate = React.useCallback(() => {
    void utils.scripts.list.invalidate();
  }, [utils]);

  const reorder = trpc.scripts.reorder.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toast.error("That move did not stick", { description: error.message }),
  });

  const addBlock = trpc.scripts.addBlock.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toast.error("That block could not be added", {
        description: error.message,
      }),
  });

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= blocks.length) return;

    const ordered = blocks.map((block) => block.id);
    const moved = ordered[index];
    const displaced = ordered[next];
    if (moved === undefined || displaced === undefined) return;
    ordered[index] = displaced;
    ordered[next] = moved;

    reorder.mutate({ organizationId, projectId, orderedIds: ordered });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* PACING_WARNS_NEVER_TRUNCATES — always visible, a warning past the
          limit, and nothing is ever cut. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {blocks.length} block{blocks.length === 1 ? "" : "s"} ·{" "}
          <span className={overLimit ? "font-medium text-destructive" : ""}>
            about {estimatedSeconds.toFixed(1)}s
          </span>
        </p>
        {canWrite ? (
          <Button
            size="sm"
            variant="outline"
            disabled={addBlock.isPending}
            onClick={() =>
              addBlock.mutate({
                organizationId,
                projectId,
                sectionType: "body",
              })
            }
          >
            Add block
          </Button>
        ) : null}
      </div>

      {overLimit ? (
        <Alert>
          <AlertTitle>
            This script runs to about {estimatedSeconds.toFixed(0)} seconds
          </AlertTitle>
          <AlertDescription>
            Most short-form surfaces favour videos under {warnAtSeconds}{" "}
            seconds. Nothing has been cut — shorten a block or delete one if you
            want it tighter.
          </AlertDescription>
        </Alert>
      ) : null}

      {blocks.map((block, index) => (
        <ScriptBlockCard
          key={block.id}
          organizationId={organizationId}
          block={block}
          canWrite={canWrite}
          isFirst={index === 0}
          isLast={index === blocks.length - 1}
          onMoveUp={() => move(index, -1)}
          onMoveDown={() => move(index, 1)}
          onChanged={invalidate}
        />
      ))}
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: ScriptBlockCard, DRAFT_IS_LOCAL_UNTIL_BLUR
 *
 * WHY:   DRAFT_IS_LOCAL_UNTIL_BLUR — the textarea is uncontrolled by the
 *        server: local state while typing, one mutation on blur, and only when
 *        the text actually changed. Saving per keystroke would be a request
 *        per character and would make the pacing total flicker as somebody
 *        typed.
 *
 *        The draft resets when the SERVER's text changes, so a per-block
 *        regenerate replaces what is on screen — without that, the customer
 *        presses regenerate and sees their old text sitting in the box.
 */
function ScriptBlockCard({
  organizationId,
  block,
  canWrite,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onChanged,
}: {
  organizationId: string;
  block: {
    id: string;
    sectionType: string;
    narrationText: string;
    durationEstimate: number;
  };
  canWrite: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChanged: () => void;
}) {
  /**
   * SOURCE OF TRUTH KEYWORDS: DRAFT_RESETS_ON_SERVER_CHANGE
   *
   * Adjusting state DURING RENDER rather than in an effect, which is React's
   * own documented pattern for "reset local state when a prop changes". The
   * effect version trips react-hooks/set-state-in-effect and is genuinely
   * worse: it renders once with the stale text before correcting itself, so a
   * regenerate visibly shows the OLD words under the NEW duration for a frame.
   * React re-renders this component immediately, before touching the DOM, so
   * that intermediate state is never painted.
   */
  const [draft, setDraft] = React.useState(block.narrationText);
  const [serverText, setServerText] = React.useState(block.narrationText);

  if (block.narrationText !== serverText) {
    setServerText(block.narrationText);
    setDraft(block.narrationText);
  }

  const update = trpc.scripts.updateBlock.useMutation({
    onSuccess: onChanged,
    onError: (error) => {
      toast.error("That edit was not saved", { description: error.message });
      /* Put the server's text back so the box never shows something that was
       * not stored. */
      setDraft(block.narrationText);
    },
  });

  const regenerate = trpc.scripts.regenerateBlock.useMutation({
    onSuccess: () => {
      toast.success("Block rewritten");
      onChanged();
    },
    onError: (error) =>
      toast.error("That block could not be rewritten", {
        description: error.message,
      }),
  });

  const remove = trpc.scripts.deleteBlock.useMutation({
    onSuccess: onChanged,
    onError: (error) =>
      toast.error("That block could not be deleted", {
        description: error.message,
      }),
  });

  const section = SECTION_TYPES.includes(block.sectionType as SectionType)
    ? (block.sectionType as SectionType)
    : "body";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant={section === "hook" ? "default" : "secondary"}>
              {SECTION_LABEL[section]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {block.durationEstimate.toFixed(1)}s
            </span>
          </div>

          {canWrite ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={isFirst}
                onClick={onMoveUp}
                aria-label="Move block up"
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isLast}
                onClick={onMoveDown}
                aria-label="Move block down"
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={regenerate.isPending}
                onClick={() =>
                  regenerate.mutate({
                    organizationId,
                    id: block.id,
                    tone: "casual",
                  })
                }
              >
                {regenerate.isPending ? "Rewriting…" : "Rewrite"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ organizationId, id: block.id })}
              >
                Delete
              </Button>
            </div>
          ) : null}
        </div>

        <Textarea
          rows={3}
          value={draft}
          disabled={!canWrite || regenerate.isPending}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const next = draft.trim();
            /* Only when it actually changed, and never to empty — an empty
             * block fails the schema server-side, and bouncing that back as a
             * toast on blur would be hostile. */
            if (next.length === 0 || next === block.narrationText) {
              setDraft(block.narrationText);
              return;
            }
            update.mutate({
              organizationId,
              id: block.id,
              narrationText: next,
            });
          }}
        />
      </CardContent>
    </Card>
  );
}
