"use client";

import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import { motionClasses } from "@/lib/motion";
import {
  MEMORY_KEY_MAX_LENGTH,
  MEMORY_VALUE_MAX_LENGTH,
  type Memory,
} from "@/lib/personalization/schema";
import {
  useCreateMemory,
  useDeleteMemory,
  useUpdateMemory,
} from "@/lib/queries/personalization";
import {
  SettingsActions,
  SettingsNotice,
} from "../SettingsRows";

export function MemoryDialog({
  memory,
  onOpenChange,
}: {
  memory: Memory | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const createMemory = useCreateMemory();
  const updateMemory = useUpdateMemory();
  const [key, setKey] = useState(memory?.key ?? "");
  const [value, setValue] = useState(memory?.value ?? "");
  const [error, setError] = useState("");
  const pending = createMemory.isPending || updateMemory.isPending;
  const changed =
    memory === null ||
    key.trim() !== memory.key ||
    value.trim() !== memory.value;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (memory) {
        await updateMemory.mutateAsync({ id: memory.id, input: { key, value } });
        toast.success({ title: t("personalization.memories.dialog.updatedToast") });
      } else {
        await createMemory.mutateAsync({ key, value });
        toast.success({ title: t("personalization.memories.dialog.addedToast") });
      }
      onOpenChange(false);
    } catch (cause) {
      setError(
        getErrorMessage(
          cause,
          memory
            ? t("personalization.memories.dialog.updateError")
            : t("personalization.memories.dialog.addError"),
        ),
      );
    }
  }

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={`fixed inset-0 z-40 bg-black/40 ${motionClasses.overlay}`}
        />
        <Dialog.Popup
          className={`fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none ${motionClasses.dialog}`}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {memory
              ? t("personalization.memories.editTitle")
              : t("personalization.memories.add")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {t("personalization.memories.dialog.description")}
          </Dialog.Description>

          <form onSubmit={save} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="memory-value">
                {t("personalization.memories.dialog.valueLabel")}
              </Label>
              <Textarea
                id="memory-value"
                aria-label={t("personalization.memories.dialog.valueAriaLabel")}
                maxLength={MEMORY_VALUE_MAX_LENGTH}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError("");
                }}
                placeholder={t("personalization.memories.dialog.valuePlaceholder")}
                className="min-h-28"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="memory-key">
                {t("personalization.memories.dialog.keyLabel")}
              </Label>
              <Input
                id="memory-key"
                aria-label={t("personalization.memories.dialog.keyAriaLabel")}
                maxLength={MEMORY_KEY_MAX_LENGTH}
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                  setError("");
                }}
                // eslint-disable-next-line i18next/no-literal-string -- identifier key example
                placeholder="response_style"
                required
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {t("personalization.memories.dialog.keyHint")}
              </p>
            </div>

            {error && <SettingsNotice tone="error">{error}</SettingsNotice>}

            <SettingsActions bordered={false} className="pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={pending || !changed}>
                {pending
                  ? t("common.states.saving")
                  : memory
                    ? t("common.actions.saveChanges")
                    : t("personalization.memories.add")}
              </Button>
            </SettingsActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DeleteMemoryButton({ memory }: { memory: Memory }) {
  const { t } = useTranslation();
  const deleteMemory = useDeleteMemory();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("personalization.memories.deleteDialog.ariaLabel", {
              key: memory.key,
            })}
            title={t("personalization.memories.deleteDialog.buttonTitle")}
          />
        }
      >
        <Trash2 />
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop
          className={`fixed inset-0 z-50 bg-black/40 ${motionClasses.overlay}`}
        />
        <AlertDialog.Popup
          className={`fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl outline-none ${motionClasses.popup}`}
        >
          <AlertDialog.Title className="text-base font-semibold">
            {t("personalization.memories.deleteDialog.title")}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
            {t("personalization.memories.deleteDialog.description")}
          </AlertDialog.Description>
          {error && (
            <SettingsNotice tone="error" className="mt-3">
              {error}
            </SettingsNotice>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button variant="ghost" />}>
              {t("common.actions.cancel")}
            </AlertDialog.Close>
            <Button
              variant="destructive"
              disabled={deleteMemory.isPending}
              onClick={async () => {
                setError("");
                try {
                  await deleteMemory.mutateAsync(memory.id);
                  toast.success({
                    title: t("personalization.memories.deleteDialog.deletedToast"),
                  });
                  setOpen(false);
                } catch (cause) {
                  setError(
                    getErrorMessage(
                      cause,
                      t("personalization.memories.deleteDialog.error"),
                    ),
                  );
                }
              }}
            >
              {deleteMemory.isPending
                ? t("common.states.deleting")
                : t("common.actions.delete")}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function ClearMemoriesButton({
  pending,
  onClear,
}: {
  pending: boolean;
  onClear: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger
        render={<Button type="button" variant="ghost" size="sm" />}
      >
        {t("personalization.memories.clearDialog.trigger")}
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop
          className={`fixed inset-0 z-50 bg-black/40 ${motionClasses.overlay}`}
        />
        <AlertDialog.Popup
          className={`fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl outline-none ${motionClasses.popup}`}
        >
          <AlertDialog.Title className="text-base font-semibold">
            {t("personalization.memories.clearDialog.title")}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
            {t("personalization.memories.clearDialog.description")}
          </AlertDialog.Description>
          {error && (
            <SettingsNotice tone="error" className="mt-3">
              {error}
            </SettingsNotice>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button variant="ghost" />}>
              {t("common.actions.cancel")}
            </AlertDialog.Close>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={async () => {
                setError("");
                try {
                  await onClear();
                  setOpen(false);
                } catch (cause) {
                  setError(
                    getErrorMessage(
                      cause,
                      t("personalization.memories.clearDialog.error"),
                    ),
                  );
                }
              }}
            >
              {pending
                ? t("personalization.memories.clearDialog.clearing")
                : t("personalization.memories.clearDialog.trigger")}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
