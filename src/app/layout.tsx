/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: metadata, RootLayout, UpgradeModalProvider,
 *   GLOBAL_UPGRADE_SURFACE
 *
 * WHAT:  Root <html>/<body> layout, global metadata, and the mount point for
 *        TRPCReactProvider (which hosts the QueryClient, the optimistic
 *        feature-gate observer, and the AuthRedirectObserver).
 * WHY:   The tRPC provider has to wrap every page so `trpc.X.useQuery()`
 *        calls anywhere in the tree share one cache, and so the cache
 *        observers (auth-redirect, feature-gate) can see every query /
 *        mutation. Mounting it at the root layout is the single place that
 *        makes that true for all routes.
 *        AuthBoundary sits OUTSIDE TRPCReactProvider because a provider's own
 *        React context must be available to anything that reads auth state,
 *        including components rendered by tRPC consumers. Better Auth needs no
 *        context, so it renders children untouched.
 * WHERE: Reads BRANDING from src/lib/config; wraps every route segment under
 *        src/app/; renders AuthBoundary from src/components/global/providers and
 *        TRPCReactProvider from src/trpc/react-provider.
 */

import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  DM_Sans,
  Geist,
  Geist_Mono,
  Space_Grotesk,
} from "next/font/google";
import "./globals.css";
import { BRANDING } from "@/lib/config";
import {
  hasMissingRequiredEnv,
  getEnvChecklist,
  getOptionalEnvChecklist,
} from "@/lib/config/required-env";
import { TRPCReactProvider } from "@/trpc/react-provider";
import { UpgradeModalProvider } from "@/components/global/upgrade-modal";
import { AuthBoundary } from "@/components/global/providers/server";
import { AnalyticsProvider } from "@/components/global/providers/analytics";
import { CookieConsent } from "@/components/global/providers/cookie-consent";
import { ThemeProvider } from "@/components/theme-provider";
import { SetupChecklist } from "@/components/global/setup-checklist";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

/* Geist is the app-wide sans font (matches funnelmods). Its variable
 * (--font-geist-sans) is set on <html>, where globals.css's `html { @apply
 * font-sans }` + `--font-sans: var(--font-geist-sans)` resolve it. Geist Mono
 * backs --font-geist-mono / the `font-mono` utility. */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* SOURCE OF TRUTH KEYWORDS: dmSans, --font-dm-sans, --font-display,
 * MARKETING_DESIGN_LANGUAGE
 *
 * The DISPLAY face, used by the public marketing pages only (`font-display`,
 * wired in globals.css). Loaded here rather than in the marketing layout
 * because next/font must run in a module the layout tree can set a className
 * from, and the <html> element is the one place a font variable reaches every
 * subtree. It costs nothing inside the product: no app surface references
 * `font-display`, so the face is only ever fetched by a page that paints with
 * it. Variable weights 400–900 — design.md's headings are big and LIGHT, which
 * only works with a face that has the range. */
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800", "900"],
});

/* SOURCE OF TRUTH KEYWORDS: bricolage, spaceGrotesk, --font-bricolage,
 * --font-space-grotesk, auth-typography, AUTH_WEARS_THE_BRAND
 *
 * The AUTH screens' pair, wired into `.auth-typography` in globals.css:
 * Bricolage Grotesque for the headlines and the reel titles on the showcase
 * panel, Space Grotesk for everything else (auth-design.md §2). Declared here
 * for the same reason `dmSans` is — next/font has to run in a module the
 * layout tree can set a className from, and <html> is the one element whose
 * variables reach every subtree. They cost nothing anywhere else: no surface
 * outside src/app/(auth) references either variable, so the faces are only
 * fetched by a page that paints with them.
 *
 * Both are VARIABLE fonts, so no `weight` is listed — the whole axis ships in
 * one file and the 800 the headlines ask for is a `font-weight`, not a second
 * request. */
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: BRANDING.metadataBase,
  title: {
    default: BRANDING.appName,
    template: `%s — ${BRANDING.appName}`,
  },
  description: BRANDING.appDescription,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "h-full",
        geistSans.variable,
        geistMono.variable,
        dmSans.variable,
        bricolage.variable,
        spaceGrotesk.variable,
      )}
    >
      <body
        className="min-h-full flex flex-col antialiased"
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {/* Developer setup gate: until every REQUIRED env var is set, show the
              checklist instead of the app (optional integrations fail soft and
              are not gated). */}
          {hasMissingRequiredEnv() ? (
            <SetupChecklist
              items={getEnvChecklist()}
              optional={getOptionalEnvChecklist()}
            />
          ) : (
            <AuthBoundary>
              <TRPCReactProvider>
                {/* GLOBAL_UPGRADE_SURFACE: one upgrade modal for the whole app.
                    It sits INSIDE the tRPC provider because it opens itself off
                    the query/mutation caches whenever the server refuses a call
                    for plan reasons — see UpgradeModalProvider. Mounting it here
                    rather than per feature is what makes every gate, current and
                    future, land on the same screen. */}
                {/* PAGEVIEWS_ARE_THE_CLIENT_HALF. Innermost, and on purpose:
                    it renders nothing and loads nothing without a key, so it
                    is the one provider whose absence must change nothing about
                    the tree. The FUNNEL is emitted server-side — see
                    SERVER_SIDE_FUNNEL. */}
                <AnalyticsProvider>
                  <UpgradeModalProvider>{children}</UpgradeModalProvider>
                  {/* CONSENT_GATES_THE_SDK — the banner and the provider read
                      the same hook, so declining means the tracker is never
                      imported rather than loaded and ignored. It renders
                      nothing at all when analytics is unconfigured. */}
                  <CookieConsent />
                </AnalyticsProvider>
              </TRPCReactProvider>
            </AuthBoundary>
          )}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
