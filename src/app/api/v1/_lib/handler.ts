/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: runApiRoute, ONE_PIPELINE_EVERY_ROUTE,
 *   THE_GATE_IS_CALLED_NOT_REIMPLEMENTED, QUOTAS_ARE_SHARED_PER_ORGANIZATION,
 *   COUNTED_AFTER_SUCCESS, A_ROUTE_IS_FOUR_LINES
 *
 * WHAT:  Everything that happens around a shared operation on the REST
 *        surface: authenticate, gate, validate, deduplicate, run, envelope,
 *        meter, translate the failure.
 *
 * WHY:   ONE_PIPELINE_EVERY_ROUTE, and A_ROUTE_IS_FOUR_LINES is the test of
 *        whether it worked. Each route file names its schema, its metered
 *        resource and the operation to call; everything a route could get
 *        subtly wrong — forgetting the entitlement check, forgetting to count
 *        the call, returning a bare object instead of the envelope, letting an
 *        `OperationError` escape as a 500 — happens here instead, once. The
 *        same argument that puts the gates in the tRPC procedure factory
 *        rather than trusting each handler.
 *
 *        THE_GATE_IS_CALLED_NOT_REIMPLEMENTED. Every entitlement decision is a
 *        call into `src/lib/feature-gate.ts`, reading the same registry
 *        entries the web app reads. There is no plan comparison and no limit
 *        arithmetic in this file.
 *
 *        QUOTAS_ARE_SHARED_PER_ORGANIZATION, which is the phase file's step 12
 *        and its most easily misread done-when: "burning the API quota does
 *        not block the same workspace's UI jobs beyond the shared cap — and
 *        the shared cap is the intended behaviour, not a bug". So a render
 *        started through the API counts against the SAME monthly `renders`
 *        limit the dashboard counts against, because it is the same video on
 *        the same plan. What is NOT shared is the per-key daily quota, which
 *        is a blast radius rather than an entitlement — see the authenticator.
 *
 *        COUNTED_AFTER_SUCCESS. `apiCalls` and the verb's own resource are
 *        incremented only once the operation has returned, mirroring the
 *        factory's "increments after the handler". A refused request must not
 *        consume the allowance it was refused by, or a workspace at its limit
 *        would be unable to discover that it is at its limit.
 *
 *        A REPLAYED request counts nothing, because it did nothing. That is
 *        the one place this file deliberately differs from "count every
 *        request": charging twice for a deduplicated retry would make the
 *        idempotency key a liability.
 * WHERE: Every route under src/app/api/v1/.
 */

import "server-only";

import type { z } from "zod";

import { OperationError, isOperationError } from "@/lib/errors";
import { checkFeatureGate } from "@/lib/feature-gate";
import { resolveRequestId } from "@/lib/observability";
import type { LimitResourceKey } from "@/lib/resources";
import { API_ERROR_CODES, type OperationContext } from "@/lib/types/api";
import { incrementUsage } from "@/services/usage.service";

import { authenticateApiRequest } from "./authenticate";
import {
  OPERATION_FAILURE_TO_API_ERROR,
  apiFail,
  apiOk,
} from "./envelope";
import {
  IDEMPOTENCY_HEADER,
  claimIdempotencyKey,
  releaseIdempotencyKey,
  requestFingerprint,
  storeIdempotentResponse,
} from "./idempotency";

export interface ApiRouteConfig<TInput, TOutput> {
  /**
   * Where the input comes from. `body` parses JSON, `query` builds an object
   * from the search params — nothing reads both, so a route cannot disagree
   * with its own documentation about where a field lives.
   */
  input: "body" | "query";
  schema: z.ZodType<TInput>;
  /**
   * The verb's own metered resource, when it has one. `projects` for creating
   * a project, `renders` for starting a render; omitted for reads, which cost
   * nothing beyond the `apiCalls` quota every request pays.
   */
  resource?: LimitResourceKey;
  /**
   * SOURCE OF TRUTH KEYWORDS: countOnSuccess, THE_GATE_ALWAYS_THE_COUNTER_SOMETIMES
   *
   * Whether this particular success consumed the resource. Omitted means "yes,
   * always", which is true of every verb but one.
   *
   * THE_GATE_ALWAYS_THE_COUNTER_SOMETIMES. A render of a document that has
   * already been rendered returns the existing row and must not spend a slot
   * (REUSE_COSTS_NOTHING) — but the GATE must still apply, because a workspace
   * at its limit should be refused before any work. Splitting the two means
   * the refusal is still a 429 with the registry's own sentence, while the
   * counter follows what actually happened.
   *
   * It is a predicate on the OUTPUT rather than a flag on the config because
   * only the operation knows: it reports `reused`, and this is where that
   * report is spent.
   */
  countOnSuccess?: (output: TOutput) => boolean;
  /** POSTs honour `Idempotency-Key`; reads have nothing to deduplicate. */
  idempotent?: boolean;
  /** 201 for a creation, which is the only reason to override 200. */
  successStatus?: number;
  run: (operation: OperationContext, input: TInput) => Promise<TOutput>;
}

