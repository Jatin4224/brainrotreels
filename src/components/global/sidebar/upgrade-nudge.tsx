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
 * SOURCE OF TRUTH KEYWORDS: SidebarUpgradeNudge, useUpgradeNudge,
 *   useUpgradeModal, UPGRADE_NUDGE_COPY, TWO_VOLUMES, COLLAPSED_FALLBACK
 *
 * WHAT:  The upgrade prompt that sits directly above the profile in the sidebar
 *        footer — a card for someone who has not bought yet, one muted line for
 *        someone who already pays — opening the upgrade modal on the plan its
 *        own label named.
 * WHY:   TWO_VOLUMES, decided by useUpgradeNudge, not here. A free or trialing
 *        workspace has not made the decision the product is asking for, and a
 *        line of grey text is not an offer; it gets a section with a button. A
 *        paying customer HAS decided, and a permanent advert aimed at them is
 *        the fastest way to teach someone to ignore that corner of the screen —
 *        so a tier or billing-period nudge stays one line, muted, with the CTA
 *        arrow appearing only under the pointer.
 *        COLLAPSED_FALLBACK: at icon width neither shape fits, so both collapse
 *        to the same single icon with the message in its tooltip. Done in CSS
 *        against the sidebar's own data-collapsible state rather than by reading
 *        it in JS, so the server and the client render the same markup.
 *        Renders NOTHING when there is nothing honest to sell (top plan, billed
 *        yearly). This component chooses no copy and no plan of its own.
 * WHERE: Rendered by <AppSidebar /> in SidebarFooter, above the user menu.
 */

import * as React from 'react'
import {
  ArrowUpRightIcon,
  ChevronsUpIcon,
  GiftIcon,
  SparklesIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react'

import { BRANDING } from '@/lib/config'
import {
  useUpgradeModal,
  useUpgradeNudge,
  type UpgradeNudge,
  type UpgradeNudgeReason,
} from '@/components/global/upgrade-modal'
import { Button } from '@/components/ui/button'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'

export function SidebarUpgradeNudge() {
  const nudge = useUpgradeNudge()
  const upgradeModal = useUpgradeModal()

  if (!nudge) return null

  const open = () => upgradeModal.open({ plan: nudge.targetPlan })

  return (
    <>
      {/* Expanded: whichever shape this nudge earned. */}
      <div className="group-data-[collapsible=icon]:hidden">
        {nudge.variant === 'card' ? (
          <UpgradeCard nudge={nudge} onUpgrade={open} />
        ) : (
          <InlineNudge nudge={nudge} onUpgrade={open} />
        )}
      </div>

      {/* Collapsed: one icon, tooltip carries the message. */}
      <SidebarMenu className="hidden group-data-[collapsible=icon]:block">
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            tooltip={nudge.message}
            aria-label={BRANDING.upgradeNudge.ariaLabel}
            onClick={open}
            className="text-muted-foreground hover:text-foreground"
          >
            {React.createElement(NUDGE_ICONS[nudge.reason])}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: UpgradeCard, PREMIUM_SURFACE
 *
 * WHAT:  The loud shape: what they are on now, what upgrading gets them, and a
 *        real button. Every string is already interpolated by useUpgradeNudge —
 *        the plan name is never assembled here.
 * WHY:   PREMIUM_SURFACE. Everything else in the sidebar is a flat row on the
 *        sidebar colour, so a card that is ALSO flat black reads as a panel
 *        someone forgot to style — which is a poor advert for a paid tier. The
 *        treatment is the same one the SELECTED pricing card uses in the upgrade
 *        modal: a primary-tinted wash over the card colour, one lit edge, and a
 *        small shadow. That deliberate echo means the surface that sells the
 *        upgrade looks the same in both places.
 *        Every layer is a token at low opacity — no literal colour, nothing that
 *        stops following the theme, and nothing loud enough to compete with the
 *        nav it sits under.
 * WHERE: The card branch of <SidebarUpgradeNudge /> above.
 */
function UpgradeCard({
  nudge,
  onUpgrade,
}: {
  nudge: Extract<UpgradeNudge, { variant: 'card' }>
  onUpgrade: () => void
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
      {/* Two flat layers over the card colour, both derived from --primary so
          they invert with the theme instead of painting a fixed tint. Kept
          under 10% opacity: the point is that the surface reads as considered,
          not that anyone notices a gradient. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-linear-to-br from-primary/8 via-transparent to-primary/5"
      />
      {/* Hairline along the top edge, brightest in the middle — the detail that
          makes a flat rectangle read as a lit surface rather than a hole. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-foreground/20 to-transparent"
      />

      <div className="relative p-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-primary/10">
            <SparklesIcon className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] leading-none text-muted-foreground">
              {BRANDING.upgradeNudge.currentPlanLabel}
            </p>
            <p className="mt-1 truncate text-sm font-semibold">{nudge.currentPlanLabel}</p>
          </div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{nudge.body}</p>

        <Button size="sm" onClick={onUpgrade} className="mt-3 w-full gap-1.5 shadow-sm">
          <ZapIcon className="size-3.5" />
          {nudge.ctaLabel}
        </Button>
      </div>
    </div>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: InlineNudge, AMBIENT_NOT_INTERRUPTIVE
 *
 * The quiet shape: one line that should register once and then sit at the back
 * of the mind. Its icon (see NUDGE_ICONS) and the hover-revealed arrow are the
 * entire affordance — enough to read as clickable on approach without becoming
 * a button competing with the nav above it.
 */
function InlineNudge({
  nudge,
  onUpgrade,
}: {
  nudge: Extract<UpgradeNudge, { variant: 'inline' }>
  onUpgrade: () => void
}) {
  const Icon = NUDGE_ICONS[nudge.reason]
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="sm"
          tooltip={nudge.message}
          aria-label={BRANDING.upgradeNudge.ariaLabel}
          onClick={onUpgrade}
          className="group/nudge text-muted-foreground hover:text-foreground"
        >
          <Icon className="opacity-70 transition-opacity group-hover/nudge:opacity-100" />
          <span className="truncate">{nudge.message}</span>
          <ArrowUpRightIcon className="ml-auto size-3.5! opacity-0 transition-opacity group-hover/nudge:opacity-100" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: NUDGE_ICONS, UpgradeNudgeReason
 *
 * WHAT:  The icon per nudge reason, in both the expanded and collapsed shapes.
 * WHY:   The gift is a DISCOUNT, not a decoration — it belongs to the one nudge
 *        that actually hands the user money back (monthly → yearly) and nowhere
 *        else. Wearing it on a plain tier upsell would spend the symbol on an
 *        offer that gives nothing away, and then it says nothing on the day
 *        there is a real saving. A tier nudge points up, and the not-yet-bought
 *        card leads with the product sparkle.
 *        Keyed by the reason the hook already decided, so the icon cannot drift
 *        from the sentence beside it.
 * WHERE: Both variants above, and the collapsed fallback.
 */
const NUDGE_ICONS: Record<UpgradeNudgeReason, LucideIcon> = {
  yearly: GiftIcon,
  tier: ChevronsUpIcon,
  free: SparklesIcon,
  trial: SparklesIcon,
}
