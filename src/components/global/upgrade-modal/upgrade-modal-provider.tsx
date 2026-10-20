/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: UpgradeModalProvider, useUpgradeModal,
 *   UpgradeModalRequest, UpgradeErrorObserver, UPGRADE_COPY_FROM_REGISTRY,
 *   GLOBAL_UPGRADE_SURFACE
 *
 * WHAT:  Mounts ONE upgrade modal for the entire app and gives every component
 *        a way to open it — either explicitly, or automatically whenever the
 *        server refuses a call because the plan doesn't cover it.
 * WHY:   GLOBAL_UPGRADE_SURFACE. Rendering the modal per feature meant every new
 *        gated surface had to remember to build its own upgrade path, and the
 *        ones that forgot showed a red toast with a server error in it. One
 *        instance at the root inverts that: hitting a wall ANYWHERE — a gated
 *        button, a mutation that lost a race, a page a plan no longer includes —
 *        lands on the same screen, and a new feature gets it for free.
 *        The observer is the reason this cannot be done with a hook alone. The
 *        server is the only authority on entitlement, so the trustworthy signal
 *        is the structured error it returns, not a client-side prediction. It
 *        watches both caches, exactly like AuthRedirectObserver does for
 *        UNAUTHORIZED — same shape, same reasoning: the SERVER decides, the
 *        client listens.
 *        UPGRADE_COPY_FROM_REGISTRY: the error carries the resource's own
 *        upgrade sentence, already interpolated against the org's plan, so the
 *        modal opens saying what the user actually hit.
 *        Renders nothing until an organization is resolved — there is no plan to
 *        upgrade on the auth or onboarding routes, and a modal that cannot name
 *        a workspace has nothing to sell.
 * WHERE: Wrapped around the app inside TRPCReactProvider in src/app/layout.tsx.
 *        Consumed by <FeatureGate /> and by anything calling useUpgradeModal().
 */

import * as React from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";

import { ERROR_CODES } from "@/lib/errors";
import { isResourceKey, type ResourceKey } from "@/lib/resources";
import type { PlanKey } from "@/lib/config";
import { useActiveOrganizationId } from "@/hooks/use-active-organization";
import { UpgradeModal } from "./upgrade-modal";

/**
 * SOURCE OF TRUTH KEYWORDS: UpgradeModalRequest
 *
 * What opened the modal. Both fields are optional so a plain "show me the plans"
 * call (a Change Plan button) is the same API as a gate refusal.
 */
export interface UpgradeModalRequest {
  resource?: ResourceKey | undefined;
  /** Registry copy for the resource; falls back to the generic header. */
  upgradeMessage?: string | undefined;
  /**
   * Plan to open on. Set by a caller whose own label already named one — the
   * sidebar's "Upgrade to Pro" button must land on Pro, not on whatever the
   * modal would have guessed. Omitted, the modal picks the sensible next step.
   */
  plan?: PlanKey | undefined;
}

interface UpgradeModalContextValue {
  open: (request?: UpgradeModalRequest) => void;
  close: () => void;
  isOpen: boolean;
}

const UpgradeModalContext =
  React.createContext<UpgradeModalContextValue | null>(null);

/**
 * SOURCE OF TRUTH KEYWORDS: useUpgradeModal
 *
 * WHAT:  Opens the app-wide upgrade modal.
 * WHY:   Throws when used outside the provider rather than silently no-opping —
 *        a button that looks like it upgrades and does nothing is worse than a
 *        crash in development.
 * WHERE: <FeatureGate />, the billing settings tab, and any surface that needs a
 *        "see the plans" affordance.
 */
export function useUpgradeModal(): UpgradeModalContextValue {
  const context = React.useContext(UpgradeModalContext);
  if (!context) {
    throw new Error(
      "useUpgradeModal must be used inside <UpgradeModalProvider>",
    );
  }
  return context;
}

