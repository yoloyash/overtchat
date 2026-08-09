"use client";

import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth/client";
import {
  useInvalidateUsers,
  useSetUserRole,
  useUsers,
} from "@/lib/queries/users";
import type { UserRole, UserRow } from "@/lib/queries/users";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  SettingsNotice,
  SettingsPageHeader,
  SettingsSection,
} from "../_components/SettingsRows";
import { AddUserDialog } from "./AddUserDialog";

type PendingRoleChange = {
  user: UserRow;
  role: UserRole;
};

export function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const { data: users = [] } = useUsers();
  const invalidateUsers = useInvalidateUsers();
  const setRoleMutation = useSetUserRole();
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<UserRow | null>(null);
  const [pendingRoleChange, setPendingRoleChange] =
    useState<PendingRoleChange | null>(null);
  const [roleError, setRoleError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!pendingDelete || pendingDelete.id === currentUserId) return;
    const email = pendingDelete.email;
    setDeleting(true);
    setDeleteError("");
    const { error } = await authClient.admin.removeUser({
      userId: pendingDelete.id,
    });
    if (error) {
      setDeleteError(error.message ?? "Failed to delete user.");
      setDeleting(false);
      return;
    }
    invalidateUsers();
    setPendingDelete(null);
    setDeleting(false);
    toast.success({
      title: "User deleted",
      description: email,
    });
  }

  async function confirmRoleChange() {
    if (!pendingRoleChange) return;
    setRoleError("");
    try {
      await setRoleMutation.mutateAsync({
        userId: pendingRoleChange.user.id,
        role: pendingRoleChange.role,
      });
      toast.success({
        title:
          pendingRoleChange.role === "admin"
            ? "Administrator access granted"
            : "Administrator access removed",
        description: pendingRoleChange.user.email,
      });
      setPendingRoleChange(null);
    } catch (cause) {
      setRoleError(
        cause instanceof Error ? cause.message : "The role could not be changed.",
      );
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <SettingsPageHeader
        title="Users"
        description="Manage who can sign in to this server."
        action={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus /> Add user
          </Button>
        }
      />

      <SettingsSection
        title="People"
        description={`${users.length} user${users.length === 1 ? "" : "s"} configured.`}
        contentClassName="overflow-x-auto divide-y-0"
      >
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="border-b bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">Name</th>
              <th className="px-3 py-2.5 text-left font-medium">Email</th>
              <th className="px-3 py-2.5 text-left font-medium">Role</th>
              <th className="px-3 py-2.5 text-left font-medium">Created</th>
              <th className="px-3 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-3 py-3 font-medium text-foreground">
                  {u.name}
                </td>
                <td className="px-3 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-3 py-3">
                  {u.id === currentUserId ? (
                    <span className="text-muted-foreground">
                      {formatRole(u.role)}
                    </span>
                  ) : (
                    <Select
                      value={normalizeRole(u.role)}
                      disabled={setRoleMutation.isPending}
                      onValueChange={(next) => {
                        const role = next as UserRole;
                        if (role === normalizeRole(u.role)) return;
                        setRoleError("");
                        setPendingRoleChange({ user: u, role });
                      }}
                    >
                      <SelectTrigger
                        aria-label={`Role for ${u.email}`}
                        className="w-28"
                      >
                        <SelectValue>{formatRole(u.role)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-3 text-right">
                  {u.id === currentUserId ? (
                    <span className="text-xs text-muted-foreground">
                      Current user
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleteError("");
                        setPendingDelete(u);
                      }}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 data-icon="inline-start" />
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsSection>

      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={invalidateUsers}
      />

      <AlertDialog.Root
        open={pendingRoleChange !== null}
        onOpenChange={(next) => {
          if (!next && !setRoleMutation.isPending) {
            setPendingRoleChange(null);
            setRoleError("");
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop
            className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              {pendingRoleChange?.role === "admin"
                ? "Grant administrator access?"
                : "Remove administrator access?"}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              {pendingRoleChange?.role === "admin" ? (
                <>
                  <span className="font-medium text-foreground">
                    {pendingRoleChange.user.email}
                  </span>{" "}
                  will be able to manage users, models, and Agent Connections,
                  including running code and opening SSH connections from this
                  server.
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    {pendingRoleChange?.user.email}
                  </span>{" "}
                  will lose administrator features. Their active agent runs
                  will stop.
                </>
              )}{" "}
              They will be signed out on all devices.
            </AlertDialog.Description>
            {roleError && (
              <SettingsNotice tone="error" className="mt-3 text-xs">
                {roleError}
              </SettingsNotice>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={setRoleMutation.isPending}
                  />
                }
              >
                Cancel
              </AlertDialog.Close>
              <Button
                size="sm"
                disabled={setRoleMutation.isPending}
                onClick={() => void confirmRoleChange()}
              >
                {setRoleMutation.isPending
                  ? "Updating…"
                  : pendingRoleChange?.role === "admin"
                    ? "Make admin"
                    : "Make user"}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next && !deleting) {
            setPendingDelete(null);
            setDeleteError("");
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop
            className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              Delete user?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {pendingDelete?.email}
              </span>{" "}
              will no longer be able to sign in. Existing chats and projects are
              not deleted.
            </AlertDialog.Description>
            {deleteError && (
              <SettingsNotice tone="error" className="mt-3 text-xs">
                {deleteError}
              </SettingsNotice>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={
                  <Button variant="ghost" size="sm" disabled={deleting} />
                }
              >
                Cancel
              </AlertDialog.Close>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={confirmDelete}
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

function formatRole(role: string | null | undefined): string {
  if (role === "admin") return "Admin";
  return "User";
}

function normalizeRole(role: string | null | undefined): UserRole {
  return role === "admin" ? "admin" : "user";
}
