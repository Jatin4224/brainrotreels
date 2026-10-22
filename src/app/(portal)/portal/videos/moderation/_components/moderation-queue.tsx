/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: ModerationQueue, REVIEW_UNBLOCKS_THE_ASSET,
 *   FLAGGED_FIRST, DECISION_NEEDS_A_NOTE, APPEND_ONLY
 *
 * WHAT:  The moderation decision log, and the two buttons that resolve a held
 *        item.
 *
 * WHY:   FLAGGED_FIRST. The queue defaults to `flagged`, because that is the
 *        only status with work attached — an approval needs nothing and a
 *        rejection is already final. The filter still offers the others,
 *        because the question "what are we refusing?" is how a false-positive
 *        rate gets noticed.
 *
 *        DECISION_NEEDS_A_NOTE: the note is required, not optional. An
 *        operator decision with no reason is unreviewable six months later
 *        when somebody appeals, and this table is the record that an appeal
 *        turns on. Requiring one sentence is cheap and it is the difference
 *        between an audit trail and a list of names.
 *
 *        REVIEW_UNBLOCKS_THE_ASSET — approving writes BOTH a new log row and
 *        the asset's own status, because the status column is what the render
 *        chokepoint consults. The server does both in one mutation; this
 *        component does not get to do half of it.
 *
 *        The subject is shown as a TYPE and an ID rather than resolved to a
 *        project title or a thumbnail. That is deliberate for a first version:
 *        resolving it means a cross-tenant read per row, and an operator
 *        working this queue has the id to paste into the organizations screen.
 *        A thumbnail would also mean rendering unmoderated customer media into
 *        an operator's browser, which is the one thing a review tool should be
 *        careful about.
 * WHERE: Rendered by /portal/videos/moderation.
 */

import * as React from "react";
import { toast } from "sonner";

import { trpc } from "@/trpc/react-provider";
import {
  MODERATION_VERDICTS,
  moderationVerdictStatusSchema,
  type ModerationVerdictStatus,
} from "@/lib/types/moderation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function ModerationQueue() {
  /* FLAGGED_FIRST — the only status with work attached. */
  const [status, setStatus] = React.useState<ModerationVerdictStatus>("flagged");
  const [page, setPage] = React.useState(1);

  const utils = trpc.useUtils();

  const queue = trpc.portal.listModeration.useQuery(
    { status, page },
    { retry: false, placeholderData: (previous) => previous },
  );

  const review = trpc.portal.reviewModeration.useMutation({
    onSuccess: () => {
      void utils.portal.listModeration.invalidate();
      void utils.portal.videoOps.invalidate();
      toast.success("Decision recorded.");
    },
    onError: (error) => toast.error(error.message),
  });

  if (queue.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;

  if (queue.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{queue.error.message}</AlertDescription>
      </Alert>
    );
  }

  const items = queue.data?.items ?? [];
  const total = queue.data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString("en-US")} record{total === 1 ? "" : "s"}
        </p>
        <Select
          value={status}
          onValueChange={(next) => {
            /* `null` is the Select's "cleared" value, which this control never
             * offers; the parse keeps a stray value from reaching the server
             * as a filter it would reject. */
            const parsed = moderationVerdictStatusSchema.safeParse(next);
            if (parsed.success) setStatus(parsed.data);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[11rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODERATION_VERDICTS.map((verdict) => (
              <SelectItem key={verdict} value={verdict}>
                {verdict}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing {status} in the log.
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((record) => (
            <QueueRow
              key={record.id}
              record={record}
              busy={review.isPending}
              onDecide={(verdict, note) =>
                review.mutate({
                  organizationId: record.organizationId,
                  /* The union is narrowed by the server's own schema; the row's
                   * column is a string, so an unrecognised value is refused
                   * there rather than coerced here. */
                  subjectType: record.subjectType as "asset",
                  subjectId: record.subjectId,
                  status: verdict,
                  note,
                })
              }
            />
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground">Page {page}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={items.length === 0}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: QueueRow, DECISION_NEEDS_A_NOTE
 *
 * One record, with its decision controls. The note lives in LOCAL state per
 * row rather than one shared field, so reviewing twenty items in a sitting
 * does not mean a note from the previous one being attached to the next.
 */
function QueueRow({
  record,
  busy,
  onDecide,
}: {
  record: {
    id: string;
    organizationId: string;
    subjectType: string;
    subjectId: string;
    status: string;
    categories: unknown;
    reason: string | null;
    engine: string;
    createdAt: Date;
  };
  busy: boolean;
  onDecide: (verdict: ModerationVerdictStatus, note: string) => void;
}) {
  const [note, setNote] = React.useState("");
  const categories = readCategories(record.categories);
  /* Only a `flagged` record is actionable: an approval needs nothing and a
   * rejection has already been communicated to the customer. */
  const actionable = record.status === "flagged";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={record.status === "rejected" ? "destructive" : "secondary"}
          >
            {record.status}
          </Badge>
          <span className="text-sm font-medium">{record.subjectType}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {record.subjectId}
          </code>
          <span className="text-xs text-muted-foreground">
            {new Date(record.createdAt).toLocaleString("en-US")}
          </span>
          {/* The engine is the field that distinguishes "a model was unsure"
              from "nothing has looked at this yet" — see UNAVAILABLE_ENGINE and
              VISUAL_REVIEW_ENGINE. It is the first thing to read on a bad day. */}
          <Badge variant="outline" className="font-mono text-xs">
            {record.engine}
          </Badge>
        </div>

        {categories.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {categories.map((category) => (
              <Badge key={category} variant="outline">
                {category}
              </Badge>
            ))}
          </div>
        ) : null}

        {record.reason === null ? null : (
          <p className="text-sm text-muted-foreground">{record.reason}</p>
        )}

        <p className="text-xs text-muted-foreground">
          Workspace{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            {record.organizationId}
          </code>
        </p>

        {actionable ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why — required, and kept on the record"
              className="flex-1"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                /* DECISION_NEEDS_A_NOTE — the server enforces it too. */
                disabled={busy || note.trim().length === 0}
                onClick={() => onDecide("approved", note.trim())}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || note.trim().length === 0}
                onClick={() => onDecide("rejected", note.trim())}
              >
                Reject
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* `categories` is a jsonb column, so what arrives is `unknown`. Read
 * defensively and shown as-is: these were validated against the closed list on
 * the way in (see recordModeration), so anything unexpected here is a row from
 * a different release and is still worth displaying. */
function readCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}
