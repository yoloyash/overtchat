"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { type ApiConfig, loadConfig, saveConfig } from "@/lib/config";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave?: (config: ApiConfig) => void;
}

type ConnectStatus = "idle" | "loading" | "ok" | "error";

export function ApiConfigModal({ open, onClose, onSave }: Props) {
  const [config, setConfig] = useState<ApiConfig>({ baseUrl: "", apiKey: "", model: "" });
  const [models, setModels] = useState<string[]>([]);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>("idle");
  const [connectError, setConnectError] = useState("");

  useEffect(() => {
    if (!open) return;
    const saved = loadConfig();
    setConfig(saved);
    setConnectStatus("idle");
    setConnectError("");
    setModels([]);
  }, [open]);

  function handleBaseUrlChange(value: string) {
    setConfig((c) => ({ ...c, baseUrl: value }));
    setConnectStatus("idle");
    setModels([]);
  }

  async function connect() {
    setConnectStatus("loading");
    setConnectError("");
    setModels([]);

    try {
      const res = await fetch(config.baseUrl.replace(/\/$/, "") + "/models", {
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      const ids: string[] = (json.data ?? []).map((m: { id: string }) => m.id).sort();
      if (!ids.length) throw new Error("Endpoint returned no models");

      setModels(ids);
      setConnectStatus("ok");
      setConfig((c) => ({ ...c, model: ids.includes(c.model) ? c.model : ids[0] }));
    } catch (e) {
      setConnectStatus("error");
      setConnectError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleSave() {
    saveConfig(config);
    onSave?.(config);
    onClose();
  }

  const canSave = Boolean(config.baseUrl && config.model);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>API settings</DialogTitle>
        </DialogHeader>

        <Separator />

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              placeholder="http://localhost:8000/v1"
              value={config.baseUrl}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="apiKey">
              API key{" "}
              <span className="font-normal text-muted-foreground">— optional</span>
            </Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="sk-…"
              value={config.apiKey}
              onChange={(e) => setConfig((c) => ({ ...c, apiKey: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!config.baseUrl || connectStatus === "loading"}
              onClick={connect}
            >
              {connectStatus === "loading" ? "Connecting…" : "Connect"}
            </Button>
            {connectStatus === "ok" && (
              <span className="text-sm text-green-600 dark:text-green-400">Connected</span>
            )}
            {connectStatus === "error" && (
              <span className="text-sm text-destructive">{connectError}</span>
            )}
          </div>

          {models.length > 0 && (
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Select
                value={config.model}
                onValueChange={(v) => setConfig((c) => ({ ...c, model: v ?? "" }))}
              >
                <SelectTrigger className={cn(!config.model && "text-muted-foreground")}>
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <Separator />

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={handleSave}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
