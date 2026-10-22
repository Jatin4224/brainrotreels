/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PALETTES, Palette, paletteSchema, getPalette,
 *   listPalettes, DEFAULT_PALETTE_ID, isPaletteId, PALETTES_ARE_DATA,
 *   RENDER_COLOURS_ARE_LITERAL, backdropGradient
 *
 * WHAT:  The named colour sets a document's `style.paletteId` points at — what
 *        a styled background is actually made of.
 *
 * WHY:   `style.paletteId` has been in the timeline document since Phase 01 and
 *        nothing has ever resolved it. Phase 09 is the first phase that has to:
 *        a `voiceover` project is narration over a STYLED BACKGROUND, and until
 *        Phase 11's footage library exists that background is a gradient. One
 *        module answering "what does `warm` mean" is the alternative to each
 *        consumer inventing its own answer, which is how a preview and a render
 *        end up different colours.
 *
 *        PALETTES_ARE_DATA, exactly as the caption styles are (STYLES_ARE_DATA
 *        in src/lib/types/caption.ts) and for the same reason: a palette is a
 *        row of config, so adding one is an object here rather than a deploy of
 *        new component code.
 *
 *        RENDER_COLOURS_ARE_LITERAL — the documented exception to this app's
 *        no-hardcoded-colour rule, inherited from
 *        src/remotion/components/text-overlay.tsx. These values are composited
 *        into an MP4 by a headless browser with no stylesheet, no CSS variables
 *        and no light/dark mode, so a theme token here would render as the
 *        browser default. Every colour is a literal BECAUSE it is video, and
 *        for no other reason. Nothing in this module may be used to style app
 *        chrome.
 *
 *        The ids are not invented here. `warm`, `mono`, `electric` and `noir`
 *        are the ones the Phase 01 fixtures already write, and `default` is the
 *        one the v1→v2 migration writes into every legacy document
 *        (src/lib/timeline/migrate.ts). Picking new names would have left every
 *        existing document pointing at a palette that does not exist.
 *
 *        PURE, like src/lib/captions and src/lib/timeline: no Prisma, no
 *        `server-only`, no Node built-in. The same lookup has to run in the
 *        browser preview and inside a Lambda render worker, and they must agree
 *        to the pixel.
 * WHERE: src/lib/generators/ (which bakes `paletteId` into the document),
 *        src/remotion/components/backdrop.tsx (which draws it), and the
 *        generate screen's preview.
 */

import { z } from "zod";

/**
 * SOURCE OF TRUTH KEYWORDS: paletteSchema, Palette, BACKDROP_IS_TWO_STOPS
 *
 * WHAT:  One palette: the two stops of its background gradient, an accent, and
 *        the text colour that is legible on it.
 *
 * WHY:   BACKDROP_IS_TWO_STOPS. A linear gradient between two colours is the
 *        smallest thing that does not look like a solid fill on a phone screen,
 *        and it costs one CSS declaration — no image, no shader and nothing
 *        fetched at render time (NO_NETWORK_FALLBACK in media-clip.tsx). A
 *        third stop was the alternative and it buys nothing a viewer can see at
 *        1080 wide.
 *
 *        `text` is part of the palette rather than derived from it because the
 *        caption library already owns the contrast rule
 *        (src/lib/captions/contrast.ts) and a second, worse luminance
 *        calculation here would be a second answer to a question that has one.
 *        The value stated is the one that passes against `from`.
 * WHERE: The value type of PALETTES.
 */
export const paletteSchema = z
  .object({
    id: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(80),
    /** The gradient's top-left stop. */
    from: z.string().trim().min(4).max(32),
    /** Its bottom-right stop. */
    to: z.string().trim().min(4).max(32),
    /** For a badge, a rule, a highlight. */
    accent: z.string().trim().min(4).max(32),
    /** Legible over `from`. See BACKDROP_IS_TWO_STOPS. */
    text: z.string().trim().min(4).max(32),
  })
  .strict();

export type Palette = z.infer<typeof paletteSchema>;

/**
 * SOURCE OF TRUTH KEYWORDS: PALETTES, DEFAULT_PALETTE_ID
 *
 * WHAT:  The library. Five palettes, keyed by the id a document stores.
 * WHY:   `default` is first and is what an unknown id falls back to, so a
 *        document written by a newer release — or a migrated v1 document, which
 *        is literally where the id `default` comes from — still draws a
 *        background rather than nothing. Same trade as UNKNOWN_DRAWS_NOTHING in
 *        the render registry, except a background has an obvious safe answer
 *        and an unknown overlay does not.
 * WHERE: getPalette below is the only sanctioned reader.
 */
