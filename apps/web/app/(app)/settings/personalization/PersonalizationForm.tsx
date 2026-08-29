"use client";

import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Brain, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import {
  useClearMemories,
  useCreateMemory,
  useDeleteMemory,
  usePersonalization,
  useUpdateMemory,
  useUpdatePersonalization,
} from "@/lib/queries/personalization";
import type { Memory, Personalization } from "@/lib/personalization/schema";
import {
  ABOUT_MAX_LENGTH,
  MEMORY_KEY_MAX_LENGTH,
  MEMORY_VALUE_MAX_LENGTH,
  OCCUPATION_MAX_LENGTH,
  PREFERRED_NAME_MAX_LENGTH,
} from "@/lib/personalization/schema";
import { motionClasses } from "@/lib/motion";
import {
  SettingsActions,
  SettingsNotice,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../_components/SettingsRows";

export function PersonalizationForm() {
  const { data, isPending, error: loadError } = usePersonalization();
  const clearMemories = useClearMemories();
  const [memoryDialog, setMemoryDialog] = useState<
    Memory | null | undefined
  >();
  const [memoryQuery, setMemoryQuery] = useState("");

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading personalization…</p>;
  }
  if (loadError || !data) {
    return (
      <SettingsNotice tone="error">
        {getErrorMessage(loadError, "Unable to load personalization.")}
      </SettingsNotice>
    );
  }

  const normalizedQuery = memoryQuery.trim().toLocaleLowerCase();
  const filteredMemories = normalizedQuery
    ? data.memories.filter(
        (memory) =>
          memory.key.toLocaleLowerCase().includes(normalizedQuery) ||
          memory.value.toLocaleLowerCase().includes(normalizedQuery),
      )
    : data.memories;
  const usagePercent = Math.min(
    100,
    Math.round(
      Math.max(
        data.memoryUsage.characters / data.memoryUsage.limit,
        data.memoryUsage.entries / data.memoryUsage.entryLimit,
      ) * 100,
    ),
  );
  const usageTitle = `${data.memoryUsage.characters.toLocaleString()} of ${data.memoryUsage.limit.toLocaleString()} context characters · ${data.memoryUsage.entries} of ${data.memoryUsage.entryLimit} memories`;

  return (
    <div className="max-w-3xl space-y-8">
      <SettingsPageHeader
        title="Personalization"
        description="Tell OvertChat about you and manage what it remembers between chats."
      />

      <ProfileEditor
        key={JSON.stringify(data.personalization)}
        personalization={data.personalization}
      />

      <SettingsSection
        title="Saved memories"
        description="Models can add, update, or remove these entries when you explicitly ask them to remember or forget something."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span
              title={usageTitle}
              className="rounded-full border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
            >
              {usagePercent}% used
            </span>
            {data.memories.length > 0 && (
              <ClearMemoriesButton
                pending={clearMemories.isPending}
                onClear={async () => {
                  await clearMemories.mutateAsync(undefined);
                  toast.success({ title: "Memories cleared" });
                }}
              />
            )}
            <Button type="button" size="sm" onClick={() => setMemoryDialog(null)}>
              <Plus /> Add memory
            </Button>
          </div>
        }
        contentClassName="divide-y-0 border-y-0"
      >
        <div className="space-y-4 pt-1">
          {(data.memories.length >= 5 || memoryQuery) && (
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={memoryQuery}
                onChange={(event) => setMemoryQuery(event.target.value)}
                placeholder="Search memories"
                aria-label="Search memories"
                className="pl-8"
              />
            </div>
          )}
          {data.memories.length === 0 ? (
            <div className="border-y border-dashed px-6 py-12 text-center">
              <Brain className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Nothing remembered yet</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Ask OvertChat to remember something, or add it manually.
              </p>
            </div>
          ) : filteredMemories.length === 0 ? (
            <div className="border-y px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                No memories match <span className="text-foreground">{memoryQuery.trim()}</span>.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/70 border-y">
              {filteredMemories.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  onEdit={() => setMemoryDialog(memory)}
                />
              ))}
            </div>
          )}
        </div>
      </SettingsSection>

      {memoryDialog !== undefined && (
        <MemoryDialog
          key={memoryDialog?.id ?? "new-memory"}
          memory={memoryDialog}
          onOpenChange={(open) => {
            if (!open) setMemoryDialog(undefined);
          }}
        />
      )}
    </div>
  );
}

