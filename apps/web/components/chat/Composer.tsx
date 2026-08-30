"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FileUIPart } from "ai";
import {
  AlertCircle,
  AudioLines,
  ArrowUp,
  Check,
  Cpu,
  Ghost,
  Globe,
  Loader2,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ATTACH_ACCEPT,
  formatSize,
  getDataTransferFiles,
} from "@/lib/chat/attachments";
import { dictationErrorMessage } from "@/lib/chat/message";
import { motionClasses } from "@/lib/motion";
import { useDictation } from "@/lib/useDictation";
import {
  filterSlashCommandModels,
  filterSlashCommands,
  isSlashCommandAvailable,
  parseSlashCommandQuery,
  resolveSlashCommand,
  type SlashCommand,
} from "@/lib/chat/slash-commands";
import type { PublicModelConfig } from "@/lib/model-config/schema";
import { CategoryIcon } from "./attachment-icons";
import {
  SlashCommandMenu,
  toSlashCommandModelRows,
  toSlashCommandRows,
  type SlashCommandRow,
} from "./SlashCommandMenu";
import {
  type ChatAttachment,
  useChatAttachments,
} from "./useChatAttachments";

export interface ComposerHandle {
  addFiles: (files: readonly File[]) => void;
  focus: (options?: FocusOptions) => void;
}

/**
 * Commands the composer owns itself (attach, dictate) are appended by the
 * composer; everything that mutates chat-level state is declared by `ChatArea`.
 */
export interface ComposerCommandActions {
  /** Runs `/temporary`; omitted once the chat has messages. */
  temporary?: { active: boolean; onToggle: () => void };
  onNewChat: () => void;
  onSearchChats: () => void;
  onOpenSettings: () => void;
  onSelectModel: (modelId: string) => void;
}

