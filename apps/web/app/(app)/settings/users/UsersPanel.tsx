"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { useInvalidateUsers, useUsers } from "@/lib/queries/users";
import { AddUserDialog } from "./AddUserDialog";

export function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const { data: users = [] } = useUsers();
  const invalidateUsers = useInvalidateUsers();
  const [addOpen, setAddOpen] = useState(false);

  async function removeUser(id: string) {
    if (id === currentUserId) return;
    if (!confirm("Delete this user? This cannot be undone.")) return;
    const { error } = await authClient.admin.removeUser({ userId: id });
    if (error) {
      alert(error.message ?? "Failed to delete user");
      return;
    }
    invalidateUsers();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage who can sign in.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus /> Add user
        </Button>
      </header>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Email</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Created</th>
              <th className="w-10 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {u.role ?? "user"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-right">
                  {u.id !== currentUserId && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeUser(u.id)}
                      aria-label={`Delete ${u.email}`}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={invalidateUsers}
      />
    </div>
  );
}
