"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import type { AdminModelConfig } from "@/lib/config";
import {
  modelIconForModel,
  providerIdentityForBaseUrl,
} from "@/lib/providers/meta";
import {
  useAdminModelConfigs,
  useDeleteModelConfig,
  useUpdateModelConfig,
} from "@/lib/queries/modelConfigs";
import { cn } from "@/lib/utils";
import { HealthBadge } from "./HealthBadge";

export function ModelsPanel() {
  const { data: models = [] } = useAdminModelConfigs();
  const deleteMut = useDeleteModelConfig();
  const updateMut = useUpdateModelConfig();

  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AdminModelConfig | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [actionError, setActionError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => {
      const provider = providerIdentityForBaseUrl(m.baseUrl);
      const host = hostnameOf(m.baseUrl);
      return [
        m.label,
        m.model,
        m.baseUrl,
        host,
        provider.label,
        m.enabled ? "enabled" : "disabled",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [models, query]);

  async function toggleEnabled(m: AdminModelConfig, next: boolean) {
    setTogglingId(m.id);
    setActionError("");
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
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update model");
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
        err instanceof Error ? err.message : "Failed to delete model",
      );
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Models</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the model endpoints available in chat.
          </p>
        </div>
        {models.length > 0 && (
          <Button
            render={<Link href="/settings/models/new" />}
            size="sm"
            className="self-start lg:self-auto"
          >
            <Plus /> Add model
          </Button>
        )}
      </header>

      {models.length > 0 && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models"
              className="pl-8"
              aria-label="Search models"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {models.length} configured
          </p>
        </div>
      )}

      {actionError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {models.length === 0 ? (
        <div className="border-y border-dashed px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">No models configured yet.</p>
          <Button
            render={<Link href="/settings/models/new" />}
            className="mt-4"
            size="sm"
          >
            <Plus /> Add your first model
          </Button>
        </div>
      ) : filteredModels.length === 0 ? (
        <div className="border-y px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No models match <span className="text-foreground">{query.trim()}</span>.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/70 border-y">
          {filteredModels.map((m) => {
            const provider = providerIdentityForBaseUrl(m.baseUrl);
            const host = hostnameOf(m.baseUrl);
            const iconId = modelIconForModel(m.model) ?? provider.iconId;
            return (
              <div
                key={m.id}
                className={cn(
                  "grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center",
                  !m.enabled && "opacity-65",
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30">
                    <ModelBrandIcon iconId={iconId} className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {m.label}
                      </span>
                      <HealthBadge id={m.id} enabled={m.enabled} />
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>{provider.label}</span>
                      <span aria-hidden="true" className="text-muted-foreground/50">
                        /
                      </span>
                      <span className="font-mono">{host}</span>
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {m.model}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 justify-self-start lg:justify-self-end">
                  <div className="flex min-w-16 items-center justify-end gap-2">
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {m.enabled ? "On" : "Off"}
                    </span>
                    <Switch
                      checked={m.enabled}
                      disabled={togglingId === m.id}
                      onCheckedChange={(next) => void toggleEnabled(m, next)}
                      aria-label={`${m.enabled ? "Disable" : "Enable"} ${m.label}`}
                    />
                  </div>
                  <div className="h-6 w-px bg-border" aria-hidden="true" />
                  <div className="flex items-center gap-0.5 rounded-lg border bg-background/80 p-0.5">
                    <Button
                      render={<Link href={`/settings/models/${m.id}`} />}
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${m.label}`}
                      title={`Edit ${m.label}`}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setDeleteError("");
                        setPendingDelete(m);
                      }}
                      aria-label={`Delete ${m.label}`}
                      title={`Delete ${m.label}`}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
          <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg outline-none transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
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
                {deleteMut.isPending ? "Deleting..." : "Delete"}
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
