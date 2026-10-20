/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PROVIDER_ALIAS, ACTIVE_PROVIDER_SURFACES
 *
 * WHAT:  The TYPE-LEVEL and default resolution target for the active provider's
 *        UI surfaces. At build time `@providers-active` is aliased to one
 *        `./active.<provider>.tsx` module (see next.config.ts), so this file's
 *        re-export is what TypeScript sees and the alias is what the bundler
 *        loads.
 * WHY:   PROVIDER_ALIAS. Every variant must export the identical shape, which is
 *        what makes aliasing type-safe: if one diverges, `tsc` fails against
 *        this file. Better Auth is the default — and today the only variant —
 *        because it is the open-source path a fresh clone runs on with no
 *        third-party account.
 * WHERE: Imported only via `@providers-active` from ./server.tsx.
 */

export * from "./active.better-auth";
