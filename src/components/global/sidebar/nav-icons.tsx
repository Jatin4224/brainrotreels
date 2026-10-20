/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: NAV_ICONS, getNavIcon, NavIconName
 *
 * WHAT:  Maps the `nav.icon` string on a RESOURCES entry to a lucide icon
 *        component, with a safe fallback.
 * WHY:   RESOURCES stores icons as plain strings (it must stay free of React
 *        imports). This is the single place those strings resolve to
 *        components, so adding a new nav icon means adding one map entry here.
 * WHERE: Used by src/components/global/sidebar/app-sidebar.tsx.
 */

import {
  BarChart3,
  Circle,
  CreditCard,
  Folder,
  LayoutDashboard,
  Library,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

/* Keyed by the exact strings used in RESOURCES[*].nav.icon. */
export const NAV_ICONS: Record<string, LucideIcon> = {
  Folder,
  /* Media, not Projects. Both are collections, so `Folder` would have read as
   * the same thing twice in one sidebar section. */
  Library,
  Users,
  BarChart: BarChart3,
  ScrollText,
  CreditCard,
  Settings,
  LayoutDashboard,
};

export type NavIconName = keyof typeof NAV_ICONS;

/**
 * SOURCE OF TRUTH KEYWORDS: getNavIcon
 *
 * WHAT:  Resolves an icon string to a component, falling back to a neutral
 *        circle so an unmapped name never crashes the sidebar.
 * WHERE: Called by app-sidebar.tsx when rendering each nav item.
 */
export function getNavIcon(name: string): LucideIcon {
  return NAV_ICONS[name] ?? Circle;
}
