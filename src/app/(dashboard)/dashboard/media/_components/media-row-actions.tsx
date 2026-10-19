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
 * SOURCE OF TRUTH KEYWORDS: MediaRowActions, RenameAssetDialog, assets.update,
 *   assets.delete, PERMISSION_PER_ITEM, DESTRUCTIVE_CONFIRM,
 *   LIBRARY_ROWS_HAVE_NO_ACTIONS, STORAGE_REFETCH_AFTER_DELETE
 *
 * WHAT:  The per-row menu: rename and delete.
 * WHY:   PERMISSION_PER_ITEM, as on the projects list — each entry is hidden
 *        without its own grant, because `assets:update` and `assets:delete` are
 *        separate permissions a custom role may hold one of.
 *
 *        LIBRARY_ROWS_HAVE_NO_ACTIONS: a row with `organizationId === null` is
 *        shared library media, and neither renaming nor deleting it is this
 *        tenant's to do — the server refuses both (LIBRARY_IS_READ_ONLY in the
 *        router), so the menu is not rendered at all rather than offering
 *        actions that will fail.
 *
 *        STORAGE_REFETCH_AFTER_DELETE: a delete returns bytes to the quota, so
 *        the usage queries are invalidated alongside the list — the storage
 *        meter on this very page and the upload zone's at-limit state both read
 *        them, and without this the bar would stay full until a reload.
 * WHERE: Passed to <DataTable rowActions> by MediaTable.
 */

import * as React from 'react'
import { Loader2Icon, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import { assetFilenameSchema } from '@/lib/types'
import { formatBytes } from '@/lib/resources'
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

export interface MediaRowActionsProps {
  organizationId: string
  asset: {
    id: string
    filename: string
    bytes: number
    organizationId: string | null
  }
}

export function MediaRowActions({ organizationId, asset }: MediaRowActionsProps) {
  const utils = trpc.useUtils()
  const { hasPermission } = useActiveOrganization()
  const [renaming, setRenaming] = React.useState(false)
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)

  const remove = trpc.assets.delete.useMutation()

  const canUpdate = hasPermission(permissions.ASSETS_UPDATE)
  const canDelete = hasPermission(permissions.ASSETS_DELETE)

  /* LIBRARY_ROWS_HAVE_NO_ACTIONS — see the file header. */
  if (asset.organizationId === null) return null
  if (!canUpdate && !canDelete) return null

  async function handleDelete() {
    try {
      await remove.mutateAsync({ organizationId, id: asset.id })
      /* STORAGE_REFETCH_AFTER_DELETE — the list AND the quota. */
      await Promise.all([utils.assets.list.invalidate(), utils.usage.invalidate()])
      setConfirmingDelete(false)
      toast.success(`"${asset.filename}" deleted · ${formatBytes(asset.bytes)} freed`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete this file.')
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label={`Actions for ${asset.filename}`}>
              {remove.isPending ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <MoreHorizontal className="size-4" />
              )}
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {canUpdate ? (
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil className="size-4" />
              Rename
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmingDelete(true)}
              disabled={remove.isPending}
            >
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <RenameAssetDialog
          organizationId={organizationId}
          asset={asset}
          onClose={() => setRenaming(false)}
        />
      </Dialog>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{asset.filename}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              {/* Said plainly because it is true and surprising: the derived
                  versions go too, and any video already using this file will
                  lose it. There is no recycle bin. */}
              The file and every version made from it are removed for good, and{' '}
              {formatBytes(asset.bytes)} is returned to your storage. Projects using this
              file will no longer be able to render it. This cannot be undone.
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
              Delete file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: RenameAssetDialog, assetFilenameSchema
 *
 * WHAT:  The rename dialog body.
 * WHY:   One field, so it validates against the shared assetFilenameSchema
 *        directly rather than standing up React Hook Form around a single
 *        input — the same decision, for the same reason, as
 *        RenameProjectDialog. The schema is the router's own, so the dialog
 *        cannot accept a name the server will refuse.
 * WHERE: Mounted inside the <Dialog> above.
 */
function RenameAssetDialog({
  organizationId,
  asset,
  onClose,
}: {
  organizationId: string
  asset: { id: string; filename: string }
  onClose: () => void
}) {
  const utils = trpc.useUtils()
  const rename = trpc.assets.update.useMutation()
  const [filename, setFilename] = React.useState(asset.filename)
  const [error, setError] = React.useState<string | null>(null)

  const parsed = assetFilenameSchema.safeParse(filename)
  const validationMessage = parsed.success ? null : (parsed.error.issues[0]?.message ?? null)

  async function handleSave() {
    if (!parsed.success) {
      setError(validationMessage)
      return
    }
    setError(null)
    try {
      await rename.mutateAsync({ organizationId, id: asset.id, filename: parsed.data })
      await utils.assets.list.invalidate()
      toast.success('File renamed')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename this file.')
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Rename file</DialogTitle>
        <DialogDescription>
          Only the name you see changes. The file itself is untouched.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="asset-filename">Name</Label>
        <Input
          id="asset-filename"
          value={filename}
          onChange={(event) => setFilename(event.target.value)}
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
          disabled={rename.isPending || !parsed.success || filename === asset.filename}
        >
          {rename.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
