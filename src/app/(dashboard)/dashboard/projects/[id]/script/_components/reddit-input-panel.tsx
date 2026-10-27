/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: RedditInputPanel, DURATION_BEFORE_GENERATION,
 *   EVERY_FAILURE_OFFERS_THE_FALLBACK, PREVIEW_IS_FREE, NOTHING_IS_SILENT,
 *   CONDENSE_IS_A_CHOICE, RHF_SHARED_SCHEMA
 *
 * WHAT:  The Reddit story input: a thread link with live validation, the paste
 *        fallback, the condense toggle, and the thread's length BEFORE anything
 *        is generated.
 *
 * WHY:   DURATION_BEFORE_GENERATION is the phase's step 5 and the reason this
 *        panel is not just a text field with a button. The customer has to see
 *        the final duration and the over-60-seconds warning before they spend
 *        anything, and that is not knowable from a URL — so the panel LOOKS the
 *        thread up first, with `redditStories.preview`, which costs no credits
 *        and writes nothing (PREVIEW_IS_FREE). Only then does the start button
 *        become the obvious action.
 *
 *        It is two explicit steps rather than a preview that fires as you type.
 *        Every lookup is a request against Reddit's API under our shared
 *        credentials (THEIR_RATE_LIMIT_NOT_OURS), so a debounce on keystrokes
 *        would spend that budget on half-typed links — and the resource's own
 *        rate limit would start refusing the customer who is typing carefully.
 *
 *        EVERY_FAILURE_OFFERS_THE_FALLBACK: the paste-text tab is a peer of the
 *        link tab, not a consolation prize hidden behind an error, because
 *        every one of the five fetch failures ends by pointing at it. The
 *        server's refusal copy already names the action
 *        (`REDDIT_ERROR_COPY`), so this component renders the message it is
 *        given rather than inventing its own.
 *
 *        The link is validated LOCALLY first, with the same pure parser the
 *        server uses (`parseRedditThreadUrl`) — so "that is a share link, open
 *        it and copy the address bar" appears without a request, and the host
 *        allowlist is the same one either way. That is the whole reason the
 *        parser is credential-free and importable here.
 *
 *        NOTHING_IS_SILENT — the retention date is shown whenever the project
 *        has one, not when it is nearly due, because the phase requires the
 *        date rather than a thread quietly disappearing.
 *
 *        CONDENSE_IS_A_CHOICE: with the toggle off, a long thread makes a long
 *        video and the warning is the whole of the product's opinion.
 * WHERE: Rendered by the script screen for `reddit-story` projects, in place of
 *        the article/PDF form.
 */

import * as React from "react";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import { parseRedditThreadUrl } from "@/lib/adapters/reddit/url";
import {
  REDDIT_RAW_TEXT_MAX_CHARS,
  redditUrlRefusalMessage,
} from "@/lib/types/reddit";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** The default length a thread is condensed to. The server bounds it. */
const DEFAULT_TARGET_SECONDS = 60;

export interface RedditInputPanelProps {
  organizationId: string;
  projectId: string;
  hasExistingScript: boolean;
  generating: boolean;
  /** From `projects.get` — null until the project has a retention date. */
  retention: {
    expiresAt: string;
    retentionDays: number;
    sourceExpired: boolean;
    thread: {
      url: string;
      title: string;
      subreddit: string;
      commentCount: number;
    } | null;
  } | null;
}

