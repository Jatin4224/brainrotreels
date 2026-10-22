/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: logLine, LogLine, logError, ONE_LOGGER,
 *   STRUCTURED_JSON_ONLY, REQUEST_ID_ON_EVERY_LINE
 *
 * WHAT:  The app's one log function: a single line of JSON per event, with the
 *        correlation id on it.
 *
 * WHY:   ONE_LOGGER is the phase's own instruction — "extend the structured
 *        logs the procedure builder already emits rather than introducing a
 *        second logger". That builder has emitted
 *        `{ ts, logger, path, type, durationMs, status, … }` since the
 *        boilerplate shipped, and this module is that shape lifted out so the
 *        workflows, the webhooks and the services can emit the SAME shape. A
 *        second logging library would have meant two formats in one log stream,
 *        which makes the stream unqueryable precisely when it matters.
 *
 *        STRUCTURED_JSON_ONLY, one object per line, no multi-line output and no
 *        pretty printing. Every log platform these lines land in parses
 *        newline-delimited JSON and none of them parse a wrapped, coloured,
 *        human-formatted block — and a developer reading raw output can still
 *        read one line of JSON, whereas nobody can query a pretty one.
 *
 *        REQUEST_ID_ON_EVERY_LINE: `requestId` is a required field, not an
 *        optional one. An optional correlation id is one that is missing from
 *        exactly the lines you need it on, because the places that forget to
 *        pass it are the places nobody thought about.
 *
 *        It writes to `console` deliberately rather than to a transport. Every
 *        runtime this app targets — Node, the edge runtime, a Lambda, an
 *        Inngest worker — collects stdout, and a transport with its own buffer
 *        is a way to lose the last lines before a crash, which are the ones
 *        worth having.
 * WHERE: src/trpc/procedures/protected.ts, the Inngest functions, the webhook
 *        routes, and src/lib/observability/sentry.ts (which mirrors an error
 *        line into Sentry).
 */

/**
 * SOURCE OF TRUTH KEYWORDS: LogLine, LOGGER_NAMES_THE_SUBSYSTEM
 *
 * WHAT:  One structured event.
 * WHY:   `logger` names the subsystem (`trpc`, `pipeline`, `render`,
 *        `moderation`) so one stream can be filtered to one concern without a
 *        per-subsystem log destination. It is a free string rather than a union
 *        on purpose: a closed list here would mean a new workflow could not log
 *        until this file was edited, and the cost of a typo in a filter is far
 *        lower than the cost of a module that cannot log.
 *
 *        `data` is `unknown`-free by construction — a record of JSON values —
 *        because a log line has to serialise, and an object with a `Date`, a
 *        `BigInt` or a cycle in it either throws inside the logger or silently
 *        drops the field.
 * WHERE: The argument of logLine.
 */
export interface LogLine {
  level: "debug" | "info" | "warn" | "error";
  /** The subsystem, e.g. `trpc`, `pipeline`, `moderation`. */
  logger: string;
  /** What happened, as a short stable string — not a sentence. */
  event: string;
  /** The correlation id. Required — see REQUEST_ID_ON_EVERY_LINE. */
  requestId: string;
  organizationId?: string | undefined;
  userId?: string | undefined;
  durationMs?: number | undefined;
  /** Anything else worth recording. Must be JSON-serialisable. */
  data?: Record<string, string | number | boolean | null> | undefined;
}

/**
 * SOURCE OF TRUTH KEYWORDS: logLine, STRUCTURED_JSON_ONLY
 *
 * WHAT:  Emits one line.
 * WHY:   Routed to `console.error` for errors and `console.warn` for warnings
 *        rather than everything going to `console.log`, because most hosts map
 *        those to their own severity levels and an error that arrives as `info`
 *        does not page anybody.
 *
 *        Undefined fields are dropped rather than serialised as `null`. A log
 *        search for `organizationId:null` returning every background job is
 *        noise; a missing key is honest.
 * WHERE: Every subsystem.
 */
export function logLine(line: LogLine): void {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level: line.level,
    logger: line.logger,
    event: line.event,
    requestId: line.requestId,
  };

  if (line.organizationId !== undefined)
    payload["organizationId"] = line.organizationId;
  if (line.userId !== undefined) payload["userId"] = line.userId;
  if (line.durationMs !== undefined) payload["durationMs"] = line.durationMs;
  if (line.data !== undefined) Object.assign(payload, line.data);

  const serialised = JSON.stringify(payload);

  switch (line.level) {
    case "error":
      console.error(serialised);
      return;
    case "warn":
      console.warn(serialised);
      return;
    default:
      console.log(serialised);
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: logError, ERROR_MESSAGE_IS_NOT_THE_EVENT
 *
 * WHAT:  An error line, with the exception reduced to loggable fields.
 *
 * WHY:   ERROR_MESSAGE_IS_NOT_THE_EVENT. `event` stays a short stable string
 *        (`pipeline.stage_failed`) and the exception's message goes in a field,
 *        because a log platform groups on the former and a message carrying an
 *        id or a timestamp makes every occurrence its own group — which is how
 *        an alert on "this happens 50 times an hour" never fires.
 *
 *        The stack is deliberately NOT logged here. Sentry is where a stack
 *        belongs — it deduplicates, symbolicates and threads it — and a stack
 *        in a JSON log line is a multi-kilobyte field that breaks the one-line
 *        property for no gain. Grep `SENTRY_OWNS_THE_STACK`.
 * WHERE: Workflow failure handlers, webhook routes, the procedure factory.
 */
export function logError(
  line: Omit<LogLine, "level" | "data"> & {
    error: unknown;
    data?: LogLine["data"];
  },
): void {
  const { error, data, ...rest } = line;

  logLine({
    ...rest,
    level: "error",
    data: {
      ...(data ?? {}),
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage:
        error instanceof Error ? error.message : String(error).slice(0, 500),
    },
  });
}
