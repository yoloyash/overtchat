"use client";

import { ErrorNotice } from "@/components/ui/error-notice";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ExternalLink, Loader2 } from "lucide-react";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  AgentRuntimeSnapshot,
  AgentSessionStats,
  AgentUsageSnapshot,
} from "@overtchat/agent-bridge";
import {
  safeExternalUrl,
  type AgentQuestionResponse,
} from "@overtchat/shared/agent-interaction";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

type AgentInteraction = NonNullable<AgentRuntimeSnapshot["pendingInteraction"]>;

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
  const { t } = useTranslation();
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
            {t("agents.session.rename")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {t("agents.dialogs.renameDescription", { provider: providerLabel })}
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
              <Label htmlFor="agent-session-name">
                {t("agents.dialogs.nameLabel")}
              </Label>
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
                {t("agents.common.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={pending || !name.trim()}
              >
                {pending && <PendingIcon />}
                {t("agents.common.save")}
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
  const { t } = useTranslation();
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
            {t("agents.dialogs.compactTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {t("agents.dialogs.compactDescription", {
              provider: providerLabel,
            })}
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
                  <Trans
                    i18nKey="agents.dialogs.instructionsLabel"
                    components={{
                      optional: (
                        <span className="font-normal text-muted-foreground" />
                      ),
                    }}
                  />
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
                {t("agents.common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending && <PendingIcon />}
                {t("agents.dialogs.compactAction")}
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
  providerLabel,
  usage,
  pending,
  error,
  onOpenChange,
}: {
  open: boolean;
  providerLabel: string;
  usage: AgentUsageSnapshot | null;
  pending: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  const activityRows = [
      {
        key: "lifetimeTokens",
        label: t("agents.dialogs.lifetimeTokens"),
        value: usage?.activity?.lifetimeTokens,
        days: false,
      },
      {
        key: "currentStreak",
        label: t("agents.dialogs.currentStreak"),
        value: usage?.activity?.currentStreakDays,
        days: true,
      },
      {
        key: "longestStreak",
        label: t("agents.dialogs.longestStreak"),
        value: usage?.activity?.longestStreakDays,
        days: true,
      },
      {
        key: "peakDailyTokens",
        label: t("agents.dialogs.peakDailyTokens"),
        value: usage?.activity?.peakDailyTokens,
        days: false,
      },
  ].filter(
    (row): row is { key: string; label: string; value: number; days: boolean } =>
      typeof row.value === "number",
  );

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdrop} />
        <Dialog.Popup className={dialogPopup}>
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {t("agents.dialogs.usageTitle", { provider: providerLabel })}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {usage?.planType
              ? t("agents.dialogs.planName", {
                  plan: formatPlanType(usage.planType),
                })
              : t("agents.dialogs.currentAccountLimits")}
          </Dialog.Description>

          {pending ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              {t("agents.dialogs.loadingAccountUsage")}
            </div>
          ) : error ? (
            <ErrorNotice className="mt-5" message={error} />
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
                            ? ` · ${formatDuration(window.windowDurationMins, t)}`
                            : ""}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {t("agents.dialogs.usedPercent", {
                            percent: Math.round(window.usedPercent),
                          })}
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
                          {formatResetLabel(window.resetsAt, t)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {usage.credits && (
                <div className="flex items-center justify-between border-t pt-4 text-sm">
                  <span className="text-muted-foreground">
                    {t("agents.dialogs.credits")}
                  </span>
                  <span className="font-medium tabular-nums">
                    {usage.credits.unlimited
                      ? t("agents.dialogs.unlimited")
                      : (usage.credits.balance ?? t("agents.dialogs.available"))}
                  </span>
                </div>
              )}

              {activityRows.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t pt-4 text-sm">
                  {activityRows.map((row) => (
                    <div key={row.key}>
                      <dt className="text-xs text-muted-foreground">
                        {row.label}
                      </dt>
                      <dd className="mt-0.5 font-medium tabular-nums">
                        {row.days
                          ? t("agents.dialogs.streakDays", {
                              value: row.value.toLocaleString(),
                            })
                          : row.value.toLocaleString()}
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
                    {t("agents.dialogs.noUsageDetails", {
                      provider: providerLabel,
                    })}
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
              {t("agents.common.done")}
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
  const { t } = useTranslation();
  if (!open) return null;
  const rows = [
    ["input", t("agents.dialogs.statsInput"), formatInteger(stats.tokens.input)],
    ["output", t("agents.dialogs.statsOutput"), formatInteger(stats.tokens.output)],
    [
      "cacheRead",
      t("agents.dialogs.statsCacheRead"),
      formatInteger(stats.tokens.cacheRead),
    ],
    ["total", t("agents.dialogs.statsTotal"), formatInteger(stats.tokens.total)],
    [
      "estimatedCost",
      t("agents.dialogs.statsEstimatedCost"),
      formatCost(stats.cost),
    ],
    [
      "toolCalls",
      t("agents.dialogs.statsToolCalls"),
      formatInteger(stats.toolCalls),
    ],
  ];

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdrop} />
        <Dialog.Popup className={dialogPopup}>
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {t("agents.session.sessionUsage")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {t("agents.dialogs.sessionUsageDescription")}
          </Dialog.Description>
          <dl className="mt-5 space-y-3 text-sm">
            {rows.map(([key, label, value]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <DialogActions>
            <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
              {t("agents.common.done")}
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

function formatDuration(minutes: number, t: TFunction): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return t("agents.dialogs.durationDays", { count: days });
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return t("agents.dialogs.durationHours", { count: hours });
  }
  return t("agents.dialogs.durationMinutes", { minutes });
}

function formatResetLabel(timestampSeconds: number, t: TFunction): string {
  const date = new Date(timestampSeconds * 1_000);
  const delta = date.getTime() - Date.now();
  if (delta > 0 && delta < 48 * 60 * 60 * 1_000) {
    const hours = Math.max(1, Math.ceil(delta / (60 * 60 * 1_000)));
    return t("agents.dialogs.resetsInHours", { hours });
  }
  return t("agents.dialogs.resetsAt", {
    time: date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
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
  const { t } = useTranslation();
  const title =
    typeof request.title === "string" && request.title.trim()
      ? request.title
      : t("agents.dialogs.needsInput", { provider: providerLabel });
  const url =
    request.method === "external" ? safeExternalUrl(request.url) : null;
  const cancel = () => onRespond({ cancelled: true });
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
          <div className="mt-5 space-y-4">
            {url && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                render={<a href={url} target="_blank" rel="noreferrer" />}
              >
                <ExternalLink />
                {t("agents.dialogs.openAuthPage")}
              </Button>
            )}
            {error && <DialogError>{error}</DialogError>}
            <DialogActions>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={cancel}
              >
                {t("agents.common.cancel")}
              </Button>
              {request.method === "external" && (
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || !url}
                  onClick={() => onRespond({ confirmed: true })}
                >
                  {pending && <PendingIcon />}
                  {t("agents.dialogs.continueAction")}
                </Button>
              )}
            </DialogActions>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DialogActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-end gap-2 pt-2">{children}</div>
  );
}

function DialogError({ children }: { children: React.ReactNode }) {
  return (
    <ErrorNotice message={children} />
  );
}

function PendingIcon() {
  return <Loader2 className="animate-spin motion-reduce:animate-none" />;
}
