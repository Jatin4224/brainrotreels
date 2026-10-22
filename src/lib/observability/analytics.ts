/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: FUNNEL_EVENTS, FunnelEvent, trackFunnelEvent,
 *   isPostHogConfigured, THE_FUNNEL_IS_FIVE_EVENTS, SERVER_SIDE_FUNNEL,
 *   NEVER_THROW_FROM_ANALYTICS
 *
 * WHAT:  The product funnel the phase asks for — signup → first script → first
 *        render → purchase — emitted from the server.
 *
 * WHY:   THE_FUNNEL_IS_FIVE_EVENTS and no more. Analytics grows without limit
 *        unless the set is closed, and an event nobody has a question for is a
 *        row in somebody's bill forever. These five answer the only questions
 *        that matter before launch: do people sign up, do they get as far as a
 *        script, does the script become a video, and does the video become
 *        money. `first_generation` sits between script and render because this
 *        product's expensive step is generation, not export — a customer who
 *        generates and never renders has still cost us the providers.
 *
 *        SERVER_SIDE_FUNNEL. These are emitted from routers and workflows, not
 *        from the browser, and that is the decision that makes the numbers
 *        trustworthy: a browser event is lost to an ad blocker, a closed tab or
 *        a failed beacon, and the funnel's whole purpose is comparing counts
 *        between steps. A client-side `first_render` that under-reports by 30%
 *        looks exactly like a product problem.
 *
 *        It identifies by ORGANIZATION, with the user as a property. The
 *        product is bought by a workspace — the quotas, the credits and the
 *        subscription all live there — so a funnel keyed on users would show
 *        five conversions for one five-seat team.
 *
 *        NEVER_THROW_FROM_ANALYTICS, like the error reporter: every call
 *        swallows its own failures and nothing awaits the network. A funnel
 *        event is never worth failing a customer's request for.
 * WHERE: `projects.generate`, the script and render workflows, the credits
 *        router, and the sign-up path.
 */

import "server-only";

import { logLine } from "./logger";

/**
 * SOURCE OF TRUTH KEYWORDS: FUNNEL_EVENTS, FunnelEvent, THE_FUNNEL_IS_FIVE_EVENTS
 *
 * WHAT:  Every event this app sends.
 * WHY:   A closed tuple, so an event name is a compile-time choice rather than
 *        a string somebody types — which is what stops `first_render` and
 *        `firstRender` both existing and each holding half the data. Snake
 *        case because that is PostHog's own convention and its UI groups on it.
 * WHERE: The `event` argument of trackFunnelEvent.
 */
export const FUNNEL_EVENTS = [
  "signed_up",
  "first_script",
  "first_generation",
  "first_render",
  "purchased",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/**
 * SOURCE OF TRUTH KEYWORDS: isPostHogConfigured
 *
 * WHAT:  Whether analytics is switched on.
 * WHY:   Reads `NEXT_PUBLIC_POSTHOG_KEY`, which is a write-only ingest key and
 *        public by design — the same reasoning as the Sentry DSN. One variable
 *        for both halves so the server and the browser cannot disagree.
 * WHERE: Guards trackFunnelEvent, and the browser provider.
 */
export function isPostHogConfigured(): boolean {
  return Boolean(process.env["NEXT_PUBLIC_POSTHOG_KEY"]?.trim());
}

function posthogHost(): string {
  return (
    process.env["NEXT_PUBLIC_POSTHOG_HOST"]?.trim() ||
    "https://us.i.posthog.com"
  );
}

/* One client per process. PostHog's node client batches and flushes on a
 * timer, so constructing one per event would both lose the batching and leak a
 * timer per call. */
let clientPromise: Promise<import("posthog-node").PostHog | null> | null = null;

async function loadClient(): Promise<import("posthog-node").PostHog | null> {
  if (!isPostHogConfigured()) return null;

  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const { PostHog } = await import("posthog-node");
        const key = process.env["NEXT_PUBLIC_POSTHOG_KEY"]?.trim();
        if (!key) return null;
        return new PostHog(key, {
          host: posthogHost(),
          /* Small batches and a short timer: these are low-volume funnel
           * events on a serverless runtime that may be frozen seconds after a
           * response, so sitting on a large buffer loses them. */
          flushAt: 1,
          flushInterval: 0,
        });
      } catch (error) {
        console.error("[observability/analytics] client unavailable:", error);
        return null;
      }
    })();
  }

  return clientPromise;
}

/**
 * SOURCE OF TRUTH KEYWORDS: trackFunnelEvent, ORGANIZATION_IS_THE_SUBJECT,
 *   ALWAYS_LOG_THEN_MAYBE_SEND
 *
 * WHAT:  Records one funnel step.
 *
 * WHY:   ALWAYS_LOG_THEN_MAYBE_SEND, the same ordering as `captureError` and
 *        for the same reason: the structured log line goes out whether or not
 *        PostHog is configured, so a deployment with no key can still answer
 *        funnel questions from its own logs. That also makes the events
 *        testable without a third party.
 *
 *        ORGANIZATION_IS_THE_SUBJECT — `distinctId` is the organization. See
 *        the file header for why keying on users would inflate every count by
 *        the seat count.
 *
 *        Fire-and-forget by design: nothing awaits the send, and a failure is
 *        swallowed. The only thing a caller is promised is that this returns.
 * WHERE: See the file header.
 */
export function trackFunnelEvent(args: {
  event: FunnelEvent;
  organizationId: string;
  requestId: string;
  userId?: string | undefined;
  properties?: Record<string, string | number | boolean | null> | undefined;
}): void {
  /* ALWAYS. */
  logLine({
    level: "info",
    logger: "funnel",
    event: args.event,
    requestId: args.requestId,
    organizationId: args.organizationId,
    userId: args.userId,
    ...(args.properties !== undefined ? { data: args.properties } : {}),
  });

  void send(args);
}

async function send(args: {
  event: FunnelEvent;
  organizationId: string;
  requestId: string;
  userId?: string | undefined;
  properties?: Record<string, string | number | boolean | null> | undefined;
}): Promise<void> {
  try {
    const client = await loadClient();
    if (client === null) return;

    client.capture({
      distinctId: args.organizationId,
      event: args.event,
      properties: {
        ...(args.properties ?? {}),
        /* The correlation id travels into analytics too, so a funnel anomaly
         * can be traced back to the exact request in the logs and in Sentry. */
        requestId: args.requestId,
        ...(args.userId !== undefined ? { userId: args.userId } : {}),
        organizationId: args.organizationId,
      },
    });
  } catch (error) {
    /* NEVER_THROW_FROM_ANALYTICS. */
    console.error("[observability/analytics] capture failed:", error);
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: flushAnalytics, FLUSH_BEFORE_THE_PROCESS_DIES
 *
 * WHAT:  Waits for buffered events.
 * WHY:   The same serverless hazard as `flushSentry`: an invocation can be
 *        frozen the moment it returns. Called only where an event is the last
 *        thing a run does.
 * WHERE: Workflow steps that emit a funnel event.
 */
export async function flushAnalytics(): Promise<void> {
  try {
    const client = await loadClient();
    if (client === null) return;
    await client.flush();
  } catch (error) {
    console.error("[observability/analytics] flush failed:", error);
  }
}
