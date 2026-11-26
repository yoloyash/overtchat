"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useTranslation } from "react-i18next";
import { resolveChatModelId } from "@overtchat/shared";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { getErrorMessage } from "@/lib/errors";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import { useModelPreferences } from "@/lib/queries/modelPreferences";
import {
  type ProjectListItem,
  useUpdateProject,
} from "@/lib/queries/projects";

const ACCOUNT_DEFAULT = "account-default";

function SettingsCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ProjectInstructionsCard({
  project,
}: {
  project: ProjectListItem;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const instructions = project.instructions?.trim() ?? "";

  return (
    <SettingsCard
      title={t("projects.instructions.title")}
      description={t("projects.instructions.description")}
      action={
        instructions ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("projects.instructions.edit")}
            title={t("projects.instructions.edit")}
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
        ) : undefined
      }
    >
      {instructions ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="line-clamp-6 w-full rounded-md text-left text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground motion-colors hover:text-foreground"
        >
          {instructions}
        </button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setEditing(true)}
        >
          <Plus /> {t("projects.instructions.add")}
        </Button>
      )}
      <InstructionsDialog
        project={project}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </SettingsCard>
  );
}

function InstructionsDialog({
  project,
  open,
  onClose,
}: {
  project: ProjectListItem;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const updateMut = useUpdateProject(project.id);
  const saved = project.instructions ?? "";
  const [draft, setDraft] = useState(saved);
  const dirty = draft !== saved;

  function save() {
    if (!dirty) {
      onClose();
      return;
    }
    updateMut.mutate(
      { instructions: draft.trim() ? draft : null },
      {
        onSuccess: () => {
          onClose();
          toast.success(t("projects.instructions.toast.saved"));
        },
        onError: (err) => {
          toast.error({
            title: t("projects.instructions.toast.saveError"),
            description: getErrorMessage(
              err,
              t("projects.instructions.errors.saveFallback"),
            ),
          });
        },
      },
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(saved);
        else if (!updateMut.isPending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-card p-6 shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {t("projects.instructions.dialogTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {t("projects.instructions.dialogDescription", { name: project.name })}
          </Dialog.Description>
          <form
            className="mt-5 flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Textarea
              autoFocus
              aria-label={t("projects.instructions.title")}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  save();
                }
              }}
              placeholder={t("projects.instructions.placeholder")}
              className="field-sizing-fixed min-h-64 flex-1 resize-none leading-relaxed"
            />
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground max-sm:hidden">
                {dirty ? t("projects.instructions.unsavedChanges") : " "}
              </span>
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={updateMut.isPending}
                  onClick={onClose}
                >
                  {t("projects.actions.cancel")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!dirty || updateMut.isPending}
                >
                  {updateMut.isPending
                    ? t("projects.actions.saving")
                    : t("projects.actions.save")}
                </Button>
              </div>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ProjectModelCard({
  project,
  onDefaultModelChange,
}: {
  project: ProjectListItem;
  /** Receives the model new chats now start with. */
  onDefaultModelChange?: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const { data: models, isError } = useModelConfigs();
  const preferences = useModelPreferences();
  const updateMut = useUpdateProject(project.id);
  // What new chats get without a project default: the account default, or
  // the first configured model when the account has none.
  const accountDefault =
    models?.find((model) => model.id === preferences.data?.defaultModelId) ??
    models?.[0];
  const projectDefault = models?.find(
    (model) => model.id === project.defaultModelId,
  );
  const unavailable = Boolean(
    models && project.defaultModelId && !projectDefault,
  );
  const value = projectDefault?.id ?? ACCOUNT_DEFAULT;

  function select(next: string) {
    const defaultModelId = next === ACCOUNT_DEFAULT ? null : next;
    if (defaultModelId === project.defaultModelId) return;
    updateMut.mutate(
      { defaultModelId },
      {
        onSuccess: () => {
          const modelId = resolveChatModelId(
            models ?? [],
            defaultModelId,
            preferences.data?.defaultModelId,
          );
          if (modelId) onDefaultModelChange?.(modelId);
        },
        onError: (err) => {
          toast.error({
            title: t("projects.model.toast.changeError"),
            description: getErrorMessage(err, t("projects.model.errors.changeFallback")),
          });
        },
      },
    );
  }

  return (
    <SettingsCard
      title={t("projects.model.title")}
      description={t("projects.model.description")}
    >
      <Select
        value={value}
        onValueChange={(next) => select(next as string)}
        disabled={!models || isError || updateMut.isPending}
      >
        <SelectTrigger aria-label={t("projects.model.title")} className="w-full">
          <SelectValue>
            {projectDefault ? (
              <>
                <ModelBrandIcon
                  iconId={
                    projectDefault.modelIconId ?? projectDefault.providerIconId
                  }
                  className="size-4"
                />
                <span className="truncate">{projectDefault.label}</span>
              </>
            ) : (
              <span className="truncate">
                {models ? t("projects.model.accountDefault") : t("projects.loading")}
                {accountDefault && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {accountDefault.label}
                  </span>
                )}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-80 min-w-60">
          <SelectItem value={ACCOUNT_DEFAULT}>
            <span className="flex min-w-0 flex-col">
              <span>{t("projects.model.accountDefault")}</span>
              <span className="truncate text-xs text-muted-foreground">
                {accountDefault?.label ?? t("projects.model.noModels")}
              </span>
            </span>
          </SelectItem>
          {(models?.length ?? 0) > 0 && <SelectSeparator />}
          {models?.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              <ModelBrandIcon
                iconId={model.modelIconId ?? model.providerIconId}
                className="size-4"
              />
              <span className="truncate">{model.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {unavailable && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("projects.model.unavailable")}
        </p>
      )}
    </SettingsCard>
  );
}
