"use client";

import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminModelConfig, ModelConfigInput } from "@/lib/config";
import {
  useAdminModelConfigs,
  useCreateModelConfig,
  useDeleteModelConfig,
  useUpdateModelConfig,
} from "@/lib/queries/modelConfigs";
import { ModelConfigDialog } from "./ModelConfigDialog";

export function ModelsPanel() {
  const { data: models = [] } = useAdminModelConfigs();
  const createMut = useCreateModelConfig();
  const updateMut = useUpdateModelConfig();
  const deleteMut = useDeleteModelConfig();

  const [editing, setEditing] = useState<AdminModelConfig | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminModelConfig | null>(null);
  const [deleteError, setDeleteError] = useState("");

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteError("");
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : `Failed to delete`,
      );
    }
  }

  async function save(input: ModelConfigInput, id?: string) {
    if (id) {
      await updateMut.mutateAsync({ id, input });
    } else {
      await createMut.mutateAsync(input);
    }
    setEditing(null);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">Models</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            OpenAI-compatible endpoints available to everyone.
          </p>
        </div>
        {models.length > 0 && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> Add
          </Button>
        )}
      </header>

      {models.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">No models configured yet.</p>
          <Button className="mt-4" size="sm" onClick={() => setEditing("new")}>
            <Plus /> Add your first model
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {models.map((m) => (
            <li key={m.id} className="group relative">
              <button
                type="button"
                onClick={() => setEditing(m)}
                aria-label={`Edit ${m.label}`}
                className="flex w-full items-center rounded-lg border bg-card px-3.5 py-3 pr-12 text-left transition-colors hover:border-ring/40 hover:bg-accent/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {m.label}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    <span className="truncate">{m.model}</span>
                    <span aria-hidden="true" className="text-muted-foreground/50">·</span>
                    <span className="truncate">{hostnameOf(m.baseUrl)}</span>
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleteError("");
                  setPendingDelete(m);
                }}
                aria-label={`Delete ${m.label}`}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 group-hover:opacity-100"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ModelConfigDialog
        mode={editing}
        onClose={() => setEditing(null)}
        onSave={save}
      />

      <AlertDialog.Root
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next && !deleteMut.isPending) {
            setPendingDelete(null);
            setDeleteError("");
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity" />
          <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg outline-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity">
            <AlertDialog.Title className="font-heading text-base font-semibold tracking-tight">
              Delete model?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {pendingDelete?.label}
              </span>{" "}
              will be removed from the picker. Existing chats that used it keep
              their messages.
            </AlertDialog.Description>
            {deleteError && (
              <p className="mt-3 text-xs text-destructive">{deleteError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={deleteMut.isPending}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMut.isPending}
                onClick={confirmDelete}
              >
                {deleteMut.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
