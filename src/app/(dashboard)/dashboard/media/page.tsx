/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: MediaPage, RESOURCES.assets.nav, MediaLibrary
 *
 * WHAT:  /dashboard/media — every file this workspace can put in a video.
 * WHY:   `width="full"` for the same reason the projects page uses it: the
 *        table carries a preview, a name, a type, a size, a duration and a
 *        status, and the default column would wrap the last three on a laptop.
 *        The page is a server component that renders the layout and nothing
 *        else — the upload panel and the table both need client state, so they
 *        own it rather than this file threading props down.
 * WHERE: RESOURCES.assets.nav.href in src/lib/resources.ts puts this in the
 *        sidebar, and the dashboard layout's ROUTE_AUTHORIZATION gates it from
 *        the same declaration.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { MediaLibrary } from "./_components/media-library";

export const metadata: Metadata = {
  title: "Media",
};

export default function MediaPage() {
  return (
    <ContentLayout title="Media" width="full">
      <MediaLibrary />
    </ContentLayout>
  );
}
