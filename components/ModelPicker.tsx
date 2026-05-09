"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type ApiConfig, fetchModels } from "@/lib/config";

interface Props {
  config: ApiConfig;
  onChange: (config: ApiConfig) => void;
}

export function ModelPicker({ config, onChange }: Props) {
  const router = useRouter();
  const configured = Boolean(config.baseUrl);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function loadModels() {
    setStatus("loading");
    setError("");
    try {
      const ids = await fetchModels(config);
      setModels(ids);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) return;
    if (!configured) {
      router.push("/settings");
      return;
    }
    loadModels();
  }

  function selectModel(id: string) {
    onChange({ ...config, model: id });
  }

  const label = config.model || (configured ? "No model selected" : "Not configured");

  return (
    <Menu.Root onOpenChange={handleOpenChange}>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn("min-w-0 max-w-[60%] gap-1.5", !config.model && "text-muted-foreground")}
          />
        }
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="shrink-0 text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6}>
          <Menu.Popup className="z-50 max-h-80 w-64 overflow-y-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none">
            {status === "loading" && (
              <div className="flex items-center gap-2 px-2 py-3 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                <span>Loading models…</span>
              </div>
            )}
            {status === "error" && (
              <div className="px-2 py-3">
                <p className="text-destructive">Couldn’t reach endpoint</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>
                <Link
                  href="/settings"
                  className="mt-2 inline-block text-xs text-foreground underline underline-offset-4"
                >
                  Open settings
                </Link>
              </div>
            )}
            {status === "idle" && models.length === 0 && (
              <p className="px-2 py-3 text-muted-foreground">No models returned</p>
            )}
            {status === "idle" &&
              models.map((id) => (
                <Menu.Item
                  key={id}
                  onClick={() => selectModel(id)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      id === config.model ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{id}</span>
                </Menu.Item>
              ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