export function RedditInputPanel({
  organizationId,
  projectId,
  hasExistingScript,
  generating,
  retention,
}: RedditInputPanelProps) {
  const utils = trpc.useUtils();

  const [mode, setMode] = React.useState<"url" | "text">("url");
  const [url, setUrl] = React.useState("");
  const [text, setText] = React.useState("");
  const [condense, setCondense] = React.useState(true);
  const [confirming, setConfirming] = React.useState(false);
  /* The link whose preview is on screen. Null until a lookup succeeds, and
   * cleared whenever the input changes — so the duration shown can never
   * belong to a different thread from the one in the field. */
  const [previewed, setPreviewed] = React.useState<string | null>(null);

  /* The same pure parser the server uses, so a bad link is explained with no
   * request at all. Only once the field has something in it: an empty field is
   * not an error, it is a field nobody has filled in yet. */
  const localRefusal = React.useMemo(() => {
    if (mode !== "url" || url.trim().length === 0) return null;
    const parsed = parseRedditThreadUrl(url);
    return parsed.ok ? null : redditUrlRefusalMessage(parsed.refusal);
  }, [mode, url]);

  const source =
    mode === "url"
      ? { kind: "url" as const, value: url.trim() }
      : { kind: "text" as const, value: text.trim() };

  const preview = trpc.redditStories.preview.useQuery(
    { organizationId, source },
    {
      /* Enabled only when a lookup has been ASKED FOR — see the note in the
       * file header about not spending the shared API budget on keystrokes. */
      enabled:
        previewed !== null &&
        previewed === source.value &&
        source.value.length > 0,
      retry: false,
      staleTime: 1000 * 60 * 5,
    },
  );

  const start = trpc.redditStories.start.useMutation({
    onSuccess: () => {
      toast.success("Reading the thread", {
        description: "This takes up to a minute. You can leave this page.",
      });
      setConfirming(false);
      void utils.scripts.invalidate();
      void utils.projects.invalidate();
      void utils.credits.invalidate();
    },
    onError: (error) => {
      /* The server's copy already names the action and offers the fallback, so
       * it is rendered as given rather than rewritten here. */
      toast.error("That thread could not be used", {
        description: error.message,
      });
      setConfirming(false);
    },
  });

  const busy = start.isPending || generating;
  const ready = source.value.length > 0 && localRefusal === null;
  const data = preview.data;

  function lookUp() {
    if (!ready) return;
    setPreviewed(source.value);
  }

  function onStart() {
    if (!ready) return;
    /* GENERATION_REPLACES_EVERYTHING — the same second-press confirmation the
     * article form uses, for the same reason: this discards hand edits, and a
     * modal over a form somebody is already looking at is one more thing to
     * dismiss. */
    if (hasExistingScript && !confirming) {
      setConfirming(true);
      return;
    }
    start.mutate({
      organizationId,
      projectId,
      source,
      condense,
      targetSeconds: DEFAULT_TARGET_SECONDS,
    });
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">
          {hasExistingScript ? "Use a different thread" : "Pick a thread"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Paste a link to a Reddit thread and we will read it, split it between
          the people talking, and narrate it.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* EVERY_FAILURE_OFFERS_THE_FALLBACK — the two inputs are peers. */}
        <div className="flex gap-2" role="group" aria-label="Where the thread comes from">
          <Button
            type="button"
            size="sm"
            variant={mode === "url" ? "secondary" : "ghost"}
            aria-pressed={mode === "url"}
            onClick={() => {
              setMode("url");
              setPreviewed(null);
            }}
          >
            Reddit link
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "text" ? "secondary" : "ghost"}
            aria-pressed={mode === "text"}
            onClick={() => {
              setMode("text");
              setPreviewed(null);
            }}
          >
            Paste the text
          </Button>
        </div>

        {mode === "url" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="reddit-url">Thread link</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="reddit-url"
                value={url}
                inputMode="url"
                placeholder="https://www.reddit.com/r/tifu/comments/…"
                aria-invalid={localRefusal !== null}
                aria-describedby={
                  localRefusal === null ? undefined : "reddit-url-error"
                }
                onChange={(event) => {
                  setUrl(event.target.value);
                  setPreviewed(null);
                }}
                className="min-w-0 flex-1"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!ready || busy || preview.isFetching}
                onClick={lookUp}
              >
                {preview.isFetching ? "Looking…" : "Look it up"}
              </Button>
            </div>
            {/* Local, free, and specific: a share link gets the sentence that
                names the fix rather than "invalid URL". */}
            {localRefusal === null ? null : (
              <p id="reddit-url-error" className="text-xs text-destructive">
                {localRefusal}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="reddit-text">The thread, pasted</Label>
            <Textarea
              id="reddit-text"
              value={text}
              rows={8}
              maxLength={REDDIT_RAW_TEXT_MAX_CHARS}
              placeholder="Paste the post and the replies you want in the video."
              onChange={(event) => {
                setText(event.target.value);
                setPreviewed(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              This works whether or not Reddit is reachable — and it is what to
              use for a thread we cannot read.
            </p>
          </div>
        )}

        {/* DURATION_BEFORE_GENERATION — the whole point of the lookup. */}
        {preview.isError ? (
          <Alert variant="destructive">
            <AlertTitle>We could not read that thread</AlertTitle>
            <AlertDescription>{preview.error.message}</AlertDescription>
          </Alert>
        ) : data === undefined ? null : (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
            {data.title === null ? null : (
              <div className="flex flex-wrap items-center gap-2">
                {data.subreddit === null ? null : (
                  <Badge variant="outline" className="shrink-0">
                    r/{data.subreddit}
                  </Badge>
                )}
                <span className="truncate text-sm font-medium text-foreground">
                  {data.title}
                </span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {data.commentCount > 0
                ? `${data.commentCount} ${data.commentCount === 1 ? "reply" : "replies"} · `
                : ""}
              about {Math.round(data.estimatedSeconds)} seconds read straight
              through
            </p>
            {data.overLimit ? (
              /* PACING_WARNS_NEVER_TRUNCATES — a warning and a choice, not a
                 refusal. Nothing is cut unless the customer asks for it. */
              <p className="text-xs text-muted-foreground">
                That is longer than the {data.warnAtSeconds}-second mark most
                feeds reward.{" "}
                {condense
                  ? "We will trim it to about a minute."
                  : "Turn on “condense” to trim it, or keep it long on purpose."}
              </p>
            ) : null}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="reddit-condense" className="text-sm font-normal">
            Condense long threads
          </Label>
          <Switch
            id="reddit-condense"
            checked={condense}
            onCheckedChange={setCondense}
            disabled={busy}
          />
        </div>

        <Button type="button" disabled={!ready || busy} onClick={onStart}>
          {start.isPending
            ? "Starting…"
            : confirming
              ? "Replace the script"
              : hasExistingScript
                ? "Use this thread"
                : "Make the video"}
        </Button>

        {confirming ? (
          <p className="text-xs text-muted-foreground">
            This replaces the script on this project, including any edits. Press
            again to confirm.
          </p>
        ) : null}

        {/* NOTHING_IS_SILENT — the expiry date, from the moment the project
            exists rather than once it is nearly due. */}
        {retention === null ? null : retention.sourceExpired ? (
          <p className="text-xs text-muted-foreground">
            Our copy of the original thread has been removed, {retention.retentionDays}{" "}
            days after this project was made. Your script, narration and video
            are untouched — pick the thread again to re-read it.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            We keep our copy of the thread until{" "}
            {new Date(retention.expiresAt).toLocaleDateString()}, then remove
            it. Your script, narration and video stay.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
