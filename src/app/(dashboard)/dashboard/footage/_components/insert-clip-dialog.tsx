/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: InsertClipDialog, INSERT_IS_APPLY_BACKGROUND,
 *   APPLIES_TO_THE_NEXT_GENERATION, THE_BOUNDARY_IS_THE_ROUTER,
 *   ONE_WRITE_NOT_A_NEW_ONE, THEME_TOKENS_ONLY
 *
 * WHAT:  The "use this clip in a project" step: pick a project, and the clip
 *        becomes that project's background.
 *
 * WHY:   INSERT_IS_APPLY_BACKGROUND, and that is the whole design decision
 *        here. The phase's step 6 asks for "insert into project", and the
 *        temptation is a new mutation that writes the clip somewhere. There is
 *        already exactly one way a piece of footage becomes a project's
 *        footage — `backgroundLibrary.applyBackground`, which writes
 *        `backgroundAssetId` into the project's generate settings and is the
 *        boundary the background picker uses. `ai_footage` has been in
 *        `BACKGROUND_ASSET_KINDS` since Phase 11, so a generated clip is
 *        already a legal background and needs no new path.
 *
 *        ONE_WRITE_NOT_A_NEW_ONE therefore: this component adds a project
 *        PICKER and nothing else. A second mutation doing the same write would
 *        be a second place the plan check, the usability check and the audit
 *        line could drift from the picker's — and the two would look correct
 *        in isolation, which is the drift this codebase is organised against.
 *
 *        THE_BOUNDARY_IS_THE_ROUTER. Every refusal — the clip is no longer
 *        usable, the project is not this workspace's, the asset is not
 *        footage — is decided server-side and shown as written. Nothing is
 *        pre-validated here beyond having a project selected, because a client
 *        check would be advisory at best and a second rule at worst.
 *
 *        APPLIES_TO_THE_NEXT_GENERATION, said out loud in the success toast.
 *        Choosing a background does not rewrite an existing timeline — the
 *        router returns `appliesToNextGeneration` precisely so the UI can say
 *        so, and a customer who expected their current preview to change would
 *        otherwise read a working write as a broken one.
 *
 *        THEME_TOKENS_ONLY, and the dialog is `_components` rather than global
 *        because it exists only on this route. If a second surface ever needs
 *        "apply this asset to a project I pick", this is what gets promoted.
 * WHERE: The footage studio's per-clip "Use in project" action.
 */

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/trpc/react-provider";

export function InsertClipDialog({
  organizationId,
  assetId,
  prompt,
  onClose,
}: {
  organizationId: string;
  assetId: string;
  /** Shown so somebody with several clips open knows which one this is. */
  prompt: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [projectId, setProjectId] = React.useState<string | null>(null);

  /* The first page, newest-updated first, which is where the project somebody
   * is working on will be. A workspace with more projects than that reaches
   * them through the picker on the project itself — a searchable project
   * chooser in a dialog on the footage screen would be a second project list
   * to maintain for a case the background picker already serves. */
  const projects = trpc.projects.list.useQuery({ organizationId });

  const apply = trpc.backgroundLibrary.applyBackground.useMutation({
    onSuccess: (result) => {
      /* The picker on the project reads the same setting, so its cache is
       * stale the moment this succeeds. */
      void utils.backgroundLibrary.invalidate();
      void utils.projects.invalidate();

      toast.success(
        result.appliesToNextGeneration
          ? "Set as the project's background. It is used the next time the project is generated."
          : "Set as the project's background.",
      );
      onClose();
    },
    /* THE_BOUNDARY_IS_THE_ROUTER — its sentence, as written. */
    onError: (error) => toast.error(error.message),
  });

  const items = projects.data?.items ?? [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use this clip in a project</DialogTitle>
          <DialogDescription>
            It becomes the project&apos;s background. You can change it again
            from the project at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground line-clamp-2 text-sm">{prompt}</p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="insert-clip-project">Project</Label>

            {projects.isPending ? (
              <Skeleton className="h-9 w-full" />
            ) : projects.error !== null ? (
              <p className="text-muted-foreground text-sm">
                {projects.error.message}
              </p>
            ) : items.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No projects yet. Create one and this clip will be available as
                its background.
              </p>
            ) : (
              <Select
                value={projectId ?? undefined}
                onValueChange={setProjectId}
              >
                <SelectTrigger id="insert-clip-project">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={projectId === null || apply.isPending}
            onClick={() => {
              if (projectId === null) return;
              apply.mutate({ organizationId, projectId, assetId });
            }}
          >
            {apply.isPending ? "Setting…" : "Set as background"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
