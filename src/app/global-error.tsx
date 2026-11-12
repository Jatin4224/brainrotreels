"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: GlobalError, ROOT_LAYOUT_FAILED,
 *   GLOBAL_ERROR_OWNS_THE_DOCUMENT, THEME_PROVIDER_NOT_A_DARK_CLASS,
 *   forcedTheme, RouteError
 *
 * WHAT:  The last boundary — the one Next.js uses when the ROOT layout itself
 *        failed to render.
 *
 * WHY:   GLOBAL_ERROR_OWNS_THE_DOCUMENT. This component REPLACES the root
 *        layout rather than rendering inside it, so it has to supply its own
 *        `<html>` and `<body>`; without them the page renders nothing at all.
 *        For the same reason it imports `globals.css` directly — the root
 *        layout's import is exactly what did not run.
 *
 *        THEME_PROVIDER_NOT_A_DARK_CLASS. The tokens in globals.css resolve to
 *        LIGHT values on a bare `:root`, so without a theme this page would be
 *        the one white screen in a dark-only app — and it would appear at the
 *        moment the product looks least trustworthy. The fix is the same
 *        ThemeProvider the root layout uses with the same `forcedTheme`, not a
 *        hardcoded `dark` class: forcing the class here would plant exactly
 *        the kind of literal the theming rule exists to keep out, and it would
 *        stop tracking the app if the forced theme ever changes.
 *
 *        The `next/font` variables are NOT re-declared. They are set on the
 *        root layout's `<html>`, so type on this page falls back to the system
 *        sans stack. That is deliberate: instantiating the fonts a second time
 *        to style the root-crash page would add a font payload to every build
 *        for a page that should never render, and a fallback face is a far
 *        smaller problem than the crash it is reporting.
 *
 * WHERE: Rendered by Next.js. The end of the chain documented in error.tsx.
 */

import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { RouteError } from "@/components/global/route-error";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="flex min-h-full flex-col antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <main className="flex flex-1 items-center justify-center px-4 py-16">
            <div className="w-full max-w-md">
              <RouteError
                error={error}
                reset={reset}
                logger="ui.root"
                titleAs="h1"
                title="The app could not start"
                description="Something failed before the page could be set up. Trying again usually clears it."
                action={{ href: "/", label: "Go to the homepage" }}
              />
            </div>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
