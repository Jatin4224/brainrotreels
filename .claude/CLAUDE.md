<!--
  Copyright (c) 2026 Web Prodigies LLC. All rights reserved.

  This source code is proprietary and licensed under the Architectural
  Guardrail Community License found in the LICENSE file in the root
  directory of this source tree. Use requires a paid AI Era membership
  or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
  or distribution is prohibited.
-->

# Every rule here must be followed.

## 1. Build from existing patterns, not new ones

You are building this app as a pattern-recognition model: everything you write should come from patterns and coding practices already in this codebase. Never invent your own architecture, pull in your own libraries, or start a new pattern without first confirming that a similar one doesn't already exist.

The app runs on a SOURCE OF TRUTH global architecture, which is already established — your job is to build into it. Globalize what you write so the app stays modular and future features are a plug-in rather than a rewrite; nothing should be tightly coupled, and swapping a tech stack, a business rule, or a strategy should be easy. That applies to configuration, Redux, and layered code where each layer is an independent task (the same way the tRPC procedures are built).

But don't create blindly. You have to know whether something that already facilitates your work exists. Only when no existing architecture can support the new feature should you build something new.

## 2. How to search: `grep -l` first

The whole codebase carries a `SOURCE OF TRUTH KEYWORDS` line at the top of each file and code block precisely so you can find things without reading everything. This is what keeps context pollution at zero and stops us from burning through session limits.

Before creating any type, function, constant, or component, grep for it by keyword — and you must grep with `-l`. That gives you the list of _files_ where the thing could live; you then narrow to where it's most likely to be and read only those files. It's the fastest path that also protects the context window. If the keyword search turns up nothing, search the codebase normally. If you find it, follow what's already there.

If you do have to create something new, give it its own `SOURCE OF TRUTH KEYWORDS` line with 5–6 specific keywords so the next agent can find it and understand how it works.

Never create a duplicate type, function, component, or block of code because grep felt like work. I have already created all types, if you search for them you will most likely find them.

## 3. The layered architecture

1. **Protected procedure — the heart of the app.** Every important router endpoint should and has to use it. It already does a ton of heavy lifting: feature gates, usage checks, permissions, and authorization are all handled server-side, so don't re-check any of it. TypeScript will show you what it needs.
2. **Routers** consume the protected procedure and hold business logic — validation, orchestration, decisions. Because the procedure already covered gates, usage, permissions, and auth, the router should only contain logic specific to the task at hand.
3. **Service layer** is the only layer that touches the database directly. Every service file must start with `import 'server-only'`; without it customers can invoke the function directly and bypass security, which violates our security guidelines. Import services into routers with `import * as` so you get object references.
4. Remember to wire up any permission the feature requires.

**Never create `middleware.ts`** — the framework reads `proxy.ts` instead.

## 4. Production-grade TypeScript

Never use `any`, `unknown`, hardcoded types, or any other TypeScript bypass — this is a production application.

For types, work in this order so we save context: if the type relates to our Prisma schema or database, use the existing Prisma type and stop there. Otherwise, check `lib/types` to see whether the custom type already exists, and only create one if it doesn't and it will genuinely be a reusable source of truth. Types are never written anywhere except `lib/types`. Dynamic typescript types should be generated for any custom types at all times! And most liekely a few types are already created so you can just leverage those and dynamically construct your own.

Run a TypeScript check every single time you hand something over, to prove the codebase is clean. Never report a false positive.

## 5. Validate every input with Zod

Every component, form, and endpoint that takes input uses a Zod schema, every single time, with React Hook Form following the shadcn approach (https://ui.shadcn.com/docs/forms/react-hook-form#approach). This is what makes data corruption impossible.

## 6. Inline comment context injection

This is the most important part of your development process: it's how other AI devs grep the codebase and understand each block through its SOT keywords. Above every function or block, write:

```
/**
 * SOURCE OF TRUTH KEYWORDS: Symbol1, Symbol2, TypeA (about 10 keywords, to power the SOT keyword search)
 * WHAT:  What this block or function is.
 * WHY:   Why it's needed here and why it's done this way.
 * WHERE: Where it's being used.
 */
```

Add ordinary inline comments too, but keep them minimal and outcome-based — don't just narrate the code.

## 7. UI

Before creating any component, check whether a reusable one already exists and use it if so. Never duplicate a component with similar functionality — extend or compose what's there. If you notice yourself copying the pattern of another component, that's the signal to globalize it instead.

Place a component that's reusable across routes or features in `components/global/COMPONENT_NAME_FOLDER`; a component used only inside one route goes in `THE_ROUTE/_components`.

Design every component for reuse: never hardcode logic, layouts, or data into it. Global means it can genuinely be reused anywhere, with custom options such as slots. A table component, for example, owns all the reusable logic — search, pagination, filters — while create, delete, and custom views come in as slots. Keep global components flexible, configurable, production-ready, and strongly typed so they scale across the app. Fewer lines is better.

For a simple new component, follow the design themes already in the app. For a complex one, you have to ask the user for a shadcn UI block link to use as a reference, then rename it to our folder structure and naming conventions and globalize it if needed.

shadcn components and blocks often arrive with outdated copy that doesn't match this app's branding — fix it.

Never hardcode theme colors (no hex values, `text-white`, `bg-[#...]`, or forced `dark` classes). Always use the theme tokens — `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-card`, `bg-primary`, `border` — so everything follows the app theme.

## 8. Delivery

Keep everything production-grade: never create scripts, Prisma scripts, seed files, or probe/tester files, or anything else that couldn't be pushed to production. Ask my permission before creating any script that performs a manual action.

Use barrel exports wherever possible, exporting as a single object where that makes sense.

Never skip a feature or leave it incomplete. If pieces are missing — because you forgot them or because the user never mentioned them — either finish them or tell the user about those outliers.

Don't use git unless told.
