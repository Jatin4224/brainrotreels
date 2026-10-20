/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: remotion.config, Config, setVideoImageFormat,
 *   setOverwriteOutput, DETERMINISTIC_ENCODE, publicDir, REMOTION_CLI_ONLY
 *
 * WHAT:  Configuration for the Remotion CLI — the studio and `remotion render`.
 * WHY:   REMOTION_CLI_ONLY, and this is the first thing to know about this
 *        file: it is read ONLY by the CLI. The Player on the preview page and
 *        the Lambda renderer in Phase 04 do not see any of it, so anything that
 *        must hold for every render belongs in the composition, not here.
 *        Concretely: this is why the black background is set in
 *        TimelineRenderer rather than configured here.
 *
 *        DETERMINISTIC_ENCODE: JPEG frames rather than PNG. The brief requires
 *        two renders of one document to produce identical frames, and both
 *        formats satisfy that — but PNG is lossless and several times larger
 *        per frame, which on a 1800-frame vertical video is gigabytes of
 *        intermediate data for a difference H.264 then discards. JPEG at the
 *        default quality is what Remotion recommends for video output.
 * WHERE: Read automatically by `npm run remotion:studio` and
 *        `npm run remotion:render`.
 */

import path from "node:path";

import { Config } from "@remotion/cli/config";

/**
 * SOURCE OF TRUTH KEYWORDS: overrideWebpackConfig, PATH_ALIAS_FOR_REMOTION
 *
 * WHAT:  Teaches Remotion's bundler the `@/*` path alias.
 * WHY:   PATH_ALIAS_FOR_REMOTION. Remotion bundles with its own webpack and
 *        does NOT read `tsconfig.json`'s `paths`, so every `@/lib/...` import
 *        in a composition fails to resolve — with a module-not-found error that
 *        names `node_modules/@/lib`, which reads like a missing package rather
 *        than a missing alias. `tsc` is happy either way, so this cannot be
 *        caught by a typecheck; only running the CLI finds it.
 *        Same mechanism and same shape as the webpack block in next.config.ts,
 *        deliberately — two bundlers, one alias, declared the same way in both.
 * WHERE: Applies to `remotion studio` and `remotion render`. The Player inside
 *        the Next app resolves through Next instead and needs none of this.
 */
Config.overrideWebpackConfig((current) => ({
  ...current,
  resolve: {
    ...current.resolve,
    alias: {
      ...current.resolve?.alias,
      "@": path.resolve(process.cwd(), "src"),
    },
  },
}));

/* Where `staticFile()` resolves from. The same folder Next serves, so the
 * fonts and dev media have ONE path that works in the studio, in a local
 * render and in the browser preview — three consumers, one URL.
 *
 * ABSOLUTE, not './public'. A relative value is resolved against the process
 * cwd, and the CLI does not guarantee the same cwd for every subcommand — a
 * relative path here produced a bundle whose `public/` was simply missing, so
 * `staticFile()` URLs 404'd during the render while the identical URL worked
 * in another invocation. An absolute path cannot do that. */
Config.setPublicDir(path.resolve(process.cwd(), "public"));

Config.setVideoImageFormat("jpeg");

/* A local render is a development artifact that gets re-run constantly;
 * refusing to overwrite would mean deleting the file by hand every time. */
Config.setOverwriteOutput(true);
