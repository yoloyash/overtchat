"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import {
  Check,
  ChevronUp,
  CircleArrowUp,
  Clipboard,
  ExternalLink,
  FileText,
  LogOut,
  ServerCog,
  Settings,
  ShieldCheck,
  User,
  UserRound,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth/client";
import { getErrorMessage } from "@/lib/errors";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { useAppUpdate } from "@/lib/queries/appUpdate";
import { useSidebar } from "@/components/sidebar-context";

const UPDATE_COMMAND = "overtchat update";

export function AccountMenu() {
  const router = useRouter();
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const { data: session, isPending } = authClient.useSession();
  const isAdmin = session?.user.role === "admin";
  const { data: update, isStale, refetch } = useAppUpdate(isAdmin);
  const availableVersion = update?.updateAvailable
    ? update.latestVersion
    : null;
  const updateAvailable = availableVersion !== null;
  // Portal the menu into the drawer's Dialog.Popup on mobile so the Dialog's
  // dismiss logic recognizes menu-item taps as "inside" events. On desktop
  // the drawer isn't mounted, ref.current is null, and base-ui falls back to
  // portaling into <body>. See sidebar-context.tsx for the full explanation.
  const { closeMobile, drawerRef } = useSidebar();

  function handleOpenChange(open: boolean) {
    if (open && isAdmin && isStale) void refetch();
  }

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
    <Menu.Root onOpenChange={handleOpenChange}>
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
        {updateAvailable && (
          <span
            className="shrink-0 text-ring"
            title={`Update available v${availableVersion}`}
          >
            <CircleArrowUp className="size-4" aria-hidden="true" />
            <span className="sr-only">
              Update available v{availableVersion}
            </span>
          </span>
        )}
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
            {updateAvailable ? (
              <Menu.Item
                onClick={() => {
                  setUpdateDialogOpen(true);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <CircleArrowUp className="size-3.5 shrink-0 text-ring" />
                <span className="flex-1 font-medium">Update available</span>
                <span className="text-xs font-medium text-ring">
                  v{availableVersion}
                </span>
              </Menu.Item>
            ) : (
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
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">Release notes</span>
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
              </Menu.Item>
            )}
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
      {availableVersion && (
        <AppUpdateDialog
          open={updateDialogOpen}
          version={availableVersion}
          onOpenChange={setUpdateDialogOpen}
        />
      )}
    </Menu.Root>
  );
}

function AppUpdateDialog({
  open,
  version,
  onOpenChange,
}: {
  open: boolean;
  version: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) setCopied(false);
    onOpenChange(next);
  }

  async function copyUpdateCommand() {
    try {
      await navigator.clipboard.writeText(UPDATE_COMMAND);
      setCopied(true);
    } catch (error) {
      toast.error({
        title: "Could not copy update command",
        description: getErrorMessage(error, "Copy the command manually."),
      });
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Update available
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            OvertChat v{version} is ready. Run this on the OvertChat host.
          </Dialog.Description>

          <div className="mt-4 flex items-center gap-2">
            <code
              aria-label="OvertChat update command"
              className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted px-3 py-2 text-sm"
            >
              {UPDATE_COMMAND}
            </code>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void copyUpdateCommand()}
              aria-label={
                copied ? "Update command copied" : "Copy update command"
              }
              title={copied ? "Copied" : "Copy update command"}
            >
              {copied ? <Check /> : <Clipboard />}
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            <a
              href="https://overtchat.com/releases/"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              View release notes
              <ExternalLink />
            </a>
            <Dialog.Close render={<Button size="sm" />}>Close</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
