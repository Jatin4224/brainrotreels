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
 * SOURCE OF TRUTH KEYWORDS: ProjectRowActions, RenameProjectDialog,
 *   projects.rename, projects.duplicate, projects.delete, PERMISSION_PER_ITEM,
 *   DESTRUCTIVE_CONFIRM
 *
 * WHAT:  The per-row menu: rename, duplicate, delete.
 * WHY:   PERMISSION_PER_ITEM — each entry is hidden without its own permission,
 *        because `projects:update` and `projects:delete` are separate grants
 *        and a custom role may hold one without the other.
 *        DESTRUCTIVE_CONFIRM: delete goes through an AlertDialog, and the
 *        Timeline row goes with it by the schema's cascade — there is no
 *        recycle bin, so the confirmation says so plainly.
 *        Duplicate is wrapped in <FeatureGate> because it creates a project and
 *        so consumes a plan slot; the server checks the same cap explicitly
 *        (EXPLICIT_GATE_ON_DUPLICATE in the router) since the factory's
 *        automatic gate only fires on a `.create` path.
 * WHERE: Passed to <DataTable rowActions> by ProjectsTable.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Loader2Icon, MoreHorizontal, Pencil, PlayIcon, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import { projectTitleSchema } from '@/lib/types'
import { FeatureGate } from '@/components/feature-gate'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface ProjectRowActionsProps {
  organizationId: string
  project: { id: string; title: string }
}

export function ProjectRowActions({ organizationId, project }: ProjectRowActionsProps) {
  const utils = trpc.useUtils()
  const router = useRouter()
  const { hasPermission } = useActiveOrganization()
  const [renaming, setRenaming] = React.useState(false)
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)

  const duplicate = trpc.projects.duplicate.useMutation()
  const remove = trpc.projects.delete.useMutation()

  const canUpdate = hasPermission(permissions.PROJECTS_UPDATE)
  const canCreate = hasPermission(permissions.PROJECTS_CREATE)
  const canDelete = hasPermission(permissions.PROJECTS_DELETE)
  if (!canUpdate && !canCreate && !canDelete) return null

  /* Both mutations change the row count, so the usage counter is refetched
   * alongside the list — the plan cards and the create gate read it. */
  async function refresh() {
    await Promise.all([utils.projects.list.invalidate(), utils.usage.invalidate()])
  }

  async function handleDuplicate() {
    try {
      const copy = await duplicate.mutateAsync({ organizationId, id: project.id })
      await refresh()
      toast.success(`"${copy.title}" created`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not duplicate this project.')
    }
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync({ organizationId, id: project.id })
      await refresh()
      setConfirmingDelete(false)
      toast.success(`"${project.title}" deleted`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete this project.')
    }
  }

  const isBusy = duplicate.isPending || remove.isPending

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label={`Actions for ${project.title}`}>
              {isBusy ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <MoreHorizontal className="size-4" />
              )}
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {/* First, and available to anyone who can READ the project — watching
              a video is not an edit. The route is typed, so a rename of the
              page fails the build rather than shipping a dead menu item. */}
          <DropdownMenuItem
            onClick={() => router.push(`/dashboard/projects/${project.id}/preview`)}
          >
            <PlayIcon className="size-4" />
            Preview
          </DropdownMenuItem>
          {canUpdate ? (
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil className="size-4" />
              Rename
            </DropdownMenuItem>
          ) : null}
          {canCreate ? (
            <FeatureGate resource="projects">
              <DropdownMenuItem onClick={handleDuplicate} disabled={isBusy}>
                <Copy className="size-4" />
                Duplicate
              </DropdownMenuItem>
            </FeatureGate>
          ) : null}
          {canDelete ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmingDelete(true)}
              disabled={isBusy}
            >
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <RenameProjectDialog
          organizationId={organizationId}
          project={project}
          onClose={() => setRenaming(false)}
        />
      </Dialog>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{project.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              The project and its timeline are removed for good. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {remove.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: RenameProjectDialog, projectTitleSchema
 *
 * WHAT:  The rename dialog body.
 * WHY:   One field, so it validates against projectTitleSchema directly rather
 *        than standing up a React Hook Form around a single input — the same
 *        shared schema the router uses, just parsed on change. Anything with a
 *        second field goes through RHF, as the create sheet does.
 * WHERE: Mounted inside the <Dialog> above.
 */
function RenameProjectDialog({
  organizationId,
  project,
  onClose,
}: {
  organizationId: string
  project: { id: string; title: string }
  onClose: () => void
}) {
  const utils = trpc.useUtils()
  const rename = trpc.projects.rename.useMutation()
  const [title, setTitle] = React.useState(project.title)
  const [error, setError] = React.useState<string | null>(null)

  const parsed = projectTitleSchema.safeParse(title)
  const validationMessage = parsed.success ? null : (parsed.error.issues[0]?.message ?? null)

  async function handleSave() {
    if (!parsed.success) {
      setError(validationMessage)
      return
    }
    setError(null)
    try {
      await rename.mutateAsync({ organizationId, id: project.id, title: parsed.data })
      await utils.projects.list.invalidate()
      toast.success('Project renamed')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename this project.')
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Rename project</DialogTitle>
        <DialogDescription>Only the title changes. The timeline is untouched.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="project-title">Title</Label>
        <Input
          id="project-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />
        {error !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={rename.isPending}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={rename.isPending || !parsed.success || title === project.title}
        >
          {rename.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
