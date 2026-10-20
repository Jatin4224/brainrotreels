/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: router, baseProcedure, authProcedure,
 *   protectedProcedure
 *
 * WHAT:  Barrel that re-exports the router builder and procedure factories
 *        from `./protected`.
 * WHY:   Lets src/trpc/init.ts (and anyone else) depend on `@/trpc/procedures`
 *        without reaching into the implementation file directly.
 * WHERE: Imported by src/trpc/init.ts; sourced from src/trpc/procedures/protected.ts.
 */

export {
  router,
  baseProcedure,
  authProcedure,
  protectedProcedure,
} from "./protected";
