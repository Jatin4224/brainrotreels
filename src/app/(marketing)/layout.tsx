/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MarketingLayout, PUBLIC_ROUTE_GROUP,
 *   NO_AUTH_IN_THIS_GROUP
 *
 * WHAT:  The shell for every public, unauthenticated page — pricing and the
 *        legal documents.
 *
 * WHY:   PUBLIC_ROUTE_GROUP. A route group of its own, parallel to `(auth)`,
 *        `(dashboard)` and `(portal)`, because these pages differ from all
 *        three in the one way that matters: they must render for somebody with
 *        no account. Putting them under `(dashboard)` would inherit its
 *        ROUTE_AUTHORIZATION gate and bounce every visitor to sign-in, which
 *        for a PRICING page is the whole audience.
 *
 *        NO_AUTH_IN_THIS_GROUP, and nothing in it may read a session. These
 *        pages are static — no tRPC, no `headers()`, no cookies — so they can
 *        be cached and served to an anonymous visitor at the speed a landing
 *        page needs. A single auth read anywhere beneath here would silently
 *        opt the whole group out of that.
 *
 *        The root layout still wraps this, so the theme, the fonts and the
 *        analytics provider all apply — which is why there is no `<html>` here
 *        and why a visitor's cookie choice is honoured on these pages too.
 * WHERE: Wraps src/app/(marketing)/pricing and src/app/(marketing)/legal.
 */

import Link from "next/link";

import { APP_NAME } from "@/lib/config/branding";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="text-sm font-semibold">
            {APP_NAME}
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/pricing" className="text-muted-foreground hover:text-foreground">
              Pricing
            </Link>
            <Link href="/legal" className="text-muted-foreground hover:text-foreground">
              Legal
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {APP_NAME}
          </p>
          <div className="flex gap-4">
            <Link href="/legal/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/legal/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/legal/refunds" className="hover:text-foreground">
              Refunds
            </Link>
            <Link href="/legal/takedown" className="hover:text-foreground">
              Report content
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
