/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and licensed under the Architectural
 * Guardrail Community License found in the LICENSE file in the root
 * directory of this source tree. Use requires a paid AI Era membership
 * or purchase (https://www.skool.com/ai-era). Unauthorized use, copying,
 * or distribution is prohibited.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: useCopyToClipboard, CopyToClipboard, copied,
 *   COPY_FEEDBACK_RESET, navigator.clipboard, COPYABLE_INVITE_LINK
 *
 * WHAT:  `copy(value)` writes to the clipboard and reports whether it worked,
 *        plus a `copied` flag that flips back to false on its own.
 * WHY:   The write + "copied!" flag + reset timer were written inline in the
 *        invite sheet, and the roster's copy-link action needed the identical
 *        three. One hook rather than a second copy — the reset delay and the
 *        failure handling stay in one place instead of drifting apart.
 *        RETURNS A BOOLEAN rather than swallowing the failure: `navigator
 *        .clipboard` rejects on an insecure origin or a denied permission, and
 *        a caller that shows a success toast regardless would be lying about
 *        something the user cannot verify without pasting. Callers decide how
 *        to report it — an inline tick, a toast, or nothing.
 *        The timer is cleared on unmount, so a component torn down mid-flash
 *        (a dropdown item, which unmounts the moment the menu closes) does not
 *        set state after teardown.
 * WHERE: The invite sheet's link field and the roster's "Copy invite link"
 *        action, both under src/app/(dashboard)/dashboard/team/_components.
 */

import * as React from 'react'

/* Long enough to register as feedback, short enough that the control is back to
 * its resting state before the user looks again. */
const COPY_FEEDBACK_RESET_MS = 2000

export interface CopyToClipboard {
  /** Writes `value`; resolves true on success, false when the browser refused. */
  copy: (value: string) => Promise<boolean>
  /** True for COPY_FEEDBACK_RESET_MS after a successful copy. */
  copied: boolean
}

export function useCopyToClipboard(): CopyToClipboard {
  const [copied, setCopied] = React.useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    },
    []
  )

  const copy = React.useCallback(async (value: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      /* Insecure origin, or the user denied clipboard access. */
      return false
    }
    setCopied(true)
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_RESET_MS)
    return true
  }, [])

  return { copy, copied }
}
