/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_STYLES, getCaptionStyle,
 *   DEFAULT_CAPTION_STYLE_ID, CAPTION_STYLE_FAMILIES, listCaptionStyles,
 *   STYLES_ARE_DATA, UNKNOWN_STYLE_FALLS_BACK, NO_DUPLICATE_IDS
 *
 * WHAT:  The whole caption library as one keyed record, and the lookup that
 *        never throws.
 *
 * WHY:   STYLES_ARE_DATA — this file is the entire answer to "how do I add a
 *        caption style": write an object in a family file and it appears in
 *        the gallery, in the renderer and in the contrast test. No component,
 *        no migration, no registry key. That is what the phase means by
 *        "a new style is a data change, not a deploy of new components".
 *
 *        UNKNOWN_STYLE_FALLS_BACK, the same trade as the render registry's
 *        UNKNOWN_DRAWS_NOTHING but resolved the other way, and deliberately.
 *        An unknown RENDER KIND draws nothing because the alternative is a
 *        placeholder box composited into a paid video. An unknown CAPTION
 *        STYLE falls back to the default because the alternative is a video
 *        with no captions at all — the content is the words, and the style is
 *        the decoration. Losing the decoration is recoverable; losing the
 *        words is the thing the phase exists to prevent.
 *
 *        NO_DUPLICATE_IDS is asserted at module load rather than reviewed. A
 *        duplicate id silently wins or loses depending on import order, which
 *        makes a style vanish from the gallery on an unrelated change —
 *        the kind of bug that costs an afternoon and leaves no trace.
 * WHERE: buildCaptionTrack, the captions router, the style gallery,
 *        src/remotion/components/captions.tsx.
 */

import type { CaptionStyle } from "@/lib/types/caption";
import { BOLD_STYLES } from "./bold";
import { CLEAN_STYLES } from "./clean";
import { EDITORIAL_STYLES } from "./editorial";
import { KARAOKE_STYLES } from "./karaoke";
import { NEON_STYLES } from "./neon";
import { PLAYFUL_STYLES } from "./playful";

export { CAPTION_STYLE_BASE, defineStyle } from "./define";

/**
 * SOURCE OF TRUTH KEYWORDS: DEFAULT_CAPTION_STYLE_ID
 *
 * The style a project gets when nothing has been chosen, and the one an
 * unknown id falls back to. It is a FREE style on purpose: defaulting to a
 * premium look would show every trial workspace captions it cannot keep.
 */
export const DEFAULT_CAPTION_STYLE_ID = "bold-pop";

const ALL_STYLES: readonly CaptionStyle[] = [
  ...BOLD_STYLES,
  ...KARAOKE_STYLES,
  ...CLEAN_STYLES,
  ...NEON_STYLES,
  ...EDITORIAL_STYLES,
  ...PLAYFUL_STYLES,
];

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_STYLES, NO_DUPLICATE_IDS
 *
 * WHAT:  Every style, keyed by id, in gallery order.
 * WHERE: See the file header.
 */
export const CAPTION_STYLES: Readonly<Record<string, CaptionStyle>> =
  buildIndex(ALL_STYLES);

/**
 * SOURCE OF TRUTH KEYWORDS: CAPTION_STYLE_FAMILIES
 *
 * The gallery's grouping, in the order the families are listed above rather
 * than alphabetically — the loudest family first, because that is what most
 * projects want and a gallery that opens on "Clean" buries it.
 */
export const CAPTION_STYLE_FAMILIES: readonly string[] = [
  ...new Set(ALL_STYLES.map((style) => style.family)),
];

/**
 * SOURCE OF TRUTH KEYWORDS: getCaptionStyle, UNKNOWN_STYLE_FALLS_BACK
 *
 * WHAT:  A style by id, or the default.
 * WHY:   Total, by design — see UNKNOWN_STYLE_FALLS_BACK in the file header.
 *        Callers that need to know whether the id was real (the gallery, the
 *        apply mutation) use `isCaptionStyleId` instead, so the fallback
 *        cannot swallow a customer's typo at the one boundary where it
 *        matters.
 * WHERE: buildCaptionTrack, the renderer.
 */
export function getCaptionStyle(styleId: string): CaptionStyle {
  const style = CAPTION_STYLES[styleId];
  if (style !== undefined) return style;

  const fallback = CAPTION_STYLES[DEFAULT_CAPTION_STYLE_ID];
  /* The default is in the library by construction — this is the type system
   * asking rather than a real possibility. */
  if (fallback === undefined) {
    throw new Error(
      `[captions/styles] The default style "${DEFAULT_CAPTION_STYLE_ID}" is missing from the library.`,
    );
  }
  return fallback;
}

/**
 * SOURCE OF TRUTH KEYWORDS: isCaptionStyleId
 *
 * WHAT:  Whether an id names a real style.
 * WHERE: `captionStyles.apply`, which must refuse an unknown id rather than
 *        silently applying the default — a customer who picked a style and
 *        got another one has no way to tell that is what happened.
 */
export function isCaptionStyleId(styleId: string): boolean {
  return Object.hasOwn(CAPTION_STYLES, styleId);
}

/**
 * SOURCE OF TRUTH KEYWORDS: listCaptionStyles
 *
 * WHAT:  The library as a list, optionally narrowed by family or by a search
 *        over the name.
 * WHY:   Filtering lives HERE rather than in the router, because the gallery's
 *        live preview filters the same library client-side and the two must
 *        agree about what "matches" means. A router-side filter would make
 *        the preview show a style the list had already excluded.
 * WHERE: `captionStyles.list`.
 */
export function listCaptionStyles(filters: {
  search?: string | undefined;
  family?: string | undefined;
}): CaptionStyle[] {
  const search = filters.search?.trim().toLowerCase() ?? "";
  const family = filters.family?.trim().toLowerCase() ?? "";

  return ALL_STYLES.filter((style) => {
    if (family.length > 0 && style.family.toLowerCase() !== family) {
      return false;
    }
    if (search.length === 0) return true;
    return (
      style.name.toLowerCase().includes(search) ||
      style.id.toLowerCase().includes(search) ||
      style.family.toLowerCase().includes(search)
    );
  });
}

function buildIndex(
  styles: readonly CaptionStyle[],
): Readonly<Record<string, CaptionStyle>> {
  const index: Record<string, CaptionStyle> = {};
  for (const style of styles) {
    if (Object.hasOwn(index, style.id)) {
      /* NO_DUPLICATE_IDS — see the file header. */
      throw new Error(
        `[captions/styles] Duplicate caption style id "${style.id}". Ids are the document's reference to a style and must be unique.`,
      );
    }
    index[style.id] = style;
  }
  return index;
}
