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
 * SOURCE OF TRUTH KEYWORDS: ThemeProvider
 *
 * WHAT:  Client wrapper around next-themes' ThemeProvider — applies a `.dark`
 *        or `.light` class to <html> so the Tailwind/shadcn token variables
 *        switch on the right selector.
 * WHY:   shadcn's CSS keys dark mode off the `.dark` class on a parent
 *        element; next-themes is the canonical way to inject that class
 *        before hydration without a flash of incorrect theme. Wrapping is
 *        required because next-themes is a client component.
 * WHERE: Mounted by src/app/layout.tsx around the rest of the app tree;
 *        consumed implicitly by every component that uses dark: classes or
 *        reads useTheme() (e.g. src/components/ui/sonner.tsx).
 */

'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ThemeProviderProps } from 'next-themes'

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
