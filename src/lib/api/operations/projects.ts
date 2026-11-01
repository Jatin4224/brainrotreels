/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: createProjectOperation, CreateProjectInput,
 *   ONE_OPERATION_THREE_SURFACES, THE_ORG_COMES_FROM_THE_CONTEXT,
 *   THE_GATES_RAN_BEFORE_THIS
 *
 * WHAT:  Creates a project. The first of the seven verbs Phase 17 opens to
 *        REST and MCP.
 *
 * WHY:   THE_ORG_COMES_FROM_THE_CONTEXT, and it is why the input type is an
 *        `Omit` rather than the schema's own. Every tRPC input carries
 *        `organizationId` because the procedure factory reads the tenant from
 *        the input to establish the boundary before any gate runs — but an
 *        operation is handed the organization it is acting for. Taking it
 *        twice would mean two sources of truth for the one field that decides
 *        which workspace is being written to, and a surface that passed the
 *        request's id in the input and a key's id in the context would write
 *        to whichever this function happened to read.
 *
 *        THE_GATES_RAN_BEFORE_THIS: there is no limit check here. `projects`
 *        has a monthly limit in the registry and it is the procedure factory
 *        that enforces and increments it on the web; the REST layer applies
 *        the same registry entry before calling this. An operation that also
 *        checked would double-count on one surface or make the gate look
 *        optional on the other.
 * WHERE: `projects.create`; POST /projects (17b); `create_project` (17c).
 */

import "server-only";

import * as projectsService from "@/services/projects.service";
import type { OperationContext } from "@/lib/types/api";
import type { CreateProjectValues } from "@/lib/types/project";

export type CreateProjectInput = Omit<CreateProjectValues, "organizationId">;

export async function createProjectOperation(
  ctx: OperationContext,
  input: CreateProjectInput,
) {
  return projectsService.createProject(ctx.db, {
    organizationId: ctx.organizationId,
    title: input.title,
    kind: input.kind,
    aspect: input.aspect,
    ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
    ...(input.settings !== undefined ? { settings: input.settings } : {}),
  });
}
