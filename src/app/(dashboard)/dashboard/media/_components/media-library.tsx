/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: MediaLibrary, MediaUpload, UsageMeter, MediaTable,
 *   PER_FILE_CAP_FROM_THE_PLAN, INVALIDATE_LIST_AND_USAGE
 *
 * WHAT:  The media screen's body: the storage meter, the upload panel, and the
 *        table.
 * WHY:   A thin composition on purpose — all three pieces are reusable and own
 *        their own state, so this file's whole job is to pass the active
 *        organization down and to say what happens after an upload.
 *
 *        PER_FILE_CAP_FROM_THE_PLAN: the per-file cap is resolved from the
 *        workspace's own plan (billing.getSubscription → tier) rather than
 *        hardcoded, so the drop zone's refusal message quotes the number the
 *        server will actually enforce. Until the plan resolves it falls back to
 *        the FREE cap — the conservative direction, because the server rejects
 *        anything above the real cap anyway and the alternative (assume the
 *        most generous plan) would promise an upload that then fails.
 *
 *        INVALIDATE_LIST_AND_USAGE: an upload both adds a row and spends
 *        storage, so both queries are refetched. The meter on this page and the
 *        drop zone's own at-limit state read the usage one.
 * WHERE: Rendered by /dashboard/media.
 */

import * as React from "react";

import { trpc } from "@/trpc/react-provider";
import {
  useActiveOrganization,
  useActiveOrganizationId,
} from "@/hooks/use-active-organization";
import { permissions } from "@/lib/permissions";
import { UPLOAD_BYTES_PER_PLAN, maxUploadBytesForPlan } from "@/lib/types";
import { MediaUpload } from "@/components/global/media-upload";
import { UsageMeter } from "@/components/global/usage-meter";
import { Card, CardContent } from "@/components/ui/card";
import { MediaTable } from "./media-table";

export function MediaLibrary() {
  const utils = trpc.useUtils();
  const organizationId = useActiveOrganizationId();
  const { hasPermission } = useActiveOrganization();

  const subscription = trpc.billing.getSubscription.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: organizationId !== undefined },
  );

  /* PER_FILE_CAP_FROM_THE_PLAN — see the file header. */
  const maxBytes =
    subscription.data?.tier === undefined
      ? UPLOAD_BYTES_PER_PLAN.free
      : maxUploadBytesForPlan(subscription.data.tier);

  const canUpload = hasPermission(permissions.ASSETS_CREATE);

  const handleUploaded = React.useCallback(() => {
    /* INVALIDATE_LIST_AND_USAGE. Not awaited: the upload hook is already moving
     * on to the next file, and blocking its loop on a refetch would stall the
     * queue behind a network round trip. */
    void utils.assets.list.invalidate();
    void utils.usage.invalidate();
  }, [utils]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="py-4">
          {/* The resource is named once, here; everything the meter renders —
              the label, the cap, the upgrade sentence — comes from the
              registry. */}
          <UsageMeter resource="storage" />
        </CardContent>
      </Card>

      {organizationId !== undefined && canUpload ? (
        <MediaUpload
          organizationId={organizationId}
          maxBytes={maxBytes}
          onUploaded={handleUploaded}
        />
      ) : null}

      <MediaTable organizationId={organizationId} />
    </div>
  );
}
