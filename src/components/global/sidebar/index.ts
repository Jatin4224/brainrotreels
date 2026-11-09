/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: AppSidebar, AppSidebarProps, SidebarUpgradeNudge,
 *   SidebarPlanMeter, SidebarRecentProjects, SidebarSearch
 *
 * WHAT:  Barrel for the dashboard sidebar components.
 * WHY:   One import surface for the dashboard layout.
 * WHERE: Imported by src/app/(dashboard)/layout.tsx.
 */

export { AppSidebar } from "./app-sidebar";
export type { AppSidebarProps } from "./app-sidebar";
export { SidebarUpgradeNudge } from "./upgrade-nudge";
export { SidebarPlanMeter } from "./plan-meter";
export { SidebarRecentProjects } from "./recent-projects";
export { SidebarSearch } from "./sidebar-search";
export type { SidebarSearchProps } from "./sidebar-search";
