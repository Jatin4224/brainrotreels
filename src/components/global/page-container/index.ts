/*

 */

/**
 * SOURCE OF TRUTH KEYWORDS: PageContainer, PageContainerProps, PageContainerWidth,
 *   PAGE_CONTAINER_WIDTHS
 *
 * WHAT:  Barrel for the page content container.
 * WHY:   One import surface — `@/components/global/page-container`.
 * WHERE: Imported by ContentLayout and by pages that center content directly.
 */

export { PageContainer, PAGE_CONTAINER_WIDTHS } from "./page-container";
export type { PageContainerProps, PageContainerWidth } from "./page-container";
