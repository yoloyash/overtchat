"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import { ChevronUp, LogOut, Settings, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { useSidebar } from "@/components/sidebar-context";

export function AccountMenu() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  // Portal the menu into the drawer's Dialog.Popup on mobile so the Dialog's
  // dismiss logic recognizes menu-item taps as "inside" events. On desktop
  // the drawer isn't mounted, ref.current is null, and base-ui falls back to
  // portaling into <body>. See sidebar-context.tsx for the full explanation.
  const { drawerRef } = useSidebar();

  async function logOut() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start gap-2 px-2 py-2 text-sidebar-foreground hover:bg-sidebar-accent"
          />
        }
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <User className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col text-left">
          {isPending || !session ? (
            <span className="text-sm font-medium text-muted-foreground">
              Loading…
            </span>
          ) : (
            <>
              <span className="truncate text-sm font-medium leading-tight">
                {session.user.name}
              </span>
              <span className="truncate text-xs leading-tight text-muted-foreground">
                {session.user.email}
              </span>
            </>
          )}
        </span>
        <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal container={drawerRef}>
        <Menu.Positioner side="top" align="start" sideOffset={6}>
          <Menu.Popup className="z-50 w-56 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none">
            <Menu.Item
              render={<Link href="/settings" />}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <Settings className="size-3.5 shrink-0 text-muted-foreground" />
              <span>Settings</span>
            </Menu.Item>
            <Menu.Item
              onClick={logOut}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <LogOut className="size-3.5 shrink-0 text-muted-foreground" />
              <span>Log out</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
