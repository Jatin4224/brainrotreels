/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: NewVideoPage, COMPOSER_ROUTE, FORMAT_FROM_THE_URL,
 *   CREATABLE_PROJECT_KINDS, ComposerScreen
 *
 * WHAT:  /dashboard/new — the composer the home screen's format cards lead
 *        to. The format is carried in `?kind=`.
 *
 * WHY:   A ROUTE, not a sheet. Choosing a format and describing a video is
 *        the start of a real piece of work: it deserves a URL that can be
 *        bookmarked, linked and reached with the back button, and a sheet
 *        over the picker gave none of that. It also means "New video" in the
 *        sidebar has somewhere honest to point.
 *
 *        FORMAT_FROM_THE_URL, validated rather than trusted. `?kind=` is
 *        attacker-controlled like any query param, and an unchecked value
 *        would reach `FORMATS[kind]` and render `undefined.label`. Anything
 *        that is not a CREATABLE kind falls back to the default format — not
 *        a 404, because the only way to get a bad value here is a hand-edited
 *        URL or a retired format in somebody's bookmark, and both are better
 *        served by a working composer than by an error.
 * WHERE: Linked from the format cards on /dashboard.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { CREATABLE_PROJECT_KINDS, type CreatableProjectKind } from "@/lib/types";

import { ComposerScreen } from "./_components";

export const metadata: Metadata = {
  title: "New video",
};

/* The format used when `?kind=` is absent or not one we can start. */
const DEFAULT_KIND: CreatableProjectKind = "voiceover";

function resolveKind(raw: string | string[] | undefined): CreatableProjectKind {
  if (typeof raw !== "string") return DEFAULT_KIND;
  const match = CREATABLE_PROJECT_KINDS.find((kind) => kind === raw);
  return match ?? DEFAULT_KIND;
}

export default async function NewVideoPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[] }>;
}) {
  const { kind } = await searchParams;

  return (
    <ContentLayout title="New video" width="full">
      <ComposerScreen kind={resolveKind(kind)} />
    </ContentLayout>
  );
}
