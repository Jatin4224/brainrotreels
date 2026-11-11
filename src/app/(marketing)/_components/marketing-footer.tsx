/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MarketingFooter, FOOTER_COLUMNS,
 *   MarketingNavColumn, APP_DESCRIPTION, AUTH_ROUTES, LEGAL_IS_NOT_OPTIONAL
 *
 * WHAT:  The public footer — wordmark and tagline, then the product, format,
 *        developer and legal columns, over a bottom bar with the copyright.
 *
 * WHY:   LEGAL_IS_NOT_OPTIONAL: terms, privacy, refunds and the takedown route
 *        have to be reachable from every public page, which is what a shared
 *        footer in the group layout guarantees — a per-page footer is how one
 *        of them silently goes missing from the page a regulator actually
 *        opens. The previous footer carried exactly these links in a single
 *        row; the columns are a layout change, not a change to what is
 *        promised.
 *
 *        The columns are DATA, so the grid renders a list rather than four
 *        hand-written blocks — a fifth column is a push to this array. The
 *        FORMATS column names the product's real formats; they are written
 *        here rather than read from `PROJECT_KINDS` because what a footer link
 *        needs is a phrase a visitor searches for ("Reddit story videos"), not
 *        the enum member the pipeline switches on, and the landing page's own
 *        format section is the registry-derived surface that cannot drift.
 *
 *        A Server Component — no session, no state (NO_AUTH_IN_THIS_GROUP).
 * WHERE: Rendered by src/app/(marketing)/layout.tsx beneath every public page.
 */

import Link from "next/link";

import { PlatformLogo } from "@/components/global/platform-logo";
import { AUTH_ROUTES } from "@/lib/config/auth-routes";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/config/branding";
import type { MarketingNavColumn } from "@/lib/types";

const FOOTER_COLUMNS: readonly MarketingNavColumn[] = [
  {
    heading: "Product",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "What you get", href: "/#features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Questions", href: "/#faq" },
    ],
  },
  {
    heading: "Formats",
    links: [
      { label: "Reddit story videos", href: "/#formats" },
      { label: "Voiceover videos", href: "/#formats" },
      { label: "Quiz videos", href: "/#formats" },
      { label: "Motion explainers", href: "/#formats" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "API reference", href: "/docs/api" },
      { label: "MCP server", href: "/docs/api" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms", href: "/legal/terms" },
      { label: "Privacy", href: "/legal/privacy" },
      { label: "Refunds", href: "/legal/refunds" },
      { label: "Report content", href: "/legal/takedown" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t-2 border-border">
      <div className="mx-auto max-w-7xl px-6 py-14">
        {/* Six units: the brand block takes two, the four link columns one each.
            A 5-column grid wrapped the last column onto its own row. */}
        <div className="mb-12 grid gap-12 sm:grid-cols-2 lg:grid-cols-6 lg:gap-8">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <PlatformLogo href="/" size="md" />
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              {APP_DESCRIPTION}
            </p>
            <Link
              href={AUTH_ROUTES.signUp}
              className="text-sm font-semibold text-brand-accent underline underline-offset-4 hover:text-foreground"
            >
              Get started
            </Link>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.heading} className="flex flex-col gap-3">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-accent">
                {column.heading}
              </p>
              <ul className="flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={`${column.heading}-${link.label}`}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {APP_NAME}. All rights reserved.
          </p>
          <p>Every frame generated, narrated, captioned and rendered here.</p>
        </div>
      </div>
    </footer>
  );
}
