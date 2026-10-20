/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: OrganizationTab
 *
 * WHAT:  Org settings form — rename the organization and set a logo URL.
 * WHY:   RHF + the shared updateOrganizationSettingsSchema; reads current
 *        values from organizationSettings.get and writes via .update, then
 *        invalidates so the sidebar/switcher reflect the new name.
 * WHERE: Rendered by settings/organization page.
 */

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";

import { trpc } from "@/trpc/react-provider";
import {
  useActiveOrganizationId,
  useActiveOrganization,
} from "@/hooks/use-active-organization";
import {
  updateOrganizationSettingsSchema,
  type UpdateOrganizationSettingsValues,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSection } from "@/components/global/settings-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ROUTES } from "@/lib/config";

export function OrganizationTab() {
  const organizationId = useActiveOrganizationId();
  /* Provider-neutral: `isOwner` comes from the adapter's hasFullAccess, never a
   * role string — see docs/09. Decides delete-vs-leave below. */
  const { isOwner } = useActiveOrganization();
  const utils = trpc.useUtils();
  const enabled = organizationId !== undefined;
  const orgId = organizationId ?? "";

  const settingsQuery = trpc.organizationSettings.get.useQuery(
    { organizationId: orgId },
    { enabled },
  );
  const update = trpc.organizationSettings.update.useMutation();
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const form = useForm<UpdateOrganizationSettingsValues>({
    resolver: zodResolver(updateOrganizationSettingsSchema),
    defaultValues: { organizationId: orgId, name: "", logo: "" },
  });

  /* Seed the form once the current settings load. */
  const settings = settingsQuery.data;
  React.useEffect(() => {
    if (settings) {
      form.reset({
        organizationId: settings.id,
        name: settings.name,
        logo: settings.logo ?? "",
      });
    }
  }, [settings, form]);

  async function onSubmit(values: UpdateOrganizationSettingsValues) {
    setError(null);
    setSaved(false);
    try {
      await update.mutateAsync(values);
      await Promise.all([
        utils.organizationSettings.get.invalidate({ organizationId: orgId }),
        utils.organization.getUserOrganizations.invalidate(),
        utils.organization.getActiveOrganization.invalidate(),
      ]);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    }
  }

  if (!organizationId) return null;

  return (
    <div className="space-y-10">
      <SettingsSection
        title="Organization"
        description="Your workspace name and logo, shown across the app"
        label="Profile"
        labelDescription="Everyone in this organization sees these"
      >
        {settingsQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex max-w-md flex-col gap-4"
              noValidate
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="logo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Logo URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://…"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      Optional. Leave blank to remove.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              {saved ? (
                <p className="text-sm text-muted-foreground">Saved.</p>
              ) : null}
              <Button
                type="submit"
                className="w-fit"
                disabled={update.isPending}
              >
                {update.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : null}
                Save changes
              </Button>
            </form>
          </Form>
        )}
      </SettingsSection>

      <OrganizationDangerZone organizationId={orgId} isOwner={isOwner} />
    </div>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: OrganizationDangerZone
 *
 * WHAT:  Leave / delete organization, in the app's settings layout.
 * WHY:   Both actions are adapter-backed (organizationSettings.delete /
 *        .leave), so this one section works under every provider rather than
 *        being buried in a provider-hosted "manage organization" modal the
 *        app's navigation never points at.
 *        Owners see DELETE and non-owners see LEAVE, never both: an owner
 *        leaving would orphan the tenant, and ownership transfer is not
 *        available under every provider.
 * WHERE: Rendered at the bottom of OrganizationTab.
 */
function OrganizationDangerZone({
  organizationId,
  isOwner,
}: {
  organizationId: string;
  isOwner: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const remove = trpc.organizationSettings.delete.useMutation();
  const leave = trpc.organizationSettings.leave.useMutation();
  const isPending = remove.isPending || leave.isPending;

  async function confirm() {
    setError(null);
    try {
      if (isOwner) await remove.mutateAsync({ organizationId });
      else await leave.mutateAsync({ organizationId });
      /* Full reload: the active organization is gone, so every server-resolved
       * query must re-resolve against whatever membership remains. */
      window.location.assign(ROUTES.dashboard);
    } catch (err) {
      setConfirmOpen(false);
      setError(
        err instanceof Error ? err.message : "Could not complete that action.",
      );
    }
  }

  return (
    <SettingsSection
      title="Danger zone"
      description="These actions cannot be undone"
      label={isOwner ? "Delete organization" : "Leave organization"}
      labelDescription={
        isOwner
          ? "Permanently removes this organization, its members, roles, usage and audit history"
          : "You lose access to this organization immediately"
      }
    >
      <div className="space-y-3">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button
          variant="destructive"
          className="w-fit"
          disabled={isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {isOwner ? "Delete organization" : "Leave organization"}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isOwner
                ? "Delete this organization?"
                : "Leave this organization?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isOwner
                ? "Every member, role, usage counter and audit record for this organization is removed. This cannot be undone."
                : "You will need a new invitation to rejoin."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>
              {isOwner ? "Delete" : "Leave"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
