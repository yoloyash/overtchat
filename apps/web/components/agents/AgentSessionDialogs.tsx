"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  AgentRuntimeSnapshot,
  AgentSessionStats,
  AgentUsageSnapshot,
} from "@overtchat/agent-bridge";
import { safeExternalUrl, type AgentQuestionResponse } from "@overtchat/shared/agent-interaction";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

type AgentInteraction = NonNullable<
  AgentRuntimeSnapshot["pendingInteraction"]
>;

const dialogBackdrop = cn(
  "fixed inset-0 z-40 bg-black/40",
  motionClasses.overlay,
);
const dialogPopup = cn(
  "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
  motionClasses.dialog,
);

export function RenameAgentSessionDialog({
  providerLabel,
  open,
  initialName,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  providerLabel: string;
  open: boolean;
  initialName: string;
  pending: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  return open ? (
    <RenameAgentSessionDialogContent
      initialName={initialName}
      providerLabel={providerLabel}
      pending={pending}
      error={error}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
    />
  ) : null;
}

function RenameAgentSessionDialogContent({
  providerLabel,
  initialName,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  providerLabel: string;
  initialName: string;
  pending: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdrop} />
        <Dialog.Popup className={dialogPopup}>
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Rename session
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            This updates the native {providerLabel} session name.
          </Dialog.Description>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const value = name.trim();
              if (value) onSubmit(value);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="agent-session-name">Name</Label>
              <Input
                id="agent-session-name"
                value={name}
                maxLength={120}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {error && <DialogError>{error}</DialogError>}
            <DialogActions>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={pending || !name.trim()}
              >
                {pending && <PendingIcon />}
                Save
              </Button>
            </DialogActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function CompactAgentSessionDialog({
  providerLabel,
  supportsCustomInstructions,
  open,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  providerLabel: string;
  supportsCustomInstructions: boolean;
  open: boolean;
  pending: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (instructions?: string) => void;
}) {
  return open ? (
    <CompactAgentSessionDialogContent
      pending={pending}
      providerLabel={providerLabel}
      supportsCustomInstructions={supportsCustomInstructions}
      error={error}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
    />
  ) : null;
}

function CompactAgentSessionDialogContent({
  providerLabel,
  supportsCustomInstructions,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  providerLabel: string;
  supportsCustomInstructions: boolean;
  pending: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (instructions?: string) => void;
}) {
  const [instructions, setInstructions] = useState("");

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdrop} />
        <Dialog.Popup className={dialogPopup}>
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Compact context?
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {providerLabel} will summarize older context in this native
            session.
          </Dialog.Description>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit(instructions.trim() || undefined);
            }}
          >
            {supportsCustomInstructions && (
              <div className="space-y-1.5">
                <Label htmlFor="agent-compact-instructions">
                  Instructions{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  id="agent-compact-instructions"
                  value={instructions}
                  maxLength={20_000}
                  className="min-h-24 resize-y"
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </div>
            )}
            {error && <DialogError>{error}</DialogError>}
            <DialogActions>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending && <PendingIcon />}
                Compact
              </Button>
            </DialogActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AgentInteractionDialog({
  providerLabel,
  request,
  pending,
  error,
  onRespond,
}: {
  providerLabel: string;
  request?: AgentInteraction;
  pending: boolean;
  error?: string;
  onRespond: (response: AgentQuestionResponse) => void;
}) {
  return request ? (
    <InteractionDialogContent
      key={request.id}
      providerLabel={providerLabel}
      request={request}
      pending={pending}
      error={error}
      onRespond={onRespond}
    />
  ) : null;
}

