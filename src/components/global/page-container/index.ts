/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PageContainer, PageContainerProps, PageContainerWidth,
 *   PAGE_CONTAINER_WIDTHS
 *
 * WHAT:  Barrel for the page content container.
 * WHY:   One import surface — `@/components/global/page-container`.
 * WHERE: Imported by ContentLayout and by pages that center content directly.
 */

export { PageContainer, PAGE_CONTAINER_WIDTHS } from './page-container'
export type { PageContainerProps, PageContainerWidth } from './page-container'