export async function runApiRoute<TInput, TOutput>(
  request: Request,
  config: ApiRouteConfig<TInput, TOutput>,
): Promise<Response> {
  const requestId = resolveRequestId(request.headers);

  const auth = await authenticateApiRequest(request, requestId);
  if (!auth.ok) return auth.response;
  const { operation } = auth.caller;

  /* Read ONCE: a Request body is a stream and reading it twice throws. The
   * text is needed both for parsing and for the idempotency fingerprint. */
  let rawBody = "";
  if (config.input === "body") {
    try {
      rawBody = await request.text();
    } catch {
      return apiFail(
        API_ERROR_CODES.invalid_request,
        "Could not read the request body.",
        400,
        requestId,
      );
    }
  }

  /**
   * COUNTED_AFTER_SUCCESS, but CHECKED here — before the body is even parsed,
   * because a workspace over its quota should be told so for the price of one
   * gate read rather than after we have done the work.
   *
   * Two gates, both from the registry: the API's own call allowance and the
   * verb's own metered resource (QUOTAS_ARE_SHARED_PER_ORGANIZATION).
   */
  const callGate = await checkFeatureGate(operation.organizationId, "apiCalls");
  if (!callGate.allowed) {
    return apiFail(
      API_ERROR_CODES.quota_exceeded,
      callGate.reason ?? callGate.upgradeMessage,
      429,
      requestId,
    );
  }

  if (config.resource !== undefined) {
    const resourceGate = await checkFeatureGate(
      operation.organizationId,
      config.resource,
    );
    if (!resourceGate.allowed) {
      return apiFail(
        API_ERROR_CODES.quota_exceeded,
        resourceGate.reason ?? resourceGate.upgradeMessage,
        429,
        requestId,
      );
    }
  }

  const parsed = parseInput(config, request, rawBody);
  if (!parsed.ok) {
    return apiFail(
      API_ERROR_CODES.invalid_request,
      parsed.message,
      400,
      requestId,
    );
  }

  /* Idempotency is claimed AFTER validation, so a malformed request does not
   * burn a key the client will reuse once it has fixed the payload. */
  const url = new URL(request.url);
  const claim =
    config.idempotent === true
      ? await claimIdempotencyKey({
          organizationId: operation.organizationId,
          presentedKey: request.headers.get(IDEMPOTENCY_HEADER),
          fingerprint: requestFingerprint({
            method: request.method,
            path: url.pathname,
            body: rawBody,
          }),
        })
      : ({ kind: "not-applicable" } as const);

  if (claim.kind === "conflict") {
    return apiFail(API_ERROR_CODES.conflict, claim.message, 409, requestId);
  }

  if (claim.kind === "replay") {
    /* The stored body verbatim, with its own requestId inside it — the one
     * from the original call, which is the request that actually did the work
     * and the one an operator should be looking at. The header says this is a
     * replay so a client can tell. */
    return new Response(claim.body, {
      status: claim.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Idempotent-Replay": "true",
      },
    });
  }

  try {
    const output = await config.run(operation, parsed.value);

    /* COUNTED_AFTER_SUCCESS — both counters, after the work, never on a
     * refusal. A replay reaches neither, because it did nothing. */
    await incrementUsage(operation.organizationId, "apiCalls", 1);

    /* THE_GATE_ALWAYS_THE_COUNTER_SOMETIMES — the gate above ran whatever
     * happened; this follows what the operation reports it did. */
    const consumed =
      config.countOnSuccess === undefined || config.countOnSuccess(output);
    if (config.resource !== undefined && consumed) {
      await incrementUsage(operation.organizationId, config.resource, 1);
    }

    const status = config.successStatus ?? 200;
    const body = JSON.stringify({ data: output, requestId });

    if (claim.kind === "claimed") {
      await storeIdempotentResponse({
        redisKey: claim.redisKey,
        fingerprint: claim.fingerprint,
        status,
        body,
      });
    }

    return new Response(body, {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    /* A_FAILURE_RELEASES_THE_CLAIM — the retry this header exists for has to
     * be able to proceed. */
    if (claim.kind === "claimed") {
      await releaseIdempotencyKey(claim.redisKey);
    }

    if (isOperationError(error)) {
      const mapped = OPERATION_FAILURE_TO_API_ERROR[error.failure];
      return apiFail(mapped.code, error.message, mapped.status, requestId);
    }

    /* Not ours: a bug, a database failure, a provider outage. It gets a 500
     * and a log line with the request id in it, because a tidy 4xx here is how
     * a real fault goes uninvestigated. */
    console.error(`[api/v1] ${request.method} ${url.pathname} failed`, {
      requestId,
      error,
    });
    return apiFail(
      API_ERROR_CODES.internal_error,
      "Something went wrong on our side. Quote the requestId if you contact support.",
      500,
      requestId,
    );
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: parseInput, ZOD_IS_THE_CONTRACT,
 *   THE_FIRST_ISSUE_IS_THE_MESSAGE
 *
 * WHAT:  The validated input, or why it was refused.
 * WHY:   ZOD_IS_THE_CONTRACT (CLAUDE.md rule 5) — the same schemas the tRPC
 *        procedures validate with, so the REST surface cannot accept something
 *        the web app would reject.
 *
 *        THE_FIRST_ISSUE_IS_THE_MESSAGE: one specific sentence naming the
 *        field, rather than a serialised issue array. A client reading
 *        `error.message` gets something actionable, and a client that wants
 *        structure has the OpenAPI document. Returning every issue would make
 *        the common case — one typo — harder to read.
 * WHERE: runApiRoute.
 */
function parseInput<TInput, TOutput>(
  config: ApiRouteConfig<TInput, TOutput>,
  request: Request,
  rawBody: string,
): { ok: true; value: TInput } | { ok: false; message: string } {
  let candidate: unknown;

  if (config.input === "body") {
    if (rawBody.trim().length === 0) {
      candidate = {};
    } else {
      try {
        candidate = JSON.parse(rawBody);
      } catch {
        return { ok: false, message: "The request body is not valid JSON." };
      }
    }
  } else {
    /* Repeated params collapse to the last value, which is what every HTTP
     * client means by `?kind=a&kind=b` being a mistake. An endpoint needing a
     * genuine list takes a comma-separated string and says so in its schema. */
    candidate = Object.fromEntries(new URL(request.url).searchParams);
  }

  const result = config.schema.safeParse(candidate);
  if (result.success) return { ok: true, value: result.data };

  const issue = result.error.issues[0];
  const path = issue?.path.join(".");
  return {
    ok: false,
    message:
      issue === undefined
        ? "The request could not be validated."
        : path !== undefined && path.length > 0
          ? `${path}: ${issue.message}`
          : issue.message,
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: methodNotAllowed, EVERY_ROUTE_ANSWERS_IN_THE_ENVELOPE
 *
 * WHAT:  The answer for a verb a route does not implement.
 * WHY:   Next.js answers an unexported method with a bare 405 and no body, so
 *        a client would get its only non-enveloped response from us at exactly
 *        the moment it is confused about the shape. Exporting this keeps the
 *        promise that every response has `{ error, requestId }`.
 * WHERE: Routes export it for the verbs they do not serve.
 */
export function methodNotAllowed(request: Request, allow: string): Response {
  return apiFail(
    API_ERROR_CODES.method_not_allowed,
    `This endpoint accepts ${allow}.`,
    405,
    resolveRequestId(request.headers),
    { Allow: allow },
  );
}

/* Re-exported so a route needing to refuse something of its own does not have
 * to import from two places. */
export { OperationError, apiFail, apiOk };
