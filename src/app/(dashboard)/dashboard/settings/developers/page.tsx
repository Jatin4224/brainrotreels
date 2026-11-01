/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: DevelopersSettingsPage, THE_SCREEN_IS_NOT_GATED,
 *   SERVER_PAGE_CLIENT_PANEL
 *
 * WHAT:  /dashboard/settings/developers — API keys, and what the API is.
 * WHY:   THE_SCREEN_IS_NOT_GATED (`requireFlag: false` on the registry entry).
 *        A workspace without API access still reaches this page and is told
 *        what the feature does and what upgrading would buy, because hiding it
 *        means the only people who ever discover the API are the ones already
 *        paying for it.
 *
 *        SERVER_PAGE_CLIENT_PANEL, the same split as every other settings
 *        screen: the page costs no JavaScript of its own and the panel is a
 *        client child because it holds a dialog, a clipboard action and the
 *        one-time reveal of a minted key.
 * WHERE: RESOURCES.apiKeys.nav.href.
 */

import type { Metadata } from "next";

import { ContentLayout } from "@/components/global/page-header";
import { ApiKeysPanel } from "./_components/api-keys-panel";

export const metadata: Metadata = {
  title: "Developers",
};

export default function DevelopersSettingsPage() {
  return (
    <ContentLayout title="Developers">
      <ApiKeysPanel />
    </ContentLayout>
  );
}
