/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: purity test, PURE_MODULES, FORBIDDEN_IMPORTS,
 *   ISOMORPHIC_PURE_MODULE, collectImports, ONE_PURITY_CONTRACT
 *
 * WHAT:  Reads every source file in each module that claims to be pure and
 *        isomorphic, and fails if one imports Prisma, `server-only`, a Node
 *        built-in, or the framework — plus a positive allow-list of what each
 *        module may reach outside itself.
 *
 * WHY:   ONE_PURITY_CONTRACT. This started as src/lib/timeline/purity.test.ts,
 *        guarding one module. Phase 16 added a second module with the same
 *        claim — src/lib/scene/, whose whole value is that the editor's
 *        overflow warning and the server's refusal are the SAME function — and
 *        copying the file would have produced two lists of forbidden imports
 *        to keep in step. They would not have stayed in step. So the machinery
 *        moved up one directory and the modules became rows in a table, which
 *        is what CLAUDE.md means by globalising a pattern the second time it
 *        appears rather than the fifth.
 *
 *        The claim each row protects is concrete, not stylistic:
 *
 *          - src/lib/timeline — the same `apply()` runs in the browser editor
 *            and on the server, so an edit means the same thing in both.
 *          - src/lib/scene — the same `checkScene` runs in the editor while
 *            somebody types, in this test, on the Inngest worker before a
 *            still is rendered, and inside a Remotion component. A Node
 *            built-in in any file here breaks the first and the last.
 *
 *        There is an eslint rule saying the same thing, and a rule is
 *        skippable — by a disable comment, by a config that stops matching the
 *        path, by `--no-verify`. This is not.
 *
 *        It parses imports TEXTUALLY rather than by loading the modules: an
 *        import that is merely PRESENT already breaks a client bundle even if
 *        nothing calls it, so a runtime check would pass on a module that
 *        fails to build.
 * WHERE: Run by `npm test`. Guards every file under the directories in
 *        PURE_MODULES.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LIB_DIR = join(fileURLToPath(new URL(".", import.meta.url)));

/**
 * SOURCE OF TRUTH KEYWORDS: FORBIDDEN_IMPORTS
 *
 * WHAT:  What may never appear in an import in a pure module.
 * WHY:   Each entry names what it would break, because a future reader
 *        deleting one needs to know the cost. The list mirrors the eslint rule
 *        in eslint.config.mjs; if they disagree, this one is the contract.
 * WHERE: The assertion below.
 */
const FORBIDDEN_IMPORTS: ReadonlyArray<{ pattern: RegExp; breaks: string }> = [
  {
    pattern: /^node:/,
    breaks: "the browser bundle — Node built-ins do not exist there",
  },
  {
    pattern:
      /^(fs|path|crypto|os|child_process|stream|buffer|util|url|zlib|http|https|worker_threads|perf_hooks)(\/|$)/,
    breaks:
      "the browser bundle — these are Node built-ins under their bare names",
  },
  {
    pattern: /^server-only$/,
    breaks: "the editor — a server-only module cannot be imported client-side",
  },
  {
    pattern: /^client-only$/,
    breaks: "the renderer and every server-side read",
  },
  {
    pattern: /^(@prisma\/client|@\/generated\/prisma)(\/|$)/,
    breaks: "purity — a document module must not reach the database",
  },
  {
    pattern: /^@\/services\//,
    breaks: "purity — services are server-only Prisma wrappers",
  },
  {
    pattern: /^@\/trpc\//,
    breaks: "purity — the procedure layer is a caller, not a dependency",
  },
  {
    pattern: /^@\/lib\/adapters(\/|$)/,
    breaks: "purity — providers belong behind a router, not here",
  },
  {
    pattern: /^(react|react-dom|next)(\/|$)/,
    breaks:
      "framework independence — the renderer and the editor consume this, not the reverse",
  },
  {
    pattern: /^(remotion|@remotion\/)/,
    breaks:
      "the editor and this test — the remotion package's module body expects a Remotion bundle (CAPTIONS_STAY_PURE)",
  },
];

