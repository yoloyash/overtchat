"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Switch } from "@base-ui/react/switch";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminModelConfig } from "@/lib/config";
import {
  useAdminModelConfigs,
  useDeleteModelConfig,
  useUpdateModelConfig,
} from "@/lib/queries/modelConfigs";
import { HealthBadge } from "./HealthBadge";

export function ModelsPanel() {
  const { data: models = [] } = useAdminModelConfigs();
  const deleteMut = useDeleteModelConfig();
  const updateMut = useUpdateModelConfig();

  const [pendingDelete, setPendingDelete] = useState<AdminModelConfig | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function toggleEnabled(m: AdminModelConfig, next: boolean) {
    setTogglingId(m.id);
    try {
      await updateMut.mutateAsync({
        id: m.id,
        input: {
          label: m.label,
          baseUrl: m.baseUrl,
          apiKey: m.apiKey,
          model: m.model,
          systemPrompt: m.systemPrompt,
          extraBody: m.extraBody,
          enabled: next,
          sortOrder: m.sortOrder,
        },
      });
    } finally {
      setTogglingId(null);
    }
  }

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

  return (
    <div className="max-w-2xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">Models</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Anthropic, Google Gemini, or OpenAI-compatible endpoints — available to everyone.
          </p>
        </div>
        {models.length > 0 && (
          <Button render={<Link href="/settings/models/new" />} size="sm">
            <Plus /> Add
          </Button>
        )}
      </header>

      {models.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">No models configured yet.</p>
          <Button
            render={<Link href="/settings/models/new" />}
            className="mt-4"
            size="sm"
          >
            <Plus /> Add your first model
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {models.map((m) => (
            <li key={m.id} className="group relative">
              <Link
                href={`/settings/models/${m.id}`}
                aria-label={`Edit ${m.label}`}
                className={`flex w-full items-center rounded-lg border bg-card px-3.5 py-3 pr-28 text-left transition-colors hover:border-ring/40 hover:bg-accent/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 ${m.enabled ? "" : "opacity-60"}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {m.label}
                    </span>
                    <HealthBadge id={m.id} enabled={m.enabled} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    <span className="truncate">{m.model}</span>
                    <span aria-hidden="true" className="text-muted-foreground/50">·</span>
                    <span className="truncate">{hostnameOf(m.baseUrl)}</span>
                  </div>
                </div>
              </Link>
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                <Switch.Root
                  checked={m.enabled}
                  disabled={togglingId === m.id}
                  onCheckedChange={(next) => toggleEnabled(m, next)}
                  aria-label={`${m.enabled ? "Disable" : "Enable"} ${m.label}`}
                  className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-input bg-input/40 transition-colors data-[checked]:border-ring/40 data-[checked]:bg-ring/70 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <Switch.Thumb className="pointer-events-none ml-0.5 size-4 rounded-full bg-background shadow transition-transform data-[checked]:translate-x-4" />
                </Switch.Root>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError("");
                    setPendingDelete(m);
                  }}
                  aria-label={`Delete ${m.label}`}
                  className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

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