interface ComposerProps {
  configured: boolean;
  streaming: boolean;
  searchAvailable: boolean;
  searchUnavailableReason: string;
  searchRequested: boolean;
  dropActive: boolean;
  models: PublicModelConfig[] | null;
  selectedModelId: string;
  voiceInstalled: boolean;
  voiceEligible: boolean;
  voiceAvailable: boolean;
  voiceActive: boolean;
  voiceUnavailableReason: string;
  attachmentsEnabled: boolean;
  textInputDisabled: boolean;
  commandActions: ComposerCommandActions;
  onToggleSearch: () => void;
  onSubmit: (input: string, attachments: FileUIPart[]) => void;
  onStop: () => void;
  onStartVoice: () => void;
  onEndVoice: () => void;
  isAdmin: boolean;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({
  configured,
  streaming,
  searchAvailable,
  searchUnavailableReason,
  searchRequested,
  dropActive,
  models,
  selectedModelId,
  voiceInstalled,
  voiceEligible,
  voiceAvailable,
  voiceActive,
  voiceUnavailableReason,
  attachmentsEnabled,
  textInputDisabled,
  commandActions,
  onToggleSearch,
  onSubmit,
  onStop,
  onStartVoice,
  onEndVoice,
  isAdmin,
}, ref) {
  const [input, setInput] = useState("");
  const {
    attachments,
    uploading,
    readyParts,
    addFiles,
    removeAttachment,
    clearAttachments,
  } = useChatAttachments();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      addFiles(files) {
        addFiles(files);
        setTimeout(
          () => textareaRef.current?.focus({ preventScroll: true }),
          0,
        );
      },
      focus(options) {
        textareaRef.current?.focus(options);
      },
    }),
    [addFiles],
  );

  const dictation = useDictation((text) => {
    setInput((prev) => {
      const trimmed = prev.trimEnd();
      if (!trimmed) return text;
      return `${trimmed} ${text}`;
    });
    setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 0);
  });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  function startDictation() {
    if (dictation.status === "idle") void dictation.start();
  }

  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const optionIdPrefix = useId();

  const commands = useMemo<SlashCommand[]>(() => {
    const list: SlashCommand[] = [
      {
        name: "search",
        title: "Web search",
        description: "Search the web for this message",
        group: "actions",
        icon: Globe,
        keywords: ["web", "browse"],
        toggle: {
          active: searchRequested,
          unavailableReason: searchAvailable
            ? undefined
            : searchUnavailableReason,
        },
        run: onToggleSearch,
      },
      {
        name: "attach",
        title: "Add photos & files",
        description: "Upload from your device",
        group: "actions",
        icon: Paperclip,
        keywords: ["file", "upload", "image", "photo", "pdf"],
        action: "attach",
      },
      {
        name: "dictate",
        title: "Dictate",
        description: "Record and transcribe speech",
        group: "actions",
        icon: Mic,
        keywords: ["voice", "speak", "microphone", "transcribe"],
        action: "dictate",
      },
    ];

    if (commandActions.temporary) {
      list.push({
        name: "temporary",
        title: "Temporary chat",
        description: "Chat without saving to history",
        group: "actions",
        icon: Ghost,
        keywords: ["incognito", "private", "unsaved"],
        toggle: { active: commandActions.temporary.active },
        run: commandActions.temporary.onToggle,
      });
    }

    list.push(
      {
        name: "model",
        title: "Switch model",
        description: "Choose which model answers",
        group: "actions",
        icon: Cpu,
        keywords: ["models", "switch"],
        submenu: "model",
      },
      {
        name: "new",
        title: "New chat",
        description: "Start a fresh conversation",
        group: "navigate",
        icon: Pencil,
        shortcut: ["Ctrl", "Shift", "O"],
        run: commandActions.onNewChat,
      },
      {
        name: "chats",
        title: "Search chats",
        description: "Find an earlier conversation",
        group: "navigate",
        icon: Search,
        keywords: ["history", "find"],
        shortcut: ["Ctrl", "K"],
        run: commandActions.onSearchChats,
      },
      {
        name: "settings",
        title: "Settings",
        description: "Models, tools, and preferences",
        group: "navigate",
        icon: Settings2,
        keywords: ["preferences", "config"],
        run: commandActions.onOpenSettings,
      },
    );

    return list;
  }, [
    commandActions,
    searchAvailable,
    searchRequested,
    searchUnavailableReason,
    onToggleSearch,
  ]);

  const query = parseSlashCommandQuery(input);
  const exactCommand = query
    ? (commands.find((command) => command.name === query.name) ?? null)
    : null;
  // `/model foo` filters the model list; any other command with an argument is
  // a finished invocation, so the menu closes.
  const submenu = query?.hasArgument ? exactCommand?.submenu ?? null : null;

  const commandQuery = query && !submenu ? query.name : null;
  const filteredCommands = useMemo(
    () =>
      commandQuery === null ? [] : filterSlashCommands(commands, commandQuery),
    [commands, commandQuery],
  );
  const submenuModels = useMemo(
    () =>
      submenu === "model"
        ? filterSlashCommandModels(models ?? [], query?.argument ?? "")
        : null,
    [models, query?.argument, submenu],
  );

  const rows = submenuModels
    ? toSlashCommandModelRows(submenuModels)
    : toSlashCommandRows(filteredCommands);
  const menuOpen =
    query !== null &&
    input !== dismissedQuery &&
    (submenu !== null || !query.hasArgument);
  // Filtering shrinks the list under the cursor, so clamp on read rather than
  // syncing an effect against the row count.
  const activeRow = Math.min(activeIndex, Math.max(0, rows.length - 1));

  function closeMenu() {
    setDismissedQuery(input);
    setActiveIndex(0);
  }

  function replaceDraft(next: string) {
    setInput(next);
    setDismissedQuery(null);
    setActiveIndex(0);
    textareaRef.current?.focus({ preventScroll: true });
  }

  function runCommand(command: SlashCommand) {
    if (!isSlashCommandAvailable(command)) return;
    if (command.submenu) {
      replaceDraft(`/${command.name} `);
      return;
    }
    // Clear the draft before running: navigation unmounts the composer, and a
    // toggle should leave an empty box ready for the real message.
    replaceDraft("");
    if (command.action === "attach") fileInputRef.current?.click();
    else if (command.action === "dictate") startDictation();
    else command.run?.();
  }

  function selectRow(row: SlashCommandRow) {
    if (row.kind === "model") {
      replaceDraft("");
      commandActions.onSelectModel(row.model.id);
      return;
    }
    runCommand(row.command);
  }

  /** Returns true when the menu consumed the key. */
  function handleMenuKeyDown(
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ): boolean {
    if (!query) return false;

    if (e.key === "Escape" && menuOpen) {
      e.preventDefault();
      // Back out of the submenu one level before closing the menu.
      if (submenu) replaceDraft(`/${query.name}`);
      else closeMenu();
      return true;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      if (menuOpen && rows.length > 0) {
        e.preventDefault();
        selectRow(rows[activeRow]);
        return true;
      }
      // With the menu closed, a fully typed command still runs on Enter instead
      // of sending "/temporary" as a message.
      if (!submenu) {
        const command = resolveSlashCommand(commands, query);
        if (command && isSlashCommandAvailable(command) && !command.submenu) {
          e.preventDefault();
          runCommand(command);
          return true;
        }
      }
      return false;
    }

    if (!menuOpen || rows.length === 0) return false;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((activeRow + delta + rows.length) % rows.length);
      return true;
    }

    if (e.key === "Tab" && !e.shiftKey && !submenu) {
      e.preventDefault();
      const command = filteredCommands[activeRow];
      if (command) replaceDraft(`/${command.name}${command.submenu ? " " : ""}`);
      return true;
    }

    return false;
  }

  function submit() {
    const text = input.trim();
    if (streaming || uploading || textInputDisabled) return;
    if (!text && readyParts.length === 0) return;
    if (!configured) return;
    onSubmit(text, readyParts);
    setInput("");
    setDismissedQuery(null);
    setActiveIndex(0);
    clearAttachments();
  }

  function handleFiles(files: FileList | null) {
    if (!attachmentsEnabled || !files || files.length === 0) return;
    addFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (handleMenuKeyDown(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!attachmentsEnabled) return;
    const files = getDataTransferFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  }

  return (
    <>
      {dictation.error && (
        <p className="mb-2 text-sm text-destructive">
          {dictationErrorMessage(dictation.error, isAdmin)}
        </p>
      )}
      <div className="relative">
        {menuOpen && query && (
          <SlashCommandMenu
            id={listboxId}
            optionIdPrefix={optionIdPrefix}
            commands={filteredCommands}
            models={submenuModels}
            selectedModelId={selectedModelId}
            activeIndex={activeRow}
            query={query.name}
            onActiveIndexChange={setActiveIndex}
            onSelect={selectRow}
          />
        )}
        <div
          className={cn(
            "flex flex-col gap-2 rounded-3xl border bg-background px-3.5 pt-3.5 pb-2.5 shadow-sm motion-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring",
            dropActive && "border-ring bg-accent/20 ring-2 ring-ring/30",
          )}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1 pt-1">
              {attachments.map((att) => (
                <AttachmentChip
                  key={att.id}
                  attachment={att}
                  onRemove={() => removeAttachment(att.id)}
                />
              ))}
            </div>
          )}
          <Textarea
            ref={textareaRef}
            rows={1}
            placeholder={
              textInputDisabled
                ? "Resume voice to continue"
                : configured
                  ? "Message… or / for commands"
                  : "No models configured"
            }
            className="max-h-48 min-h-10 resize-none border-0 bg-transparent px-1 py-0 shadow-none focus-visible:ring-0 md:text-sm dark:bg-transparent"
            value={input}
            disabled={textInputDisabled}
            onChange={(e) => {
              setInput(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            // The textarea stays focused and owns the keyboard; the menu below is
            // the listbox it controls.
            role="combobox"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? listboxId : undefined}
            aria-activedescendant={
              menuOpen && rows.length > 0
                ? `${optionIdPrefix}-${activeRow}`
                : undefined
            }
            aria-autocomplete="list"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept={ATTACH_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
              />
              <Menu.Root>
                <Menu.Trigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-full"
                      aria-label="Add to message"
                      disabled={!attachmentsEnabled && !searchAvailable}
                    />
                  }
                >
                  <Plus />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner side="top" align="start" sideOffset={8}>
                    <Menu.Popup
                      className={cn(
                        "z-50 w-72 rounded-xl border bg-popover p-1.5 text-sm text-popover-foreground shadow-md outline-none",
                        motionClasses.popup,
                      )}
                    >
                      <Menu.Item
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading || !attachmentsEnabled}
                        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                      >
                        <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">
                            Add photos &amp; files
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            Upload from your device
                          </span>
                        </span>
                      </Menu.Item>
                      <Menu.CheckboxItem
                        checked={searchRequested}
                        onCheckedChange={onToggleSearch}
                        closeOnClick
                        disabled={!searchAvailable}
                        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 outline-none motion-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                      >
                        <Globe className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">Web search</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {searchAvailable
                              ? "Always search for this message"
                              : searchUnavailableReason}
                          </span>
                        </span>
                        <span className="flex size-4 shrink-0 items-center justify-center">
                          {searchRequested ? <Check className="size-3.5" /> : null}
                        </span>
                      </Menu.CheckboxItem>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
              {searchRequested && (
                <button
                  type="button"
                  onClick={onToggleSearch}
                  className="flex h-7 items-center gap-1.5 rounded-full bg-accent px-2.5 text-xs font-medium text-accent-foreground outline-none motion-colors hover:bg-accent/80 focus-visible:ring-3 focus-visible:ring-ring/50 max-md:h-10 max-md:px-3"
                  aria-label="Remove Web search from this message"
                >
                  <Globe className="size-3.5" />
                  <span>Web search</span>
                  <X className="size-3" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "rounded-full",
                  dictation.status === "recording" &&
                    "bg-destructive text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground",
                )}
                onClick={() => {
                  if (dictation.status === "recording") {
                    dictation.stop();
                  } else if (dictation.status === "idle") {
                    void dictation.start();
                  }
                }}
                disabled={dictation.status === "transcribing" || voiceActive}
                aria-label={
                  dictation.status === "recording"
                    ? "Stop dictation"
                    : dictation.status === "transcribing"
                      ? "Transcribing"
                      : "Dictate"
                }
                aria-pressed={dictation.status === "recording"}
              >
                {dictation.status === "transcribing" ? (
                  <Loader2 className={motionClasses.spinner} />
                ) : dictation.status === "recording" ? (
                  <Square className="size-3 fill-current" />
                ) : (
                  <Mic />
                )}
              </Button>
              {streaming ? (
                <Button
                  size="icon-sm"
                  variant="secondary"
                  className="shrink-0 rounded-full"
                  onClick={onStop}
                  aria-label="Stop generating"
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : voiceActive && !input.trim() && readyParts.length === 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  className="shrink-0 rounded-full"
                  onClick={onEndVoice}
                  aria-label="End voice session"
                >
                  <X />
                </Button>
              ) : voiceInstalled &&
                voiceEligible &&
                !input.trim() &&
                readyParts.length === 0 ? (
                <Button
                  type="button"
                  variant="default"
                  size="icon-sm"
                  className="shrink-0 rounded-full"
                  onClick={onStartVoice}
                  disabled={!voiceAvailable}
                  aria-label="Start voice conversation"
                  title={
                    voiceAvailable ? "Voice conversation" : voiceUnavailableReason
                  }
                >
                  <AudioLines />
                </Button>
              ) : (
                <Button
                  size="icon-sm"
                  className="shrink-0 rounded-full"
                  disabled={
                    uploading ||
                    (!input.trim() &&
                      readyParts.length === 0)
                  }
                  onClick={submit}
                  aria-label="Send message"
                >
                  {uploading ? <Loader2 className={motionClasses.spinner} /> : <ArrowUp />}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
});

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove: () => void;
}) {
  const { status, meta, part } = attachment;
  const label = attachment.filename;
  const isImage =
    meta?.category === "image" ||
    Boolean(attachment.previewUrl) ||
    attachment.mediaType.startsWith("image/");
  const removeButton = (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${label}`}
      className="absolute top-0.5 right-0.5 rounded-full bg-foreground/70 p-0.5 text-background shadow-sm motion-colors hover:bg-foreground max-md:p-1"
    >
      <X className="size-3" />
    </button>
  );

  // Images render as a thumbnail while uploading/ready. On failure we fall back
  // to the row chip below so the actual error reason has room to show.
  if (isImage && status !== "error") {
    const src = attachment.previewUrl ?? part?.url;
    return (
      <div className="group/chip relative h-16 w-16 overflow-hidden rounded-lg border bg-muted">
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className="size-full object-cover" />
        )}
        {status === "uploading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50">
            <Loader2 className={`size-4 text-foreground ${motionClasses.spinner}`} />
          </div>
        )}
        {removeButton}
      </div>
    );
  }

  const sub =
    status === "error"
      ? (attachment.error ?? "Upload failed")
      : [
          meta?.pageCount ? `${meta.pageCount} pages` : null,
          meta?.size != null ? formatSize(meta.size) : null,
          meta?.truncated ? "truncated" : null,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <div
      className={cn(
        "group/chip relative flex items-center gap-2 rounded-lg border bg-muted/40 py-2 pr-8 pl-2 max-w-[18rem]",
        status === "error" && "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        {status === "uploading" ? (
          <Loader2 className={`size-4 ${motionClasses.spinner}`} />
        ) : status === "error" ? (
          <AlertCircle className="size-4 text-destructive" />
        ) : (
          <CategoryIcon category={meta?.category} className="size-4" />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium">{label}</div>
        {sub && (
          <div
            className={cn(
              "truncate text-[11px] text-muted-foreground",
              status === "error" && "text-destructive",
            )}
            title={status === "error" ? sub : undefined}
          >
            {sub}
          </div>
        )}
      </div>
      {removeButton}
    </div>
  );
}
