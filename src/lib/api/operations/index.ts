/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: operations barrel, ONE_OPERATION_THREE_SURFACES,
 *   THE_SHARED_SEAM, SEVEN_VERBS
 *
 * WHAT:  The public surface of the shared operation layer — the seven verbs
 *        Phase 17 opens to the web app, the REST API and the MCP server.
 *
 * WHY:   THE_SHARED_SEAM. Phase 17's requirement is that "a rule changed in an
 *        operation function changes behaviour on web, REST and MCP at once",
 *        and this barrel is the list of things that promise holds for. Every
 *        function here takes an `OperationContext` first, throws only
 *        `OperationError`, and touches the database exclusively through
 *        services — so the three entry points differ only in how they
 *        authenticate, how they gate, and how they shape a response.
 *
 *        SEVEN_VERBS, matching the phase file's REST route list and its MCP
 *        tool list exactly: create a project, generate a script, assign a
 *        voice, start a render, read a render, fetch an output, and read the
 *        catalogues. That is a DELIBERATE boundary rather than everything the
 *        product can do — the web app has over a hundred procedures, and a
 *        public API that exposed all of them would be a commitment to keep
 *        every one of them stable forever.
 *
 *        Importers use this barrel rather than the individual files, so the
 *        internal split by subject stays free to change.
 *
 *        Every file here is `server-only`: they reach services, the jobs
 *        adapter and the feature gate. The pure rules they decide with —
 *        pricing, availability, timeline validation — all live elsewhere and
 *        are tested without a database.
 * WHERE: src/trpc/routers/* today; src/app/api/v1/* in 17b; src/app/api/mcp in
 *        17c.
 */

export { createProjectOperation } from "./projects";
export type { CreateProjectInput } from "./projects";

export { generateScriptOperation, scriptCostFor } from "./scripts";
export type { GenerateScriptInput } from "./scripts";

export { assignVoiceOperation } from "./voices";
export type { AssignVoiceInput } from "./voices";

export { createRenderOperation, getRenderOperation } from "./renders";
export type { CreateRenderInput } from "./renders";

export { getOutputOperation } from "./outputs";

export {
  listBackgroundCatalogOperation,
  listCaptionStyleCatalogOperation,
  listVoiceCatalogOperation,
} from "./catalog";
export type {
  ListBackgroundCatalogInput,
  ListCaptionStyleCatalogInput,
  ListVoiceCatalogInput,
} from "./catalog";