export const PALETTES: Readonly<Record<string, Palette>> = {
  default: {
    id: "default",
    name: "Default",
    from: "#1e1b4b",
    to: "#0f172a",
    accent: "#818cf8",
    text: "#f8fafc",
  },
  warm: {
    id: "warm",
    name: "Warm",
    from: "#7c2d12",
    to: "#1c1917",
    accent: "#fb923c",
    text: "#fff7ed",
  },
  mono: {
    id: "mono",
    name: "Mono",
    from: "#27272a",
    to: "#09090b",
    accent: "#a1a1aa",
    text: "#fafafa",
  },
  electric: {
    id: "electric",
    name: "Electric",
    from: "#082f49",
    to: "#4a044e",
    accent: "#22d3ee",
    text: "#f0f9ff",
  },
  noir: {
    id: "noir",
    name: "Noir",
    from: "#0c0a09",
    to: "#1c1917",
    accent: "#e7e5e4",
    text: "#fafaf9",
  },
};

export const DEFAULT_PALETTE_ID = "default";

export function isPaletteId(value: string): boolean {
  return Object.hasOwn(PALETTES, value);
}

/**
 * SOURCE OF TRUTH KEYWORDS: getPalette, UNKNOWN_PALETTE_FALLS_BACK
 *
 * WHAT:  The palette for an id, always.
 * WHY:   UNKNOWN_PALETTE_FALLS_BACK — never throws and never returns null. The
 *        caller is a render worker composing a paid video; an unrecognised id
 *        there must produce a plain background rather than a black frame or a
 *        thrown error inside a Lambda.
 * WHERE: The backdrop component and the generators.
 */
export function getPalette(id: string | undefined): Palette {
  const found = id === undefined ? undefined : PALETTES[id];
  /* The non-null assertion is avoided by construction: `default` is a literal
   * key of the object above, so the fallback cannot be undefined. */
  return found ?? PALETTES[DEFAULT_PALETTE_ID] ?? FALLBACK_PALETTE;
}

/* Only reachable if somebody deletes the `default` key, which the type system
 * permits (PALETTES is a Record<string, …>) and the renderer must survive. */
const FALLBACK_PALETTE: Palette = {
  id: DEFAULT_PALETTE_ID,
  name: "Default",
  from: "#1e1b4b",
  to: "#0f172a",
  accent: "#818cf8",
  text: "#f8fafc",
};

export function listPalettes(): Palette[] {
  return Object.values(PALETTES);
}

/**
 * SOURCE OF TRUTH KEYWORDS: backdropGradient, ONE_GRADIENT_STRING
 *
 * WHAT:  The CSS the backdrop paints.
 * WHY:   ONE_GRADIENT_STRING. The Remotion component and the generate screen's
 *        swatch both need this exact string, and writing the `linear-gradient`
 *        twice is how the preview stops matching the render — the failure this
 *        whole module exists to prevent.
 * WHERE: src/remotion/components/backdrop.tsx and the generate screen.
 */
export function backdropGradient(palette: Palette): string {
  return `linear-gradient(160deg, ${palette.from} 0%, ${palette.to} 100%)`;
}

/**
 * SOURCE OF TRUTH KEYWORDS: BACKDROP_ELEMENT_KIND, BACKDROP_IS_A_SCENE_ITEM
 *
 * WHAT:  The `kind` of the scene element that carries a backdrop's palette id.
 *
 * WHY:   A backdrop is a SCENE item, so its only input channel is
 *         `scene.elements` (BACKDROP_IS_A_SCENE_ITEM in
 *         src/remotion/components/backdrop.tsx), and the element is found by
 *         its `kind` rather than by its index so that inserting an element
 *         cannot change which one supplies the colours.
 *
 *         It lives HERE, in a pure module, rather than beside the component
 *         that reads it: the generator WRITES this string and the Remotion
 *         component READS it, and src/lib/generators must not import from
 *         src/remotion — that would drag React and Remotion into the pipeline
 *         and into every test of it. Two literals is the failure this prevents:
 *         a generator writing `gradient` and a component looking for `fill`
 *         produces a video with a default background and no error anywhere.
 * WHERE: src/lib/generators/voiceover.ts writes it;
 *        src/remotion/components/backdrop.tsx reads it.
 */
export const BACKDROP_ELEMENT_KIND = "gradient";
