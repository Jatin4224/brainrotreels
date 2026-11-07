/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PlatformLogo, PlatformLogoProps, PlatformLogoTone,
 *   PlatformLogoSize, LOGO_TONE_IS_A_TOKEN, TOKENS_NOT_HEX, AUTH_WEARS_THE_BRAND
 *
 * WHAT:  The app's wordmark — a rounded square holding a play triangle, plus
 *        APP_NAME. Two tones and two sizes.
 * WHY:   One reusable brand mark, so a rebrand is an edit to the SVG path
 *        here. LOGO_TONE_IS_A_TOKEN: the mark appears on two different
 *        surfaces and they genuinely want different fills — inside the
 *        product it is `--primary`, which is the monochrome the app shell is
 *        built on, while on the public and auth pages it is `--brand-accent`,
 *        the loud yellow the landing hero uses (AUTH_WEARS_THE_BRAND). Both
 *        are theme tokens chosen from a closed union, never a class a caller
 *        passes in, which is what keeps TOKENS_NOT_HEX true here: a `tone`
 *        prop cannot smuggle a hex value in the way a `className` override
 *        could.
 *        `size` exists for the same reason and is likewise closed: the auth
 *        top bar wants a mark big enough to anchor a 1240px page, and the
 *        in-product header wants the small one. A free-form size would let
 *        the two drift to four.
 * WHERE: src/components/global/auth/auth-shell.tsx (tone "brand", size "lg")
 *        and anywhere else the wordmark is needed.
 */

import type { Route } from "next";
import Link from "next/link";

import { APP_NAME } from "@/lib/config/branding";
import { cn } from "@/lib/utils";

export type PlatformLogoTone = "primary" | "brand";
export type PlatformLogoSize = "default" | "lg";

export interface PlatformLogoProps {
  href?: Route;
  className?: string;
  showName?: boolean;
  tone?: PlatformLogoTone;
  size?: PlatformLogoSize;
}

/* Closed maps rather than template strings, so Tailwind sees every class
 * literally and cannot tree-shake one of them out of the build. */
const LOGO_TONES: Record<PlatformLogoTone, string> = {
  primary: "bg-primary text-primary-foreground",
  brand: "bg-brand-accent text-brand-accent-foreground",
};

const LOGO_SIZES: Record<
  PlatformLogoSize,
  { box: string; glyph: string; name: string }
> = {
  default: { box: "size-6 rounded-md", glyph: "size-4", name: "text-base" },
  lg: {
    box: "size-10 rounded-xl",
    glyph: "size-5",
    name: "font-display text-xl font-extrabold tracking-tight",
  },
};

export function PlatformLogo({
  href = "/",
  className,
  showName = true,
  tone = "primary",
  size = "default",
}: PlatformLogoProps) {
  const scale = LOGO_SIZES[size];

  const content = (
    <div className={cn("flex items-center gap-2.5 font-medium", className)}>
      <div
        className={cn(
          "flex items-center justify-center",
          LOGO_TONES[tone],
          scale.box,
        )}
      >
        {/* A filled play triangle: this app makes short videos, and a glyph
            that says so beats an abstract mark nobody can read. */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className={scale.glyph}
          aria-hidden="true"
        >
          <path d="M8.5 5.2a1 1 0 0 1 1.52-.85l8 6.8a1 1 0 0 1 0 1.7l-8 6.8a1 1 0 0 1-1.52-.85Z" />
        </svg>
      </div>
      {showName ? <span className={scale.name}>{APP_NAME}</span> : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex">
        {content}
      </Link>
    );
  }
  return content;
}
