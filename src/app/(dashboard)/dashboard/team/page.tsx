/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: TeamPage
 *
 * WHAT:  /dashboard/team route — thin shell; TeamClient does the work.
 * WHERE: RESOURCES.member.nav.href.
 */

import type { Metadata } from "next";

import { TeamClient } from "./_components/team-client";
import { MemberManagement } from "@/components/global/providers/server";

export const metadata: Metadata = {
  title: "Team",
};

export default function TeamPage() {
  return <TeamClient memberManagement={<MemberManagement />} />;
}
