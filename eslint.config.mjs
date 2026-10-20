/*

 */

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/middleware",
                "**/middleware.ts",
                "./middleware",
                "../middleware",
              ],
              message:
                "Next.js 16 uses `proxy.ts`, not `middleware.ts`. Import from the proxy module instead.",
            },
            // PROVIDER_ISOLATION layer 3 — see src/lib/adapters/provider.ts.
            // A provider SDK may only be imported from that provider's own
            // adapter folder (and its UI implementation folder). Everything
            // else must go through the AuthAdapter contract, so adding a second
            // provider cannot quietly couple the app to either one. Add a group
            // here for every provider SDK you introduce.
            {
              group: ["better-auth", "better-auth/*", "better-auth/**"],
              message:
                "PROVIDER_ISOLATION: import the Better Auth SDK only inside src/lib/better-auth/**, src/lib/adapters/better-auth/** or src/components/global/providers/better-auth/**. Elsewhere, use getAuthAdapter() from @/lib/adapters.",
            },
            // The same fence for every NON-auth provider seam. These use their
            // own selector (src/lib/adapters/select-provider.ts), not the auth
            // machinery — see that file for why they cannot share it.
            {
              group: ["inngest", "inngest/*", "inngest/**"],
              message:
                "PROVIDER_ISOLATION: import the Inngest SDK only inside src/lib/adapters/jobs/inngest/**, src/inngest/** or src/app/api/inngest/**. Elsewhere, use enqueue() from @/lib/adapters/jobs.",
            },
            {
              group: ["@aws-sdk/*", "@aws-sdk/**"],
              message:
                "PROVIDER_ISOLATION: import the S3/R2 SDK only inside src/lib/adapters/storage/r2/**. Elsewhere, use getStorageAdapter() from @/lib/adapters/storage — and build keys with the helpers there, never by hand.",
            },
            // Media seam. Spawning a process is the single most dangerous thing
            // this codebase does — every argument is a potential injection and
            // every invocation is unbounded CPU — so it is confined to the one
            // folder that was written for it (ARGV_NEVER_A_SHELL in
            // src/lib/adapters/media/ffmpeg/binaries.ts). A route or a router
            // calling ffmpeg directly would also blow its execution budget;
            // see FFMPEG_RUNS_IN_A_CONTAINER.
            {
              group: ["child_process", "node:child_process"],
              message:
                "PROVIDER_ISOLATION: spawn processes only inside src/lib/adapters/media/ffmpeg/**. Elsewhere, use getMediaAdapter() from @/lib/adapters/media — and call it from a workflow step, never from a route or a tRPC handler.",
            },
            // Render seam. @remotion/lambda drags the AWS SDK and the whole
            // Remotion bundler in with it, so it must never be evaluated in a
            // process that is not rendering — and certainly never reach a page
            // bundle. Starting a render also has a BILL attached, which is why
            // it may only be reached from a workflow step: the gates that
            // authorise it live in the procedure layer, and a route or a
            // component calling the provider directly would bypass every one
            // of them. See LAMBDA_IS_RIGHT_FOR_RENDERING.
            //
            // `remotion` and `@remotion/player` are deliberately NOT fenced:
            // they are the composition and the preview player, which are app
            // code under src/remotion/ and a client component respectively.
            {
              group: [
                "@remotion/lambda",
                "@remotion/lambda/*",
                "@remotion/lambda/**",
                "@remotion/lambda-client",
                "@remotion/lambda-client/*",
                "@remotion/lambda-client/**",
              ],
              message:
                "PROVIDER_ISOLATION: import the Remotion Lambda SDK only inside src/lib/adapters/render/lambda/**. Elsewhere, use getRenderAdapter() from @/lib/adapters/render — and call it from a workflow step, never from a route or a tRPC handler.",
            },
            // LLM seam. The Anthropic SDK carries an API key, and a key that
            // reaches a page bundle is a key anyone can spend. It is also the
            // one dependency in this codebase where a careless import costs
            // money per call rather than per deploy. Everything else goes
            // through the LlmAdapter contract, which returns SCHEMA-VALIDATED
            // output — a raw-text escape hatch is exactly what this fence is
            // there to prevent (SCHEMA_IS_THE_CONTRACT).
            {
              group: [
                "@anthropic-ai/sdk",
                "@anthropic-ai/sdk/*",
                "@anthropic-ai/sdk/**",
              ],
              message:
                "PROVIDER_ISOLATION: import the Anthropic SDK only inside src/lib/adapters/llm/anthropic/**. Elsewhere, use getLlmAdapter() from @/lib/adapters/llm — it returns schema-validated output, which raw SDK access does not.",
            },
          ],
        },
      ],
    },
  },
  {
    // The sanctioned homes for each provider SDK. These folders ARE the
    // translation layer, so the restriction above is lifted here only.
    files: [
      "src/lib/adapters/better-auth/**/*.ts",
      "src/lib/better-auth/**/*.ts",
      // The server barrel IS the composition point — it imports provider
      // COMPONENTS (never SDKs) to build the wrappers, so the relative-path
      // form of the restriction must not apply to it.
      "src/components/global/providers/server.tsx",
      // The per-provider surface modules resolved by the @providers-active
      // alias. They compose provider COMPONENTS, never SDKs.
      "src/components/global/providers/active.tsx",
      "src/components/global/providers/active.better-auth.tsx",
      "src/components/global/providers/better-auth/**/*.ts",
      "src/components/global/providers/better-auth/**/*.tsx",
      "src/app/api/auth/**",
      // Jobs seam. The adapter folder is the translation layer; src/inngest/**
      // holds workflow definitions, which are written against the engine's own
      // step API on purpose (see JobsAdapter's WHY); the route serves them.
      "src/lib/adapters/jobs/inngest/**/*.ts",
      "src/inngest/**/*.ts",
      "src/app/api/inngest/**",
      // Storage seam. Only the R2 folder may speak S3; keys.ts stays pure and
      // SDK-free so it can be imported (and unit tested) anywhere.
      "src/lib/adapters/storage/r2/**/*.ts",
      // Media seam. Only the ffmpeg folder may spawn a process; ingest-plan.ts
      // stays pure and tool-free so the decisions it makes can be unit tested
      // without a binary installed.
      "src/lib/adapters/media/ffmpeg/**/*.ts",
      // Render seam. Only the lambda folder may speak to Remotion Lambda;
      // cache-key.ts and the frame plan stay pure so the decisions that can
      // actually be wrong are unit testable with no AWS account.
      "src/lib/adapters/render/lambda/**/*.ts",
      // LLM seam. Only this folder may hold the API key; src/lib/script/ stays
      // SDK-free so the prompt construction and the SSRF guard — the two
      // things here with security consequences — are unit testable without a
      // model, a key, or a network.
      "src/lib/adapters/llm/anthropic/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/middleware",
                "**/middleware.ts",
                "./middleware",
                "../middleware",
              ],
              message:
                "Next.js 16 uses `proxy.ts`, not `middleware.ts`. Import from the proxy module instead.",
            },
          ],
        },
      ],
    },
  },
  {
    // shadcn-generated UI primitives — kept close to upstream generator output
    // for easy regeneration. The `createContext<T>({} as T)` and CSS-var
    // typing patterns are shadcn idioms.
    files: ["src/components/ui/**/*.tsx", "src/components/ui/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as" },
      ],
    },
  },
  {
    // TIMELINE_PURITY — src/lib/timeline/ is isomorphic: the SAME apply() runs
    // in the browser editor and on the server, because two implementations
    // would drift within a month and the symptom would be an editor preview
    // that disagrees with a paid render. That only holds while the module
    // imports nothing platform-specific, so the fence is here rather than in a
    // convention. purity.test.ts asserts the same thing at runtime, because a
    // lint rule is skippable and this one must not be.
    files: ["src/lib/timeline/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "node:*",
                "fs",
                "fs/*",
                "path",
                "path/*",
                "crypto",
                "os",
                "child_process",
                "stream",
                "stream/*",
                "buffer",
                "util",
                "url",
                "zlib",
                "http",
                "https",
                "worker_threads",
                "perf_hooks",
              ],
              message:
                "TIMELINE_PURITY: src/lib/timeline must run unchanged in the browser, so no Node built-ins. Hash with the pure FNV-1a in hash.ts rather than node:crypto.",
            },
            {
              group: ["server-only", "client-only"],
              message:
                "TIMELINE_PURITY: src/lib/timeline runs on BOTH sides. A server-only or client-only marker here breaks the editor or the renderer.",
            },
            {
              group: [
                "@/generated/prisma",
                "@/generated/prisma/*",
                "@prisma/client",
                "@prisma/client/*",
                "@/services/*",
                "@/trpc/*",
                "@/lib/adapters",
                "@/lib/adapters/*",
              ],
              message:
                "TIMELINE_PURITY: src/lib/timeline is a pure document module. It takes a document and returns one — it must not reach the database, a procedure or a provider.",
            },
            {
              group: [
                "react",
                "react/*",
                "react-dom",
                "react-dom/*",
                "next",
                "next/*",
              ],
              message:
                "TIMELINE_PURITY: src/lib/timeline is framework-free. Rendering a document belongs in src/remotion/ or a component, not here.",
            },
          ],
        },
      ],
    },
  },
  {
    // RENDER_DETERMINISM — a frame must be a pure function of the document and
    // the frame number. Phase 04 reuses a render whenever the document hash
    // matches, so a component that reads the clock or a random number makes a
    // CACHED render differ from a fresh one — two customers paying for the
    // same video and getting different files, with nothing in the document to
    // explain it. Remotion also renders frames out of order and in parallel
    // across processes, so these values are not even stable WITHIN one render.
    // determinism.test.ts asserts the same thing, because a lint rule is
    // skippable and this one must not be.
    files: [
      "src/remotion/**/*.ts",
      "src/remotion/**/*.tsx",
      "src/lib/render/**/*.ts",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message:
            "RENDER_DETERMINISM: a render must not read the clock. Derive timing from useCurrentFrame() and the document.",
        },
        {
          object: "Math",
          property: "random",
          message:
            "RENDER_DETERMINISM: a render must not be random. Seed any variation from the document (an item id, an index) so it reproduces.",
        },
        {
          object: "performance",
          property: "now",
          message:
            "RENDER_DETERMINISM: a render must not read the clock. Derive timing from useCurrentFrame().",
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "crypto",
          message:
            "RENDER_DETERMINISM: random ids make two renders of one document differ. Use an id from the document instead.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "RENDER_DETERMINISM: `new Date()` reads the clock, so the same document would render differently each time. Take the time from the document.",
        },
      ],
    },
  },
  {
    // The purity guard has to READ the module's files to prove what they
    // import, so it is the one file under src/lib/timeline/ that may touch
    // node:fs. The database and provider fences above still apply — a test is
    // not a reason to let Prisma into this folder.
    files: ["src/lib/timeline/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/generated/prisma",
                "@/generated/prisma/*",
                "@prisma/client",
                "@prisma/client/*",
                "@/services/*",
                "@/trpc/*",
                "server-only",
                "client-only",
              ],
              message:
                "TIMELINE_PURITY: src/lib/timeline is a pure document module, and its tests prove that. Keep the database and the procedure layer out.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/services/**/*.service.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Program > :first-child:not(ImportDeclaration[source.value='server-only'])",
          message:
            "Service files must start with `import 'server-only'` (before any other code — doc comments above it are fine) so they can never be bundled into client code.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
]);

export default eslintConfig;
