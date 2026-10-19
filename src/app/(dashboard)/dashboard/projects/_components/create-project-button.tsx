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
 * SOURCE OF TRUTH KEYWORDS: CreateProjectButton, FeatureGate, PLAN_LIMIT_UX,
 *   projects.create, PROJECTS_CREATE
 *
 * WHAT:  The header action on /dashboard/projects: opens the create sheet, or
 *        the upgrade modal when the workspace is at its plan cap.
 * WHY:   PLAN_LIMIT_UX. <FeatureGate resource="projects"> intercepts the click
 *        at the cap and opens the upgrade modal instead of the sheet, so the
 *        customer never fills in a form that the server is going to refuse. The
 *        server enforces the same cap independently — the gate is UX only, and
 *        the refusal it would have thrown carries the same registry copy, so
 *        both paths land on the identical screen.
 *        Hidden outright without `projects:create`: a disabled button that
 *        never becomes enabled is worse than no button.
 *        `invocation` remounts the sheet body so each open starts on a clean
 *        form, but stays stable while CLOSING so Base UI's dialog can finish
 *        its close sequence — the same reason InviteMemberButton does it.
 * WHERE: Passed as ContentLayout's `actions` by the projects page.
 */

import * as React from 'react'
import { Plus } from 'lucide-react'

import { useActiveOrganization, useActiveOrganizationId } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import { FeatureGate } from '@/components/feature-gate'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { CreateProjectSheetContent } from './create-project-sheet-content'

export function CreateProjectButton() {
  const [open, setOpen] = React.useState(false)
  const [invocation, setInvocation] = React.useState(0)
  const { hasPermission } = useActiveOrganization()
  const organizationId = useActiveOrganizationId()

  if (!organizationId || !hasPermission(permissions.PROJECTS_CREATE)) return null

  function handleOpen() {
    setInvocation((n) => n + 1)
    setOpen(true)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <FeatureGate resource="projects">
        <Button className="gap-2" onClick={handleOpen}>
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </FeatureGate>
      <CreateProjectSheetContent
        key={invocation}
        organizationId={organizationId}
        onClose={() => setOpen(false)}
      />
    </Sheet>
  )
}
