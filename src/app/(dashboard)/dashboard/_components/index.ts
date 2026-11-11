/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: dashboard home _components barrel,
 *   DashboardHomeScreen, FormatCard, CATEGORY_CLASSES
 *
 * WHAT:  Public surface of the dashboard home screen's own components.
 * WHY:   One import in the page instead of three, and the one place that says
 *        which of these are meant to be used from outside the folder.
 *        Route-local on purpose: the FORMAT REGISTRY is global
 *        (src/lib/config/formats.ts) because three surfaces need it, but the
 *        picker's markup serves exactly one screen and stays beside it.
 * WHERE: Imported as './_components' by
 *        src/app/(dashboard)/dashboard/page.tsx.
 */

export { DashboardHomeScreen } from "./home-screen";
export { FormatCard } from "./format-card";
export type { FormatCardProps } from "./format-card";
export { CATEGORY_CLASSES } from "./format-tokens";
export type { CategoryClasses } from "./format-tokens";
