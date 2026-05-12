"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { CheckCircle2, ChevronDown, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  fetchModelsForEndpoint,
  type AdminModelConfig,
  type ModelConfigInput,
} from "@/lib/config";

type Mode = AdminModelConfig | "new" | null;

export function ModelConfigDialog({
  mode,
  onClose,
  onSave,
}: {
  mode: Mode;
  onClose: () => void;
  onSave: (input: ModelConfigInput, id?: string) => Promise<void>;
}) {
  const open = mode !== null;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(90vh,42rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-card shadow-lg outline-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity">
          {mode && (
            <ModelConfigForm
              editing={mode === "new" ? null : mode}
              onClose={onClose}
              onSave={onSave}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type PingResult =
  | { ok: true; text: string; elapsedMs: number; inputTokens: number | null; outputTokens: number | null }
  | { ok: false; error: string };

function ModelConfigForm({
  editing,
  onClose,
  onSave,
}: {
  editing: AdminModelConfig | null;
  onClose: () => void;
  onSave: (input: ModelConfigInput, id?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ModelConfigInput>(() =>
    editing
      ? {
          label: editing.label,
          baseUrl: editing.baseUrl,
          apiKey: editing.apiKey ?? "",
          model: editing.model,
          systemPrompt: editing.systemPrompt ?? "",
          extraBody: editing.extraBody,
          sortOrder: editing.sortOrder,
        }
      : {
          label: "",
          baseUrl: "",
          apiKey: "",
          model: "",
          systemPrompt: "",
          extraBody: null,
          sortOrder: 0,
        },
  );
  const [extraBodyText, setExtraBodyText] = useState(() =>
    editing?.extraBody ? JSON.stringify(editing.extraBody, null, 2) : "",
  );
  const [models, setModels] = useState<string[]>([]);
  const [probingModels, setProbingModels] = useState(false);
  const [probeError, setProbeError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(
    () => Boolean(editing?.systemPrompt || editing?.extraBody),
  );

  const probeModels = useCallback(
    async (baseUrl: string, apiKey: string | null | undefined) => {
      if (!baseUrl) return;
      setProbingModels(true);
      setProbeError("");
      try {
        const ids = await fetchModelsForEndpoint(baseUrl, apiKey);
        setModels(ids);
        if (ids.length > 0) {
          setDraft((d) => ({
            ...d,
            model: ids.includes(d.model) ? d.model : ids[0],
          }));
        }
      } catch (e) {
        setProbeError(e instanceof Error ? e.message : String(e));
      } finally {
        setProbingModels(false);
      }
    },
    [],
  );

  // Auto-probe when creating a new config and the endpoint/key changes.
  const isCreating = editing === null;
  const { baseUrl, apiKey } = draft;
  useEffect(() => {
    if (!isCreating || !baseUrl) return;
    const t = setTimeout(() => void probeModels(baseUrl, apiKey), 500);
    return () => clearTimeout(t);
  }, [isCreating, baseUrl, apiKey, probeModels]);

  function parseExtraBody(): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
    const trimmed = extraBodyText.trim();
    if (!trimmed) return { ok: true, value: null };
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { ok: false, error: "Must be a JSON object" };
      }
      return { ok: true, value: parsed as Record<string, unknown> };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function ping() {
    const parsed = parseExtraBody();
    if (!parsed.ok) {
      setPingResult({ ok: false, error: `Extra body: ${parsed.error}` });
      return;
    }
    setPinging(true);
    setPingResult(null);
    try {
      const res = await fetch("/api/model-configs/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey,
          model: draft.model,
          extraBody: parsed.value,
        }),
      });
      const json = (await res.json()) as {
        text?: string;
        elapsedMs?: number;
        inputTokens?: number | null;
        outputTokens?: number | null;
        error?: string;
      };
      if (!res.ok || json.error) {
        setPingResult({ ok: false, error: json.error ?? `HTTP ${res.status}` });
        return;
      }
      setPingResult({
        ok: true,
        text: json.text ?? "",
        elapsedMs: json.elapsedMs ?? 0,
        inputTokens: json.inputTokens ?? null,
        outputTokens: json.outputTokens ?? null,
      });
    } catch (e) {
      setPingResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPinging(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError("");

    const parsed = parseExtraBody();
    if (!parsed.ok) {
      setSaveError(`Extra body must be valid JSON object: ${parsed.error}`);
      return;
    }

    const label = draft.label.trim() || defaultLabelFor(draft.model);

    setSaving(true);
    try {
      await onSave({ ...draft, label, extraBody: parsed.value }, editing?.id);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="border-b px-6 py-4">
        <Dialog.Title className="font-heading text-base font-semibold tracking-tight">
          {editing ? "Edit model" : "Add model"}
        </Dialog.Title>
      </div>

      <form
        onSubmit={submit}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="p-base-url">Endpoint</Label>
            <Input
              id="p-base-url"
              placeholder="https://api.openai.com/v1"
              required
              autoFocus={!editing}
              value={draft.baseUrl}
              onChange={(e) => {
                const baseUrl = e.target.value;
                setDraft((d) => ({ ...d, baseUrl }));
                setModels([]);
                setProbeError("");
                setPingResult(null);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-api-key">
              API key <OptionalChip />
            </Label>
            <Input
              id="p-api-key"
              type="password"
              autoComplete="new-password"
              placeholder="sk-…"
              value={draft.apiKey ?? ""}
              onChange={(e) => {
                const apiKey = e.target.value;
                setDraft((d) => ({ ...d, apiKey }));
                setPingResult(null);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="p-model">Model</Label>
              <span className="flex h-5 items-center text-xs text-muted-foreground">
                {probingModels ? (
                  <>
                    <Loader2 className="mr-1 size-3 animate-spin" /> Fetching…
                  </>
                ) : models.length > 0 ? (
                  `${models.length} available`
                ) : probeError ? (
                  <button
                    type="button"
                    onClick={() => probeModels(draft.baseUrl, draft.apiKey)}
                    className="underline-offset-2 hover:underline"
                  >
                    Retry fetch
                  </button>
                ) : null}
              </span>
            </div>
            {models.length > 0 ? (
              <select
                id="p-model"
                value={draft.model}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, model: e.target.value }));
                  setPingResult(null);
                }}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="p-model"
                placeholder="gpt-4o-mini"
                required
                value={draft.model}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, model: e.target.value }));
                  setPingResult(null);
                }}
              />
            )}
            {probeError && <p className="text-xs text-destructive">{probeError}</p>}

            <div className="pt-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={!draft.baseUrl || !draft.model || pinging}
                onClick={ping}
              >
                {pinging ? (
                  <>
                    <Loader2 className="size-3 animate-spin" /> Testing…
                  </>
                ) : (
                  "Test connection"
                )}
              </Button>
            </div>

            {pingResult?.ok === true && (
              <div className="mt-2 rounded-lg border border-ring/30 bg-ring/5 px-3 py-2 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <CheckCircle2 className="size-3.5 text-ring" />
                  Connected
                  <span className="ml-auto font-normal text-muted-foreground">
                    {pingResult.elapsedMs}ms
                    {pingResult.inputTokens != null && pingResult.outputTokens != null && (
                      <> · {pingResult.inputTokens} in / {pingResult.outputTokens} out</>
                    )}
                  </span>
                </div>
                {pingResult.text && (
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {pingResult.text}
                  </p>
                )}
              </div>
            )}
            {pingResult?.ok === false && (
              <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <XCircle className="size-3.5 shrink-0 mt-0.5" />
                <span className="break-words">{pingResult.error}</span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-label">Display name</Label>
            <Input
              id="p-label"
              placeholder={draft.model ? defaultLabelFor(draft.model) : "Shown in the picker"}
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            />
          </div>

          <div className="border-t pt-4">
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              aria-expanded={advancedOpen}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Advanced
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-200",
                  advancedOpen && "rotate-180",
                )}
              />
            </button>
            {advancedOpen && (
              <div className="mt-4 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="p-system-prompt">
                    System prompt <OptionalChip />
                  </Label>
                  <textarea
                    id="p-system-prompt"
                    rows={3}
                    placeholder="You are a helpful assistant…"
                    value={draft.systemPrompt ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, systemPrompt: e.target.value }))
                    }
                    className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="p-extra">
                    Extra body <OptionalChip />
                  </Label>
                  <textarea
                    id="p-extra"
                    rows={4}
                    placeholder='{ "chat_template_kwargs": { "thinking": true } }'
                    value={extraBodyText}
                    onChange={(e) => {
                      setExtraBodyText(e.target.value);
                      setPingResult(null);
                    }}
                    className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  />
                </div>
              </div>
            )}
          </div>

          {saveError && (
            <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <XCircle className="size-3.5 shrink-0 mt-0.5" />
              <span className="break-words">{saveError}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-6 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || !draft.baseUrl || !draft.model}>
            {saving ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </div>
      </form>
    </>
  );
}

function OptionalChip() {
  return (
    <span className="ml-1 rounded px-1.5 py-px text-[10px] font-normal uppercase tracking-wide text-muted-foreground/80">
      Optional
    </span>
  );
}

function defaultLabelFor(model: string): string {
  if (!model) return "";
  const last = model.split("/").pop() ?? model;
  return last;
}
