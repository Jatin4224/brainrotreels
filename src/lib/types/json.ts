/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: jsonValueSchema, JsonValue, jsonObjectSchema,
 *   JsonObject, RECURSIVE_JSON_SCHEMA, Prisma.InputJsonValue, settings json,
 *   scene element props
 *
 * WHAT:  A zod schema for arbitrary JSON, and the type it infers.
 * WHY:   Several columns and sub-objects are genuinely open-ended — a Project's
 *        `settings`, a scene element's `props` — and the only honest type for
 *        them is "JSON". Without this they would be typed `unknown` (banned) or
 *        `any` (banned), or worse, frozen into a premature shape that every
 *        later format has to fight. Declared once here so the recursion is
 *        written once: zod needs an explicit annotation on a self-referential
 *        schema, and getting that wrong produces an `any`-flavoured infinite
 *        type rather than a compile error.
 *        It is structurally compatible with Prisma's `InputJsonValue`, which is
 *        what lets a validated value be written straight to a Json column.
 * WHERE: Imported by src/lib/types/project.ts (Project.settings) and
 *        src/lib/timeline/schema.ts (scene element props). Re-exported from
 *        src/lib/types.
 */

import { z } from "zod";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/* The annotation is load-bearing, not decorative — see the WHY above. */
export const jsonValueSchema: z.ZodType<JsonValue, JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export type JsonObject = { [key: string]: JsonValue };

export const jsonObjectSchema: z.ZodType<JsonObject, JsonObject> = z.record(
  z.string(),
  jsonValueSchema,
);
