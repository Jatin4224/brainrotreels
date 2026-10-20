/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: NavUser
 *
 * WHAT:  Sidebar-footer user menu — avatar/name/email with a sign-out action.
 * WHY:   Reads identity from Better Auth's useSession (no dedicated user
 *        router needed); sign-out redirects to the canonical sign-in route so
 *        the auth-flow target stays centralized in AUTH_ROUTES.
 * WHERE: Rendered by AppSidebar. Uses authClient.useSession / authClient.signOut.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ChevronsUpDown,
  LogOut,
  UserIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/better-auth/auth-client";
import { AUTH_ROUTES, PORTAL_PATH } from "@/lib/config";
import { trpc } from "@/trpc/react-provider";
import { SidebarEntrySkeleton } from "../sidebar-skeletons";

function initialsOf(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? `${parts[0]?.[0]}${parts[1]?.[0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

export function NavUser() {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);
  /* Profile is prefetched + hydrated by the dashboard/portal layout, so this
   * resolves from cache on first render (no flicker, no client round-trip). */
  const { data: user } = trpc.user.getProfile.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  /* Surfaces the /portal link only for platform admins (owner email or portal
   * member); resolved server-side so the owner email never reaches the client. */
  const { data: portalAccess } = trpc.portal.getAccess.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  /* Hold the footer row's height instead of collapsing it — returning null
   * here made the sidebar jump once the profile query resolved. */
  if (!user) return <SidebarEntrySkeleton />;

  const name = user.name || user.email;
  const image = user.image ?? undefined;

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    await authClient.signOut();
    window.location.assign(AUTH_ROUTES.signIn);
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
              />
            }
          >
            <Avatar className="size-8 rounded-lg">
              {image ? <AvatarImage src={image} alt={name} /> : null}
              <AvatarFallback className="rounded-lg">
                {initialsOf(user.name, user.email)}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            {/* Plain header (not a Menu.GroupLabel, which base-ui requires to
                sit inside a Menu.Group). */}
            <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
              <Avatar className="size-8 rounded-lg">
                {image ? <AvatarImage src={image} alt={name} /> : null}
                <AvatarFallback className="rounded-lg">
                  {initialsOf(user.name, user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
            </div>
            <DropdownMenuSeparator />
            {portalAccess?.isPortalAdmin ? (
              <DropdownMenuItem onClick={() => router.push(PORTAL_PATH)}>
                <ShieldCheckIcon />
                Platform admin
              </DropdownMenuItem>
            ) : null}
            {/* TYPED_ROUTE_GUARANTEE: /dashboard/settings/profile does not exist —
                it 404'd silently until typedRoutes caught it. This points at the
                settings hub, which redirects to the first settings tab. NOTE
                that tab is gated by ROUTE_AUTHORIZATION, so a member without
                `billing:read` is redirected away; a dedicated profile page is
                the real fix. */}
            <DropdownMenuItem
              onClick={() => router.push("/dashboard/settings")}
            >
              <UserIcon />
              Account
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSignOut} disabled={signingOut}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
