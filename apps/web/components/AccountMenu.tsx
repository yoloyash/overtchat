"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  ChevronUp,
  CircleArrowUp,
  ExternalLink,
  FileText,
  LogOut,
  ServerCog,
  Settings,
  ShieldCheck,
  User,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth/client";
import { getErrorMessage } from "@/lib/errors";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { useAppUpdate } from "@/lib/queries/appUpdate";
import { useSidebar } from "@/components/sidebar-context";

export function AccountMenu() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: session, isPending } = authClient.useSession();
  const isAdmin = session?.user.role === "admin";
  const { data: update } = useAppUpdate(menuOpen && isAdmin);
  const availableVersion = update?.updateAvailable
    ? update.latestVersion
    : null;
  const updateAvailable = availableVersion !== null;
  // Portal the menu into the drawer's Dialog.Popup on mobile so the Dialog's
  // dismiss logic recognizes menu-item taps as "inside" events. On desktop
  // the drawer isn't mounted, ref.current is null, and base-ui falls back to
  // portaling into <body>. See sidebar-context.tsx for the full explanation.
  const { closeMobile, drawerRef } = useSidebar();

  async function logOut() {
    try {
      const { error } = await authClient.signOut();
      if (error) {
        toast.error({
          title: "Failed to log out",
          description: getErrorMessage(error, "Try again in a moment."),
        });
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch (err) {
      toast.error({
        title: "Failed to log out",
        description: getErrorMessage(err, "Try again in a moment."),
      });
    }
  }

  return (
    <Menu.Root onOpenChange={setMenuOpen}>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-sidebar-foreground hover:bg-sidebar-accent"
          />
        }
      >
        {isPending || !session ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <User className="size-3.5" />
          </span>
        ) : (
          <ProfileAvatar
            id={session.user.id}
            name={session.user.name}
            image={session.user.image ?? null}
            size="sm"
          />
        )}
        <span className="min-w-0 flex-1 text-left">
          {isPending || !session ? (
            <span className="block truncate text-sm font-medium text-muted-foreground">
              Loading…
            </span>
          ) : (
            <span className="block truncate text-sm font-medium">
              {session.user.name}
            </span>
          )}
        </span>
        <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal container={drawerRef}>
        <Menu.Positioner side="top" align="start" sideOffset={6}>
          <Menu.Popup
            className={cn(
              "z-50 w-56 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            <div className="flex min-w-0 items-center gap-2 px-2 py-2">
              {isPending || !session ? (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <User className="size-3.5" />
                </span>
              ) : (
                <ProfileAvatar
                  id={session.user.id}
                  name={session.user.name}
                  image={session.user.image ?? null}
                  size="sm"
                />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium leading-tight">
                  {session?.user.name ?? "Loading…"}
                </span>
                {session && (
                  <span className="truncate text-xs leading-tight text-muted-foreground">
                    {session.user.email}
                  </span>
                )}
              </span>
            </div>
            <Menu.Separator className="mx-1 my-1 h-px bg-border" />
            <Menu.Item
              render={
                <Link href="/settings/profile" onClick={closeMobile} />
              }
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
              <span>Profile</span>
            </Menu.Item>
            <Menu.Item
              render={
                <Link href="/settings/general" onClick={closeMobile} />
              }
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <Settings className="size-3.5 shrink-0 text-muted-foreground" />
              <span>Settings</span>
            </Menu.Item>
            {isAdmin && (
              <Menu.Item
                render={
                  <Link href="/settings/models" onClick={closeMobile} />
                }
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <ServerCog className="size-3.5 shrink-0 text-muted-foreground" />
                <span>Administration</span>
              </Menu.Item>
            )}
            <Menu.Separator className="mx-1 my-1 h-px bg-border" />
            <Menu.Item
              render={
                <a
                  href="https://overtchat.com/releases/"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={closeMobile}
                />
              }
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              {updateAvailable ? (
                <CircleArrowUp className="size-3.5 shrink-0 text-ring" />
              ) : (
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className={cn("flex-1", updateAvailable && "font-medium")}>
                {updateAvailable ? "Update available" : "Release notes"}
              </span>
              {updateAvailable ? (
                <span className="text-xs font-medium text-ring">
                  v{availableVersion}
                </span>
              ) : (
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
              )}
            </Menu.Item>
            <Menu.Item
              render={
                <a
                  href="https://overtchat.com/privacy/"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={closeMobile}
                />
              }
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1">Privacy</span>
              <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
            </Menu.Item>
            <Menu.Separator className="mx-1 my-1 h-px bg-border" />
            <Menu.Item
              onClick={logOut}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <LogOut className="size-3.5 shrink-0 text-muted-foreground" />
              <span>Log out</span>
            </Menu.Item>
            <div className="px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">
              OvertChat v{APP_VERSION}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