function ProfileEditor({
  personalization,
}: {
  personalization: Personalization;
}) {
  const updatePersonalization = useUpdatePersonalization();
  const [enabled, setEnabled] = useState(personalization.enabled);
  const [preferredName, setPreferredName] = useState(
    personalization.preferredName ?? "",
  );
  const [occupation, setOccupation] = useState(personalization.occupation ?? "");
  const [about, setAbout] = useState(personalization.about ?? "");
  const [error, setError] = useState("");
  const changed =
    enabled !== personalization.enabled ||
    preferredName.trim() !== (personalization.preferredName ?? "") ||
    occupation.trim() !== (personalization.occupation ?? "") ||
    about.trim() !== (personalization.about ?? "");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await updatePersonalization.mutateAsync({
        enabled,
        preferredName,
        occupation,
        about,
      });
      toast.success({ title: "Personalization saved" });
    } catch (cause) {
      setError(getErrorMessage(cause, "Failed to save personalization."));
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <SettingsSection
        title="About you"
        description="These fields can only be changed here. Empty fields are not added to model context."
      >
        <SettingsRow
          title="Use personalization"
          description="Include your profile and saved memories in chats, and allow models to manage memory when asked. Temporary chats never use personalization."
          htmlFor="personalization-enabled"
          align="center"
          controlAlign="end"
        >
          <Switch
            id="personalization-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </SettingsRow>
        <SettingsRow
          title="Preferred name"
          description="What should OvertChat call you?"
          htmlFor="preferred-name"
        >
          <Input
            id="preferred-name"
            maxLength={PREFERRED_NAME_MAX_LENGTH}
            value={preferredName}
            onChange={(event) => setPreferredName(event.target.value)}
            placeholder="Optional"
          />
        </SettingsRow>
        <SettingsRow title="Occupation" htmlFor="occupation">
          <Input
            id="occupation"
            maxLength={OCCUPATION_MAX_LENGTH}
            value={occupation}
            onChange={(event) => setOccupation(event.target.value)}
            placeholder="Optional"
          />
        </SettingsRow>
        <SettingsRow
          title="More about you"
          description="Interests, values, or preferences to keep in mind."
          htmlFor="about-user"
        >
          <Textarea
            id="about-user"
            maxLength={ABOUT_MAX_LENGTH}
            value={about}
            onChange={(event) => setAbout(event.target.value)}
            placeholder="Optional"
            className="min-h-28"
          />
        </SettingsRow>
      </SettingsSection>
      {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
      <SettingsActions bordered={false}>
        <Button
          type="submit"
          disabled={!changed || updatePersonalization.isPending}
        >
          {updatePersonalization.isPending ? "Saving…" : "Save"}
        </Button>
      </SettingsActions>
    </form>
  );
}

function MemoryCard({ memory, onEdit }: { memory: Memory; onEdit: () => void }) {
  return (
    <article className="group/memory flex items-start gap-3 py-4">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Brain className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-sm leading-5 text-foreground">
          {memory.value}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <code>{memory.key}</code>
          <span aria-hidden="true">·</span>
          <time dateTime={memory.updatedAt}>
            Updated {new Date(memory.updatedAt).toLocaleDateString()}
          </time>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onEdit}
          aria-label={`Edit ${memory.key}`}
          title="Edit memory"
        >
          <Pencil />
        </Button>
        <DeleteMemoryButton memory={memory} />
      </div>
    </article>
  );
}

function MemoryDialog({
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
              <Button
                type="submit"
                size="sm"
                disabled={pending || !changed}
              >
                {pending ? "Saving…" : memory ? "Save changes" : "Add memory"}
              </Button>
            </SettingsActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteMemoryButton({ memory }: { memory: Memory }) {
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

function ClearMemoriesButton({
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
          {error && <SettingsNotice tone="error" className="mt-3">{error}</SettingsNotice>}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button variant="ghost" />}>Cancel</AlertDialog.Close>
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
