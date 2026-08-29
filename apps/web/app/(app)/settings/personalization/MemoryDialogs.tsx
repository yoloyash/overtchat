"use client";

import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Trash2 } from "lucide-react";
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
} from "../_components/SettingsRows";

export function MemoryDialog({
  memory,
  onOpenChange,
}: {
  memory: Memory | null;
  onOpenChange: (open: boolean) => void;
}) {
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
        toast.success({ title: "Memory updated" });
      } else {
        await createMemory.mutateAsync({ key, value });
        toast.success({ title: "Memory added" });
      }
      onOpenChange(false);
    } catch (cause) {
      setError(
        getErrorMessage(
          cause,
          memory ? "Failed to update memory." : "Failed to add memory.",
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
            {memory ? "Edit memory" : "Add memory"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Saved memories are included in future chats when personalization is on.
          </Dialog.Description>

          <form onSubmit={save} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="memory-value">What should OvertChat remember?</Label>
              <Textarea
                id="memory-value"
                aria-label="Memory value"
                maxLength={MEMORY_VALUE_MAX_LENGTH}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError("");
                }}
                placeholder="Prefer concise answers."
                className="min-h-28"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="memory-key">Label</Label>
              <Input
                id="memory-key"
                aria-label="Memory key"
                maxLength={MEMORY_KEY_MAX_LENGTH}
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                  setError("");
                }}
                placeholder="response_style"
                required
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Used to update this memory later. Start with a letter and use
                lowercase letters, numbers, or underscores.
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
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending || !changed}>
                {pending ? "Saving…" : memory ? "Save changes" : "Add memory"}
              </Button>
            </SettingsActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DeleteMemoryButton({ memory }: { memory: Memory }) {
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
            aria-label={`Delete ${memory.key}`}
            title="Delete memory"
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
            Delete this memory?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
            OvertChat will no longer include it in future conversations.
          </AlertDialog.Description>
          {error && (
            <SettingsNotice tone="error" className="mt-3">
              {error}
            </SettingsNotice>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button variant="ghost" />}>
              Cancel
            </AlertDialog.Close>
            <Button
              variant="destructive"
              disabled={deleteMemory.isPending}
              onClick={async () => {
                setError("");
                try {
                  await deleteMemory.mutateAsync(memory.id);
                  toast.success({ title: "Memory deleted" });
                  setOpen(false);
                } catch (cause) {
                  setError(getErrorMessage(cause, "Failed to delete memory."));
                }
              }}
            >
              {deleteMemory.isPending ? "Deleting…" : "Delete"}
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
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger
        render={<Button type="button" variant="ghost" size="sm" />}
      >
        Clear all
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop
          className={`fixed inset-0 z-50 bg-black/40 ${motionClasses.overlay}`}
        />
        <AlertDialog.Popup
          className={`fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl outline-none ${motionClasses.popup}`}
        >
          <AlertDialog.Title className="text-base font-semibold">
            Clear all memories?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
            This permanently deletes every saved memory. Your profile fields are not affected.
          </AlertDialog.Description>
          {error && (
            <SettingsNotice tone="error" className="mt-3">
              {error}
            </SettingsNotice>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button variant="ghost" />}>
              Cancel
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
                  setError(getErrorMessage(cause, "Failed to clear memories."));
                }
              }}
            >
              {pending ? "Clearing…" : "Clear all"}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
