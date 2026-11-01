/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: OperationContext, ONE_OPERATION_THREE_SURFACES,
 *   CONTEXT_IS_EXPLICIT_NOT_AMBIENT, THE_GATES_RAN_BEFORE_THIS,
 *   USER_IS_NULL_FOR_A_KEY
 *
 * WHAT:  What every shared operation in `src/lib/api/operations/` is handed:
 *        the workspace, its plan, who is asking, a database handle and the
 *        request id.
 *
 * WHY:   ONE_OPERATION_THREE_SURFACES is Phase 17's central requirement — "a
 *        rule changed in an operation function changes behaviour on web, REST
 *        and MCP at once" — and this type is what makes it possible. The web
 *        app reaches these functions through a tRPC procedure, the REST API
 *        through a Bearer key, and the MCP server through a tool call; all
 *        three build one of these and call the same function. There is no
 *        second implementation to keep in step, which matters because the
 *        drift would be SILENT: a REST route that re-derived one rule would
 *        look correct, pass its own tests, and quietly behave differently from
 *        the product.
 *
 *        CONTEXT_IS_EXPLICIT_NOT_AMBIENT. Every field is passed in. Nothing
 *        here is read from `headers()`, a session, or a module-level
 *        singleton, because two of the three callers have no request-scoped
 *        anything: an MCP tool call and a REST request authenticated by a key
 *        have no cookie and no session. An operation that reached for ambient
 *        state would work on exactly one surface and throw on the other two —
 *        and it is also what makes these functions testable without a
 *        framework.
 *
 *        THE_GATES_RAN_BEFORE_THIS. An operation does not check plans,
 *        permissions, quotas or rate limits, and it has no way to: `plan` is
 *        here because operations make PRICING and AVAILABILITY decisions from
 *        it (which resolutions, which voices, what a render costs), not so
 *        they can refuse access. Access was decided by the surface before this
 *        object existed — by the procedure factory on the web, by the key
 *        middleware on REST. Moving those checks inside would run them twice
 *        on the web and give an operation two jobs, and an operation that
 *        sometimes refuses is one a caller stops gating "because it checks
 *        anyway".
 *
 *        USER_IS_NULL_FOR_A_KEY, which is why `userId` is nullable rather than
 *        a placeholder string. A key-authenticated call has an organization
 *        but no human, and that distinction has to survive: it is what an
 *        audit row records as the actor, and a fabricated id would attribute a
 *        script to whoever created the key months earlier. Nothing in an
 *        operation may branch on it being present — it is for attribution.
 *
 *        `db` is a `DbClient` and not `prisma`, so a caller can pass a
 *        transaction. The tRPC factory already runs a mutation inside one, and
 *        an operation that reached for the global client would commit outside
 *        its caller's transaction — which is how a half-applied mutation stops
 *        rolling back.
 * WHERE: The single first argument of every function in
 *        src/lib/api/operations/. Built by src/trpc/operation-context.ts for
 *        the web app, and by the REST and MCP entry points in 17b and 17c.
 */

import { z } from "zod";

import type { PlanKey } from "@/lib/config/plans";
import type { DbClient } from "@/lib/config/prisma";
import { listCaptionStylesSchema } from "./caption";
import { createProjectSchema } from "./project";
import { createRenderSchema } from "./render";
import { generateScriptSchema } from "./script";
import { assignVoiceSchema, listVoicesSchema } from "./voice";

export interface OperationContext {
  organizationId: string;
  /** The workspace's plan, for pricing and availability — never for access. */
  plan: PlanKey;
  /** Null for a key-authenticated call. See USER_IS_NULL_FOR_A_KEY. */
  userId: string | null;
  /** May be a transaction. See the note above. */
  db: DbClient;
  /** Carried into job events so a run can be traced back to its request. */
  requestId: string;
}

/**
 * SOURCE OF TRUTH KEYWORDS: createApiKeySchema, listApiKeysSchema,
 *   revokeApiKeySchema, ORGANIZATION_ID_IS_ON_EVERY_INPUT,
 *   A_NAME_IS_THE_ONLY_INPUT
 *
 * WHAT:  The three inputs the developers screen sends.
 *
 * WHY:   A_NAME_IS_THE_ONLY_INPUT on creation, and the omissions are the
 *        design. A client may not choose the key's prefix, its secret, its
 *        length or its quota: the format is decided by `src/lib/api/keys.ts`
 *        so every key in the system has the same entropy and the same
 *        recognisable shape, and `dailyQuota` takes the column's default
 *        because a per-key quota a customer could raise themselves is not a
 *        quota. A name is the one thing only the person minting it knows —
 *        which deploy this is for — and it exists so revoking the right key
 *        later is possible at all.
 *
 *        `revoke` takes an ID and nothing else. There is deliberately no
 *        "revoke all" and no update: rotating means minting a new key and
 *        revoking the old one, in that order, which is the only sequence that
 *        does not take a customer's integration down between the two steps.
 *
 *        ORGANIZATION_ID_IS_ON_EVERY_INPUT because the procedure factory reads
 *        the tenant from the input to establish the boundary before any gate
 *        runs.
 * WHERE: `apiKeys.create`, `.list`, `.revoke`.
 */
