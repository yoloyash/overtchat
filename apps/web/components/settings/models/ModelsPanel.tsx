"use client";

import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { ArrowDown, ArrowUp, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import type { AdminModelConfig } from "@/lib/model-config/schema";
import { getErrorMessage } from "@/lib/errors";
import {
  findProvider,
  isProviderId,
  modelIconForModel,
  providerDisplayLabel,
} from "@/lib/providers/catalog";
import {
  useAdminModelConfigs,
  useDeleteModelConfig,
  useSetTaskModel,
  useUpdateModelConfig,
  useReorderModels,
} from "@/lib/queries/modelConfigs";
import { cn } from "@/lib/utils";
import {
  SettingsNotice,
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../SettingsRows";
import { HealthBadge } from "./HealthBadge";
import { motionClasses } from "@/lib/motion";

const ACTIVE_CHAT_MODEL = "__active-chat-model__";

export function ModelsPanel() {
  const { t } = useTranslation();
  const { data: models = [] } = useAdminModelConfigs();
  const deleteMut = useDeleteModelConfig();
  const taskModelMut = useSetTaskModel();
  const updateMut = useUpdateModelConfig();
  const reorderMut = useReorderModels();

  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AdminModelConfig | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const taskModel = models.find((model) => model.taskModel) ?? null;

  async function moveModel(id: string, direction: -1 | 1) {
    const modelIds = models.map((model) => model.id);
    const index = modelIds.indexOf(id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= modelIds.length) return;
    [modelIds[index], modelIds[next]] = [modelIds[next], modelIds[index]];
    try {
      await reorderMut.mutateAsync(modelIds);
    } catch (error) {
      toast.error({
        title: getErrorMessage(error, t("models.toast.reorderFailed")),
      });
    }
  }

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => {
      const host = hostnameOf(m.baseUrl);
      return [
        m.label,
        m.model,
        m.baseUrl,
        host,
        providerLabel(m, t),
        m.enabled ? "enabled" : "disabled",
        m.taskModel ? `task ${t("models.item.taskBadge")}` : "",
        m.modelType,
        m.modelType === "image" ? t("models.item.imageBadge") : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [models, query, t]);

  async function toggleEnabled(m: AdminModelConfig, next: boolean) {
    setTogglingId(m.id);
    try {
      await updateMut.mutateAsync({
        id: m.id,
        input: {
          modelType: m.modelType,
          label: m.label,
          providerId: m.providerId,
          apiFormat: m.apiFormat,
          baseUrl: m.baseUrl,
          apiKey: m.apiKey,
          model: m.model,
          pricing: m.pricing,
          contextWindow: m.contextWindow,
          discoveredContextWindow: m.discoveredContextWindow,
          discoveredCapabilities: m.discoveredCapabilities,
          reasoningOverride: m.reasoningOverride ?? null,
          systemPrompt: m.systemPrompt,
          providerOptions: m.providerOptions,
          toolCallingEnabled: m.toolCallingEnabled,
          credentialScope: m.credentialScope,
          enabled: next,
        },
      });
    } catch (err) {
      const message = getErrorMessage(
        err,
        t("models.toast.updateFailedFallback"),
      );
      toast.error({
        title: next
          ? t("models.toast.enableFailed")
          : t("models.toast.disableFailed"),
        description: message,
      });
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const label = pendingDelete.label;
    setDeleteError("");
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
      toast.success({
        title: t("models.toast.deleted"),
        description: label,
      });
    } catch (err) {
      setDeleteError(getErrorMessage(err, t("models.toast.deleteFailed")));
    }
  }

  async function selectTaskModel(value: string | null) {
    if (!value) return;
    const modelConfigId = value === ACTIVE_CHAT_MODEL ? null : value;
    if (modelConfigId === (taskModel?.id ?? null)) return;
    try {
      await taskModelMut.mutateAsync(modelConfigId);
    } catch (err) {
      toast.error({
        title: t("models.toast.taskModelUpdateFailed"),
        description: getErrorMessage(err, t("models.toast.taskModelUnchanged")),
      });
    }
  }

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t("models.page.title")}
        description={t("models.page.description")}
        action={
          models.length > 0 ? (
            <Button render={<Link to="/settings/models/new" />} size="sm">
              <Plus /> {t("models.page.addModel")}
            </Button>
          ) : undefined
        }
      />

      {models.length > 0 && (
        <SettingsSection
          title={t("models.backgroundTasks.title")}
          description={t("models.backgroundTasks.description")}
        >
          <SettingsRow
            title={t("models.backgroundTasks.taskModelTitle")}
            description={t("models.backgroundTasks.taskModelDescription")}
            align="center"
            controlAlign="end"
          >
            <Select
              value={taskModel?.id ?? ACTIVE_CHAT_MODEL}
              onValueChange={(value) => void selectTaskModel(value)}
              disabled={taskModelMut.isPending}
            >
              <SelectTrigger
                aria-label={t("models.backgroundTasks.taskModelTitle")}
                className="w-full"
              >
                <SelectValue>
                  {taskModel
                    ? taskModel.label
                    : t("models.backgroundTasks.sameAsChatModel")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ACTIVE_CHAT_MODEL}>
                  {t("models.backgroundTasks.sameAsChatModel")}
                </SelectItem>
                <SelectSeparator />
                {models
                  .filter((model) => model.modelType !== "image")
                  .map((model) => {
                    const iconId =
                      modelIconForModel(model.model) ??
                      findProvider(model.providerId)?.iconId;
                    return (
                      <SelectItem key={model.id} value={model.id}>
                        <ModelBrandIcon iconId={iconId} className="size-4" />
                        <span>{model.label}</span>
                        {!model.enabled && (
                          <span className="text-xs text-muted-foreground">
                            {t("models.backgroundTasks.notInChat")}
                          </span>
                        )}
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsSection>
      )}

      {models.length > 0 && (
        <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("models.page.searchPlaceholder")}
              className="pl-8"
              aria-label={t("models.page.searchLabel")}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("models.page.configuredCount", { count: models.length })}
          </p>
        </div>
      )}

      {models.length === 0 ? (
        <div className="border-y border-dashed px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">
            {t("models.page.empty")}
          </p>
          <Button
            render={<Link to="/settings/models/new" />}
            className="mt-4"
            size="sm"
          >
            <Plus /> {t("models.page.addFirstModel")}
          </Button>
        </div>
      ) : filteredModels.length === 0 ? (
        <div className="border-y px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            <Trans
              i18nKey="models.page.noMatches"
              values={{ query: query.trim() }}
              components={{ query: <span className="text-foreground" /> }}
            />
          </p>
        </div>
      ) : (
        <div>
          <p className="mb-3 text-xs text-muted-foreground">
            {query.trim()
              ? t("models.page.reorderClearSearch")
              : t("models.page.reorderHint")}
          </p>
          <div className="@container divide-y divide-border/70 border-y">
            {filteredModels.map((m) => {
              const host = hostnameOf(m.baseUrl);
              const iconId =
                modelIconForModel(m.model) ?? findProvider(m.providerId)?.iconId;
              return (
                <div
                  key={m.id}
                  className={cn(
                    "grid gap-3 py-3 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-center",
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
                        {m.taskModel && (
                          <span className="rounded-full border bg-accent/50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
                            {t("models.item.taskBadge")}
                          </span>
                        )}
                        {m.modelType === "image" && (
                          <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {t("models.item.imageBadge")}
                          </span>
                        )}
                        {m.modelType !== "image" && (
                          <HealthBadge
                            id={m.id}
                            enabled={m.enabled || m.taskModel}
                          />
                        )}
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>{providerLabel(m, t)}</span>
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground/50"
                        >
                          /
                        </span>
                        <span className="font-mono">{host}</span>
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {m.model}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 justify-self-end @xl:flex-nowrap">
                    <div className="flex items-center">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("models.item.moveUpLabel", {
                          label: m.label,
                        })}
                        title={t("models.item.moveUpTitle")}
                        disabled={
                          reorderMut.isPending ||
                          !!query.trim() ||
                          models[0]?.id === m.id
                        }
                        onClick={() => void moveModel(m.id, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("models.item.moveDownLabel", {
                          label: m.label,
                        })}
                        title={t("models.item.moveDownTitle")}
                        disabled={
                          reorderMut.isPending ||
                          !!query.trim() ||
                          models[models.length - 1]?.id === m.id
                        }
                        onClick={() => void moveModel(m.id, 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                    <div className="flex items-center justify-end gap-2 @2xl:min-w-16">
                      <span className="hidden text-xs text-muted-foreground @2xl:inline">
                        {m.enabled ? t("models.item.on") : t("models.item.off")}
                      </span>
                      <Switch
                        checked={m.enabled}
                        disabled={togglingId !== null}
                        onCheckedChange={(next) => void toggleEnabled(m, next)}
                        aria-label={
                          m.enabled
                            ? t("models.item.disableLabel", { label: m.label })
                            : t("models.item.enableLabel", { label: m.label })
                        }
                      />
                    </div>
                    <div className="h-6 w-px bg-border" aria-hidden="true" />
                    <div className="flex items-center gap-1.5">
                      <Button
                        render={<Link to="/settings/models/$id" params={{ id: m.id }} />}
                        variant="outline"
                        size="sm"
                        aria-label={t("models.item.editLabel", {
                          label: m.label,
                        })}
                        title={t("models.item.editLabel", { label: m.label })}
                      >
                        <Pencil data-icon="inline-start" />
                        {t("common.actions.edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDeleteError("");
                          setPendingDelete(m);
                        }}
                        aria-label={t("models.item.deleteLabel", {
                          label: m.label,
                        })}
                        title={t("models.item.deleteLabel", { label: m.label })}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 data-icon="inline-start" />
                        {t("common.actions.delete")}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
          <AlertDialog.Backdrop
            className={cn(
              "fixed inset-0 z-40 bg-black/40",
              motionClasses.overlay,
            )}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              {t("models.deleteDialog.title")}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <Trans
                i18nKey={
                  pendingDelete?.taskModel
                    ? "models.deleteDialog.descriptionTaskModel"
                    : "models.deleteDialog.description"
                }
                values={{ name: pendingDelete?.label ?? "" }}
                components={{
                  name: <span className="font-medium text-foreground" />,
                }}
              />
            </AlertDialog.Description>
            {deleteError && (
              <SettingsNotice tone="error" className="mt-3 text-xs">
                {deleteError}
              </SettingsNotice>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={deleteMut.isPending}
                onClick={() => setPendingDelete(null)}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMut.isPending}
                onClick={confirmDelete}
              >
                {deleteMut.isPending
                  ? t("common.states.deleting")
                  : t("common.actions.delete")}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </SettingsPage>
  );
}

/** The desktop app can list providers that its bundled catalog predates. */
function providerLabel(model: AdminModelConfig, t: TFunction): string {
  return isProviderId(model.providerId)
    ? providerDisplayLabel(model.providerId, t)
    : (model.displayProvider ?? model.providerId);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
