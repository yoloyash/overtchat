"use client";

import {
  Check,
  Loader2,
  Monitor,
  PencilLine,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentSshHostCandidate } from "@/lib/agents/types";
import { cn } from "@/lib/utils";

export function SshHostPicker({
  hosts,
  selectedAlias,
  loading,
  refreshing,
  disabled,
  error,
  onSelect,
  onRefresh,
  onAddManually,
}: {
  hosts: AgentSshHostCandidate[];
  selectedAlias: string | null;
  loading: boolean;
  refreshing: boolean;
  disabled: boolean;
  error?: string;
  onSelect: (host: AgentSshHostCandidate) => void;
  onRefresh: () => void;
  onAddManually: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="min-h-24 overflow-hidden rounded-lg border">
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
          </div>
        ) : error ? (
          <p className="px-4 py-8 text-center text-xs text-destructive">
            {error}
          </p>
        ) : hosts.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center px-4 text-center">
            <Monitor className="size-4 text-muted-foreground" />
            <p className="mt-2 text-xs text-muted-foreground">
              No SSH aliases found
            </p>
          </div>
        ) : (
          hosts.map((host) => {
            const selected = selectedAlias === host.alias;
            return (
              <button
                key={host.alias}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => onSelect(host)}
                className={cn(
                  "flex min-h-16 w-full items-center gap-3 border-b px-3 text-left outline-none motion-colors last:border-b-0 hover:bg-muted/40 focus-visible:bg-muted/40 disabled:pointer-events-none disabled:opacity-60",
                  selected && "bg-muted/50",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
                  <Monitor className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {host.alias}
                  </span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {host.hostname}
                    {host.port === 22 ? "" : `:${host.port}`}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-primary",
                    selected ? "border-primary bg-primary/10" : "text-transparent",
                  )}
                  aria-hidden
                >
                  <Check className="size-3" />
                </span>
              </button>
            );
          })
        )}
      </div>
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || refreshing}
          onClick={onRefresh}
          aria-label="Refresh SSH hosts"
          title="Refresh SSH hosts"
        >
          <RefreshCw
            className={cn(
              refreshing && "animate-spin motion-reduce:animate-none",
            )}
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onAddManually}
        >
          <PencilLine />
          Add manually
        </Button>
      </div>
    </div>
  );
}