export const createApiKeySchema = z.object({
  organizationId: z.string().min(1),
  /* Long enough for "Production Vercel — video pipeline", short enough to
   * render in a table cell. */
  name: z.string().trim().min(1).max(60),
});

export type CreateApiKeyValues = z.infer<typeof createApiKeySchema>;

export const listApiKeysSchema = z.object({
  organizationId: z.string().min(1),
});

export const revokeApiKeySchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
});

export type RevokeApiKeyValues = z.infer<typeof revokeApiKeySchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: REST body schemas, apiCreateProjectSchema,
 *   apiGenerateScriptSchema, apiAssignVoiceSchema, apiCreateRenderSchema,
 *   DERIVED_NOT_REDECLARED, THE_KEY_SUPPLIES_THE_TENANT
 *
 * WHAT:  What each `/api/v1` POST accepts, and what the OpenAPI document
 *        describes.
 *
 * WHY:   DERIVED_NOT_REDECLARED. Each one is the tRPC input with
 *        `organizationId` omitted — one `.omit()` rather than a second
 *        hand-written object. A re-declared schema is the drift Phase 17 is
 *        about, in its purest form: the REST surface would accept a field the
 *        web app had tightened, or reject one it had relaxed, and both would
 *        look correct in isolation. Deriving means a change to a validation
 *        rule reaches the API, the MCP server and the generated OpenAPI
 *        document without anybody remembering to copy it.
 *
 *        THE_KEY_SUPPLIES_THE_TENANT. `organizationId` is the one field that
 *        must NOT be in a REST body: it comes from the key, which is the only
 *        thing that proves which workspace is calling. A body field would be a
 *        caller asserting its own tenancy — and a route that read it would be
 *        one typo away from acting on another workspace.
 *
 *        The path parameters (`/renders/:id`, `/projects/:id/voices`) are not
 *        here, because a path segment is not part of a body. Routes validate
 *        those themselves and pass them into the operation.
 * WHERE: src/app/api/v1/*; the OpenAPI document.
 */
export const apiCreateProjectSchema = createProjectSchema.omit({
  organizationId: true,
});

export const apiGenerateScriptSchema = generateScriptSchema.omit({
  organizationId: true,
});

/* Also without `projectId`: it is in the path (`/projects/:id/voices`), and a
 * body that could disagree with the URL is a question nobody should have to
 * answer. The route puts the path's value back. */
export const apiAssignVoiceSchema = assignVoiceSchema.omit({
  organizationId: true,
  projectId: true,
});

export const apiCreateRenderSchema = createRenderSchema.omit({
  organizationId: true,
});

/* The catalogue reads take their filters from the query string. Each is the
 * tRPC input minus the tenant, so `?search=` and `?family=` mean exactly what
 * they mean on the web. */
export const apiVoiceCatalogSchema = listVoicesSchema.omit({
  organizationId: true,
});

export const apiCaptionStyleCatalogSchema = listCaptionStylesSchema.omit({
  organizationId: true,
});

/**
 * SOURCE OF TRUTH KEYWORDS: apiBackgroundCatalogSchema, CURSOR_PAGINATION
 *
 * CURSOR_PAGINATION, as the phase file asks for. `cursor` is an OFFSET encoded
 * as a string rather than a number, because that is the shape a client should
 * treat as opaque: today it is an offset, and changing it to a keyset cursor
 * later must not be a breaking change. A client that parsed it as a number
 * would be relying on something this endpoint never promised.
 */
export const apiBackgroundCatalogSchema = z.object({
  search: z.string().trim().max(120).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type ApiBackgroundCatalogValues = z.infer<
  typeof apiBackgroundCatalogSchema
>;

/**
 * SOURCE OF TRUTH KEYWORDS: API_ERROR_CODES, ApiErrorCode
 *
 * The stable vocabulary a client may branch on. Stable is the operative word:
 * these strings are part of the public contract and may be added to but never
 * renamed, which is why they are spelled out here rather than derived from an
 * internal union that is free to change.
 *
 * The first six mirror the operation failures; the rest are refusals that
 * happen BEFORE an operation runs and so have no operation failure to map
 * from — authentication, entitlement, quota, rate limit — plus the two a
 * client cannot act on.
 */
export const API_ERROR_CODES = {
  not_found: "not_found",
  invalid_request: "invalid_request",
  precondition_failed: "precondition_failed",
  forbidden: "forbidden",
  unprocessable: "unprocessable",
  conflict: "conflict",
  unauthorized: "unauthorized",
  feature_unavailable: "feature_unavailable",
  quota_exceeded: "quota_exceeded",
  rate_limited: "rate_limited",
  method_not_allowed: "method_not_allowed",
  internal_error: "internal_error",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];