export function UpgradeModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const organizationId = useActiveOrganizationId();
  const queryClient = useQueryClient();
  const [request, setRequest] = React.useState<UpgradeModalRequest | null>(
    null,
  );

  const value = React.useMemo<UpgradeModalContextValue>(
    () => ({
      open: (next?: UpgradeModalRequest) => setRequest(next ?? {}),
      close: () => setRequest(null),
      isOpen: request !== null,
    }),
    [request],
  );

  /* Ref so the cache subscription can check "already open" without
   * re-subscribing every time the modal's state changes. */
  const isOpenRef = React.useRef(false);
  React.useEffect(() => {
    isOpenRef.current = request !== null;
  }, [request]);

  React.useEffect(() => {
    const handleError = (error: unknown) => {
      const upgrade = readUpgradeCause(error);
      if (!upgrade) return;
      /* A batch can fail several calls at once; the first refusal is the one
       * the user acted on, and re-opening would reset the step they're on. */
      if (isOpenRef.current) return;
      setRequest(upgrade);
    };

    return subscribeToErrors(queryClient, handleError);
  }, [queryClient]);

  return (
    <UpgradeModalContext.Provider value={value}>
      {children}
      {organizationId && request ? (
        <UpgradeModal
          open
          onOpenChange={(open) => {
            if (!open) setRequest(null);
          }}
          organizationId={organizationId}
          resource={request.resource}
          upgradeMessage={request.upgradeMessage}
          plan={request.plan}
        />
      ) : null}
    </UpgradeModalContext.Provider>
  );
}

/**
 * SOURCE OF TRUTH KEYWORDS: subscribeToErrors, UpgradeErrorObserver
 *
 * Watches BOTH caches: a limit is usually hit on a mutation, but a flag-gated
 * page fails on its query, and only covering one of them would leave half the
 * gates showing a raw error instead of the modal.
 */
function subscribeToErrors(
  queryClient: QueryClient,
  handleError: (error: unknown) => void,
): () => void {
  const queryUnsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    if (event.query.state.status !== "error") return;
    handleError(event.query.state.error);
  });

  const mutationUnsubscribe = queryClient
    .getMutationCache()
    .subscribe((event) => {
      if (event.type !== "updated" || !event.mutation) return;
      if (event.mutation.state.status !== "error") return;
      handleError(event.mutation.state.error);
    });

  return () => {
    queryUnsubscribe();
    mutationUnsubscribe();
  };
}

/**
 * SOURCE OF TRUTH KEYWORDS: readUpgradeCause, StructuredErrorCause,
 *   USAGE_LIMIT_REACHED, FEATURE_NOT_AVAILABLE
 *
 * WHAT:  Pulls the upgrade payload off a tRPC error, or null if it isn't one.
 * WHY:   `error.data.cause` crosses the wire as JSON, so it is genuinely
 *        unknown-shaped at this boundary and every field is checked before use —
 *        a malformed cause must not open a modal with `undefined` in the copy.
 *        The resource is validated against the registry for the same reason: it
 *        is used to highlight a table row, and a key that no longer exists would
 *        silently highlight nothing.
 * WHERE: The observer above.
 */
function readUpgradeCause(error: unknown): UpgradeModalRequest | null {
  if (!(error instanceof TRPCClientError)) return null;

  const data: unknown = error.data;
  if (data === null || typeof data !== "object") return null;

  const cause: unknown = (data as { cause?: unknown }).cause;
  if (cause === null || typeof cause !== "object") return null;

  const errorCode = (cause as { errorCode?: unknown }).errorCode;
  if (
    errorCode !== ERROR_CODES.USAGE_LIMIT_REACHED &&
    errorCode !== ERROR_CODES.FEATURE_NOT_AVAILABLE
  ) {
    return null;
  }

  const rawResource = (cause as { resource?: unknown }).resource;
  const rawMessage = (cause as { upgradeMessage?: unknown }).upgradeMessage;

  return {
    resource:
      typeof rawResource === "string" && isResourceKey(rawResource)
        ? rawResource
        : undefined,
    upgradeMessage:
      typeof rawMessage === "string" && rawMessage.length > 0
        ? rawMessage
        : undefined,
  };
}