/**
 * SOURCE OF TRUTH KEYWORDS: PURE_MODULES
 *
 * WHAT:  Each module claiming purity, how many files it should have, and what
 *        it is allowed to import from outside itself.
 *
 * WHY:   The allow-list is a POSITIVE assertion beside the negative one, and
 *        it is per-module because the modules legitimately differ: the
 *        timeline document module depends on almost nothing, while the scene
 *        engine shares the caption library's safe zone on purpose
 *        (SAFE_ZONE_IS_SHARED) and uses Dagre for graph geometry
 *        (GRAPH_LAYOUT_IS_DAGRE). A new entry in either list should be a
 *        deliberate decision rather than something that slipped past a
 *        blocklist nobody updated.
 *
 *        `minFiles` exists so a refactor that moved or renamed a folder cannot
 *        make this suite pass by checking nothing.
 * WHERE: The two describes below.
 */
const PURE_MODULES: ReadonlyArray<{
  dir: string;
  minFiles: number;
  allowed: readonly string[];
}> = [
  {
    dir: "timeline",
    minFiles: 8,
    allowed: ["zod", "@/lib/types/json", "@/lib/types/project"],
  },
  {
    dir: "scene",
    minFiles: 6,
    allowed: [
      "zod",
      /* Synchronous, dependency-free graph layout — see DAGRE_IS_SYNCHRONOUS
       * in src/lib/scene/flow.ts for why it is this one and not elkjs. */
      "@dagrejs/dagre",
      /* The one implementation of "where the platform's own UI is". */
      "@/lib/captions/safe-zone",
      "@/lib/timeline",
      "@/lib/types",
      "@/lib/types/caption",
      "@/lib/types/scene",
    ],
  },
];

/* Static imports, `export ... from`, and dynamic import() — a dynamic one
 * bundles the same way, so it must be caught too.
 *
 * The captured specifier excludes whitespace, commas and brackets, which is
 * not cosmetic: a textual scan cannot tell the `from` KEYWORD from the word
 * `from` in a string, and src/lib/scene/check.ts contains both
 * `["from", edge.from]` and `end === "from" ? …`. A module specifier can never
 * hold a space or a comma, so narrowing the capture to what a specifier may
 * actually look like discriminates the two without the scanner having to
 * parse JavaScript. */
const IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"\s,;{}()[\]]+)['"]/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
      out.push(full);
  }
  return out;
}

function collectImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

for (const pureModule of PURE_MODULES) {
  describe(`src/lib/${pureModule.dir} is pure and isomorphic`, () => {
    const moduleDir = join(LIB_DIR, pureModule.dir);
    const files = sourceFiles(moduleDir);

    it("has source files to check", () => {
      expect(files.length).toBeGreaterThanOrEqual(pureModule.minFiles);
    });

    it.each(files.map((file) => [file.slice(moduleDir.length), file] as const))(
      "%s imports nothing platform-specific",
      (_label, file) => {
        const offenders = collectImports(file).flatMap((specifier) => {
          const rule = FORBIDDEN_IMPORTS.find((entry) =>
            entry.pattern.test(specifier),
          );
          return rule === undefined
            ? []
            : [`${specifier} — breaks ${rule.breaks}`];
        });
        expect(offenders).toEqual([]);
      },
    );

    it("reaches outside the module only for what it is allowed", () => {
      const allowed = new Set(pureModule.allowed);
      const external = new Set<string>();

      for (const file of files) {
        for (const specifier of collectImports(file)) {
          if (specifier.startsWith("./") || specifier.startsWith("../")) continue;
          external.add(specifier);
        }
      }

      expect(
        [...external].filter((specifier) => !allowed.has(specifier)),
      ).toEqual([]);
    });
  });
}
