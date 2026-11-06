/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: prisma, DbClient
 *
 * WHAT:  Singleton PrismaClient cached on globalThis in dev to survive HMR,
 *        plus the shared DbClient union accepted by services that may run
 *        either inside an active tx or against the singleton.
 * WHY:   Without the global cache, Next.js dev hot-reloads create a new client
 *        on every change and the connection pool blows up; in production a
 *        fresh instance is created exactly once at module init.
 *        THE_CLIENT_IS_NEVER_BUNDLED. `server-only` is what enforces that, and
 *        it is load-bearing rather than decorative: the singleton is
 *        constructed at MODULE SCOPE, so merely importing this file is enough
 *        to pull the generated client in. It used to be re-exported from
 *        `src/lib/config/index.ts`, which nineteen client components import for
 *        `ROUTES`, `BRANDING` and `PLANS` — and the result was 291 KB of
 *        generated Prisma, `PrismaClientKnownRequestError` and
 *        `globalThis.__prisma ?? new PrismaClient` in the browser bundle of
 *        every page. Nothing broke, because the browser build's constructor is
 *        a Proxy that only throws on property access, so it was pure dead
 *        weight on first paint with no symptom to notice.
 *
 *        With this import, a client component reaching for the database is a
 *        BUILD error naming the file, which is the only version of this rule
 *        that cannot quietly regress.
 * WHERE: Imported directly as `@/lib/config/prisma` by auth.ts, every service
 *        and the tRPC context. Deliberately NOT in the config barrel.
 */

import "server-only";

import { PrismaClient, type Prisma } from "@/generated/prisma";

type GlobalWithPrisma = typeof globalThis & {
  __prisma?: PrismaClient;
};

const globalForPrisma = globalThis as GlobalWithPrisma;

export const prisma = globalForPrisma.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;

/**
 * SOURCE OF TRUTH KEYWORDS: DbClient
 *
 * WHAT:  Union of the singleton client and an active tx client.
 * WHY:   Services that may run inside `prisma.$transaction(...)` accept this
 *        so callers can pass `tx` and the write enlists in the active tx.
 * WHERE: Used by every service that takes a `db` parameter.
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;
