"use client";

import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { useInvalidateUsers, useUsers } from "@/lib/queries/users";
import type { UserRow } from "@/lib/queries/users";
import {
  SettingsNotice,
  SettingsPageHeader,
  SettingsSection,
} from "../_components/SettingsRows";
import { AddUserDialog } from "./AddUserDialog";

export function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const { data: users = [] } = useUsers();
  const invalidateUsers = useInvalidateUsers();
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<UserRow | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!pendingDelete || pendingDelete.id === currentUserId) return;
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
                <td className="px-3 py-3 text-muted-foreground">
                  {formatRole(u.role)}
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
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next && !deleting) {
            setPendingDelete(null);
            setDeleteError("");
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
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