export function AgentUsageDialog({
  open,
  usage,
  pending,
  error,
  onOpenChange,
}: {
  open: boolean;
  usage: AgentUsageSnapshot | null;
  pending: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  const activityRows = [
    ["Lifetime tokens", usage?.activity?.lifetimeTokens],
    ["Current streak", usage?.activity?.currentStreakDays],
    ["Longest streak", usage?.activity?.longestStreakDays],
    ["Peak daily tokens", usage?.activity?.peakDailyTokens],
  ].filter((row): row is [string, number] => typeof row[1] === "number");

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdrop} />
        <Dialog.Popup className={dialogPopup}>
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Codex usage
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {usage?.planType
              ? `${formatPlanType(usage.planType)} plan`
              : "Current account limits"}
          </Dialog.Description>

          {pending ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              Loading account usage…
            </div>
          ) : error ? (
            <p className="mt-5 text-sm text-destructive">{error}</p>
          ) : usage ? (
            <div className="mt-5 space-y-5">
              {usage.windows.length > 0 && (
                <div className="space-y-4">
                  {usage.windows.map((window) => (
                    <div key={window.id} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-medium">
                          {window.label}
                          {window.windowDurationMins
                            ? ` · ${formatDuration(window.windowDurationMins)}`
                            : ""}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {Math.round(window.usedPercent)}% used
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.max(0, Math.min(100, window.usedPercent))}%`,
                          }}
                        />
                      </div>
                      {window.resetsAt && (
                        <p className="text-xs text-muted-foreground">
                          Resets {formatResetTime(window.resetsAt)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {usage.credits && (
                <div className="flex items-center justify-between border-t pt-4 text-sm">
                  <span className="text-muted-foreground">Credits</span>
                  <span className="font-medium tabular-nums">
                    {usage.credits.unlimited
                      ? "Unlimited"
                      : usage.credits.balance ?? "Available"}
                  </span>
                </div>
              )}

              {activityRows.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t pt-4 text-sm">
                  {activityRows.map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="mt-0.5 font-medium tabular-nums">
                        {label.includes("streak")
                          ? `${value.toLocaleString()} days`
                          : value.toLocaleString()}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {usage.windows.length === 0 &&
                !usage.credits &&
                activityRows.length === 0 &&
                !usage.unavailableReason && (
                  <p className="text-sm text-muted-foreground">
                    Codex did not return usage details for this account.
                  </p>
                )}
              {usage.unavailableReason && (
                <p className="text-sm text-muted-foreground">
                  {usage.unavailableReason}
                </p>
              )}
            </div>
          ) : null}

          <DialogActions>
            <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogActions>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AgentSessionStatsDialog({
  open,
  stats,
  onOpenChange,
}: {
  open: boolean;
  stats: AgentSessionStats;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  const rows = [
    ["Input", formatInteger(stats.tokens.input)],
    ["Output", formatInteger(stats.tokens.output)],
    ["Cache read", formatInteger(stats.tokens.cacheRead)],
    ["Total", formatInteger(stats.tokens.total)],
    ["Estimated cost", formatCost(stats.cost)],
    ["Tool calls", formatInteger(stats.toolCalls)],
  ];

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdrop} />
        <Dialog.Popup className={dialogPopup}>
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Session usage
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Tokens, tool calls, and estimated cost for this session.
          </Dialog.Description>
          <dl className="mt-5 space-y-3 text-sm">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <DialogActions>
            <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogActions>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatCost(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}

function formatPlanType(value: string): string {
  return value
    .replace(/_/gu, " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}

function formatDuration(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} min`;
}

function formatResetTime(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1_000);
  const delta = date.getTime() - Date.now();
  if (delta > 0 && delta < 48 * 60 * 60 * 1_000) {
    const hours = Math.max(1, Math.ceil(delta / (60 * 60 * 1_000)));
    return `in ${hours}h`;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function InteractionDialogContent({
  providerLabel,
  request,
  pending,
  error,
  onRespond,
}: {
  providerLabel: string;
  request: AgentInteraction;
  pending: boolean;
  error?: string;
  onRespond: (response: AgentQuestionResponse) => void;
}) {
  const toolApproval = request.approvalKind === "tool";
  const approveValue =
    typeof request.approveValue === "string" ? request.approveValue : "Approve";
  const denyValue =
    typeof request.denyValue === "string" ? request.denyValue : "Deny";
  const alwaysValue =
    typeof request.alwaysValue === "string" ? request.alwaysValue : null;
  const title =
    typeof request.title === "string" && request.title.trim()
      ? request.title
      : `${providerLabel} needs your input`;
  const url =
    request.method === "external" ? safeExternalUrl(request.url) : null;
  const detail = toolApprovalDetail(request.toolDetail);
  const cancel = () =>
    onRespond(toolApproval ? { value: denyValue } : { cancelled: true });
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next && !pending) cancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdrop} />
        <Dialog.Popup className={dialogPopup}>
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {title}
          </Dialog.Title>
          {typeof request.message === "string" && request.message && (
            <Dialog.Description className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {request.message}
            </Dialog.Description>
          )}
          {detail && (
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 font-mono text-xs">
              {detail}
            </pre>
          )}
          <div className="mt-5 space-y-4">
            {url && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                render={<a href={url} target="_blank" rel="noreferrer" />}
              >
                <ExternalLink />
                Open authorization page
              </Button>
            )}
            {error && <DialogError>{error}</DialogError>}
            <DialogActions>
              <Button
                type="button"
                variant={toolApproval ? "destructive" : "ghost"}
                size="sm"
                disabled={pending}
                onClick={cancel}
              >
                {toolApproval ? "Deny" : "Cancel"}
              </Button>
              {toolApproval ? (
                <>
                  {alwaysValue && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => onRespond({ value: alwaysValue })}
                    >
                      {typeof request.alwaysLabel === "string"
                        ? request.alwaysLabel
                        : "Allow always"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() => onRespond({ value: approveValue })}
                  >
                    {pending && <PendingIcon />}Approve
                  </Button>
                </>
              ) : (
                request.method === "external" && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending || !url}
                    onClick={() => onRespond({ confirmed: true })}
                  >
                    {pending && <PendingIcon />}Continue
                  </Button>
                )
              )}
            </DialogActions>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function toolApprovalDetail(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const detail = value as Record<string, unknown>;
  if (detail.type === "shell" && typeof detail.command === "string") {
    return detail.command;
  }
  if (detail.type === "edit" && Array.isArray(detail.changes)) {
    return (
      detail.changes
        .flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const change = value as Record<string, unknown>;
          if (typeof change.filePath !== "string") return [];
          const path =
            typeof change.movePath === "string"
              ? `${change.filePath} → ${change.movePath}`
              : change.filePath;
          return [
            `${path}\n${
              typeof change.patch === "string" && change.patch
                ? change.patch
                : "No change preview was provided for this file."
            }`,
          ];
        })
        .join("\n\n") || null
    );
  }
  if (detail.type === "edit" && typeof detail.filePath === "string") {
    return detail.filePath;
  }
  if (
    detail.type === "write" &&
    typeof detail.filePath === "string" &&
    typeof detail.content === "string"
  ) {
    return `${detail.filePath}\n\n${detail.content}`;
  }
  if (detail.type === "json") return JSON.stringify(detail.value, null, 2);
  return null;
}

function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 pt-2">{children}</div>;
}

function DialogError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}

function PendingIcon() {
  return (
    <Loader2 className="animate-spin motion-reduce:animate-none" />
  );
}
