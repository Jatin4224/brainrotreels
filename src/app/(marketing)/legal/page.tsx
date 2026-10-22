/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: LegalIndexPage, TAKEDOWN_IS_FINDABLE
 *
 * WHAT:  /legal — the index of the four documents, and the takedown route.
 * WHY:   TAKEDOWN_IS_FINDABLE is the reason this index exists rather than the
 *        footer links being the only way in. A takedown contact buried two
 *        clicks deep is one a rights holder cannot find, and the consequence of
 *        that is a complaint to a host rather than to us. It is listed first.
 * WHERE: Linked from the marketing layout's header and footer.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Legal",
};

const DOCUMENTS = [
  {
    href: "/legal/takedown" as const,
    title: "Report content",
    blurb:
      "Ask us to remove a video, or report something generated with our tools.",
  },
  {
    href: "/legal/terms" as const,
    title: "Terms of service",
    blurb: "What you agree to by using the product.",
  },
  {
    href: "/legal/privacy" as const,
    title: "Privacy policy",
    blurb: "What we collect, why, and who we share it with.",
  },
  {
    href: "/legal/refunds" as const,
    title: "Refund policy",
    blurb: "How subscriptions and credits are refunded.",
  },
];

export default function LegalIndexPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Legal</h1>

      <div className="flex flex-col gap-3">
        {DOCUMENTS.map((document) => (
          <Link key={document.href} href={document.href}>
            <Card className="transition-colors hover:border-primary">
              <CardContent className="flex flex-col gap-1 py-4">
                <p className="text-sm font-medium">{document.title}</p>
                <p className="text-sm text-muted-foreground">
                  {document.blurb}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
