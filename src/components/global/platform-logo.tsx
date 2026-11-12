/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PlatformLogo, PlatformLogoProps, PlatformLogoTone,
 *   PlatformLogoSize, LOGO_TONE_IS_A_TOKEN, TOKENS_NOT_HEX, AUTH_WEARS_THE_BRAND,
 *   LOWERCASE_R_MARK, ACCENT_DOT_IS_THE_BRAND
 *
 * WHAT:  The app's wordmark — a rounded square holding the lowercase `r`
 *        letterform with an accent dot beside it, plus APP_NAME closed by that
 *        same accent dot. Three tones and two sizes.
 * WHY:   One reusable brand mark, so a rebrand is an edit to the SVG path
 *        here. LOWERCASE_R_MARK: the glyph is the first letter of the product
 *        name rather than a generic play triangle, because the tile and the
 *        wordmark then read as one mark at every size — the tile IS the
 *        wordmark cropped to its first character, which is what makes a
 *        favicon recognisable as the same logo as the header.
 *
 *        ACCENT_DOT_IS_THE_BRAND: the single coloured element is the dot. It
 *        is `--brand-accent`, which is pinned in both themes precisely so an
 *        identity colour does not invert, and it is the ONE thing carried
 *        across every tone — the tile fill changes by surface, the dot does
 *        not. That keeps the app's monochrome product palette intact while
 *        still letting the mark be branded.
 *
 *        LOGO_TONE_IS_A_TOKEN: the mark appears on several surfaces and they
 *        genuinely want different tile fills — `surface` is the default and
 *        the mark as drawn in the supplied artwork (a neutral step above the
 *        page, foreground letterform, accent dot); `primary` is the
 *        monochrome the app shell is built on; `brand` is the loud yellow the
 *        landing hero uses (AUTH_WEARS_THE_BRAND). All are theme tokens chosen
 *        from a closed union, never a class a caller passes in, which is what
 *        keeps TOKENS_NOT_HEX true here: a `tone` prop cannot smuggle a hex
 *        value in the way a `className` override could.
 *
 *        Note the in-tile dot is the one value that must follow the tone: on
 *        the `brand` tile the accent would be yellow-on-yellow, so that tone
 *        inverts it to the accent's own foreground. The WORDMARK dot never
 *        varies — it sits on the page, not inside the tile.
 *
 *        `size` exists for the same reason and is likewise closed: the auth
 *        top bar wants a mark big enough to anchor a 1240px page, and the
 *        in-product header wants the small one. A free-form size would let
 *        the two drift to four.
 * WHERE: src/components/global/auth/auth-shell.tsx (size "lg"),
 *        src/app/(marketing)/_components/marketing-header.tsx and
 *        marketing-footer.tsx (size "md" — both previously hand-rolled their
 *        own tile+icon+name copy of this, which is why "md" exists),
 *        src/app/(onboarding)/onboarding/_components/onboarding-flow.tsx, and
 *        anywhere else the wordmark is needed. The same letterform is drawn as
 *        a static file in src/app/icon.svg for the browser tab.
 */

import type { Route } from "next";
import Link from "next/link";

import { APP_NAME } from "@/lib/config/branding";
import { cn } from "@/lib/utils";

export type PlatformLogoTone = "surface" | "primary" | "brand";
export type PlatformLogoSize = "default" | "md" | "lg";

export interface PlatformLogoProps {
  href?: Route;
  className?: string;
  showName?: boolean;
  tone?: PlatformLogoTone;
  size?: PlatformLogoSize;
}

/* Closed maps rather than template strings, so Tailwind sees every class
 * literally and cannot tree-shake one of them out of the build. `dot` is the
 * fill of the dot INSIDE the tile, which is the only part of the mark that has
 * to react to the tile it is sitting on. */
const LOGO_TONES: Record<PlatformLogoTone, { box: string; dot: string }> = {
  surface: { box: "bg-muted text-foreground", dot: "fill-brand-accent" },
  primary: {
    box: "bg-primary text-primary-foreground",
    dot: "fill-brand-accent",
  },
  brand: {
    box: "bg-brand-accent text-brand-accent-foreground",
    dot: "fill-brand-accent-foreground",
  },
};

const LOGO_SIZES: Record<
  PlatformLogoSize,
  { box: string; glyph: string; name: string }
> = {
  default: { box: "size-6 rounded-lg", glyph: "size-5.5", name: "text-base" },
  /* The PUBLIC header/footer step. Same name size as `default`, but set in
     the display face: every other word on the marketing pages is, and a
     wordmark in the UI face was the one thing on those pages wearing the
     product typography instead of the brand typography. */
  md: {
    box: "size-7 rounded-lg",
    glyph: "size-6.5",
    name: "font-display text-base font-bold tracking-tight",
  },
  lg: {
    box: "size-10 rounded-xl",
    glyph: "size-9",
    name: "font-display text-xl font-extrabold tracking-tight",
  },
};

export function PlatformLogo({
  href = "/",
  className,
  showName = true,
  tone = "surface",
  size = "default",
}: PlatformLogoProps) {
  const scale = LOGO_SIZES[size];
  const palette = LOGO_TONES[tone];

  const content = (
    <div className={cn("flex items-center gap-2.5 font-medium", className)}>
      <div
        className={cn(
          "flex items-center justify-center",
          palette.box,
          scale.box,
        )}
      >
        {/* The lowercase `r`: a stem and a shoulder drawn as two round-capped
            strokes, so the letterform stays identical whatever face the page
            loads — a mark that reflows with the webfont is not a mark. The
            square dot trails it on the same baseline, exactly as it closes the
            wordmark. */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          className={scale.glyph}
          aria-hidden="true"
        >
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          >
            <path d="M9.4 6.8v10.4" />
            <path d="M9.4 11C9.4 8.5 11.4 6.8 13.9 6.8" />
          </g>
          <rect
            x="12.2"
            y="14.9"
            width="3.8"
            height="3.8"
            rx="1.1"
            className={palette.dot}
          />
        </svg>
      </div>
      {showName ? (
        <span className={scale.name}>
          {APP_NAME}
          {/* Rendered as a real period rather than a shape, so it keeps the
              face's own baseline and scales with the name at every size. */}
          <span className="text-brand-accent">.</span>
        </span>
      ) : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex" aria-label={APP_NAME}>
        {content}
      </Link>
    );
  }
  return content;
}
