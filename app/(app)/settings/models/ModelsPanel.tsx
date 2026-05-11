"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminModelConfig, ModelConfigInput } from "@/lib/config";
import { ModelConfigDialog } from "./ModelConfigDialog";

export function ModelsPanel({ initial }: { initial: AdminModelConfig[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminModelConfig | "new" | null>(null);

  async function remove(id: string, label: string) {
    if (!confirm(`Delete "${label}"?`)) return;
    const res = await fetch(`/api/model-configs/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert(`Failed to delete (${res.status})`);
      return;
    }
    router.refresh();
  }

  async function save(input: ModelConfigInput, id?: string) {
    const url = id ? `/api/model-configs/${id}` : "/api/model-configs";
    const method = id ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">Models</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the endpoints and models everyone can pick from.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus /> Add model
        </Button>
      </header>

      {initial.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No models yet. Click “Add model” to create the first one.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Label</th>
                <th className="px-3 py-2 text-left font-medium">Model</th>
                <th className="px-3 py-2 text-left font-medium">Endpoint</th>
                <th className="w-20 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {initial.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{m.label}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {m.model}
                  </td>
                  <td className="px-3 py-2 truncate text-xs text-muted-foreground">
                    {m.baseUrl}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setEditing(m)}
                      aria-label={`Edit ${m.label}`}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => remove(m.id, m.label)}
                      aria-label={`Delete ${m.label}`}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ModelConfigDialog
        mode={editing}
        onClose={() => setEditing(null)}
        onSave={save}
      />
    </div>
  );
}
