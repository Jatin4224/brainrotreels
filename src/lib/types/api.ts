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

import type { PlanKey } from "@/lib/config/plans";
import type { DbClient } from "@/lib/config/prisma";

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
