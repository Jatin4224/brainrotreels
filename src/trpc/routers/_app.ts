/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: appRouter, AppRouter
 *
 * WHAT:  Root tRPC router that mounts every feature sub-router; `AppRouter` is
 *        the type exported for the client typed-hooks and the server proxy.
 * WHY:   Single composition point means new feature routers are wired by adding
 *        one line here; the type flows automatically to clients and the in-process proxy.
 * WHERE: Imported by src/trpc/server.tsx, src/trpc/react-provider.tsx, and
 *        src/app/api/trpc/[trpc]/route.ts. Mounts routers from src/trpc/routers/*.
 */

import { createTRPCRouter } from "../init";
import { organizationRouter } from "./organization";
import { usageRouter } from "./usage";
import { auditLogsRouter } from "./audit-logs";
import { memberRouter } from "./member";
import { invitationRouter } from "./invitation";
import { organizationRolesRouter } from "./organization-roles";
import { billingRouter } from "./billing";
import { organizationSettingsRouter } from "./organization-settings";
import { portalRouter } from "./portal";
import { devRouter } from "./dev";
import { userRouter } from "./user";
import { projectsRouter } from "./projects";
import { assetsRouter } from "./assets";
import { backgroundsRouter } from "./backgrounds";
import { redditRouter } from "./reddit";
import { quizzesRouter } from "./quizzes";
import { avatarsRouter } from "./avatars";
import { visualsRouter } from "./visuals";
import { rendersRouter } from "./renders";
import { creditsRouter } from "./credits";
import { scriptsRouter } from "./scripts";
import { captionsRouter } from "./captions";
import { voicesRouter } from "./voices";
import { timelineRouter } from "./timeline";

/**
 * SOURCE OF TRUTH KEYWORDS: appRouter, AppRouter
 *
 * WHAT:  The composed root router and its inferred type.
 * WHY:   `AppRouter` is the single type clients use to derive end-to-end safety;
 *        every sub-router added below extends that public surface automatically.
 * WHERE: Consumed by the server proxy (src/trpc/server.tsx), the React hooks
 *        (src/trpc/react-provider.tsx), and the HTTP handler under src/app/api/trpc.
 */
export const appRouter = createTRPCRouter({
  organization: organizationRouter,
  projects: projectsRouter,
  assets: assetsRouter,
  backgroundLibrary: backgroundsRouter,
  redditStories: redditRouter,
  quizzes: quizzesRouter,
  avatars: avatarsRouter,
  /* Mounted under the REGISTRY KEY, which is what wires its permissions and
   * rate limits — the factory derives both from the procedure path. */
  aiImages: visualsRouter,
  renders: rendersRouter,
  credits: creditsRouter,
  scripts: scriptsRouter,
  voices: voicesRouter,
  captions: captionsRouter,
  /* Mounted under the REGISTRY KEY, which is what gates the whole router: the
   * factory refuses every verb of a flag resource the plan does not include —
   * GATE_IS_THE_WHOLE_ROUTER in src/trpc/routers/timeline.ts. */
  timelineEditor: timelineRouter,
  usage: usageRouter,
  auditLogs: auditLogsRouter,
  member: memberRouter,
  invitation: invitationRouter,
  organizationRoles: organizationRolesRouter,
  billing: billingRouter,
  organizationSettings: organizationSettingsRouter,
  portal: portalRouter,
  dev: devRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
