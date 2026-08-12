"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  Command,
  CornerUpRight,
  ImagePlus,
  ListEnd,
  Loader2,
  Pencil,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { agentSlashCommandQuery } from "@overtchat/agent-bridge";
import type {
  AgentPromptImage,
  AgentQueuedMessage,
  AgentSessionStats,
  AgentSlashCommand,
} from "@overtchat/agent-bridge";
import {
  AGENT_IMAGE_MEDIA_TYPES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
} from "@overtchat/agent-bridge";
import { getDataTransferFiles } from "@/lib/chat/attachments";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  type ChatAttachment,
  useChatAttachments,
} from "@/components/chat/useChatAttachments";
import { toast } from "@/components/ui/toast";
import { UsageIndicator } from "@/components/chat/UsageIndicator";
import {
  AgentComposerControls,
  type AgentComposerControlsProps,
} from "./AgentComposerControls";

function commandSource(source: AgentSlashCommand["source"]): string {
  const labels: Record<AgentSlashCommand["source"], string> = {
    builtin: "Built-in",
    extension: "Extension",
    prompt: "Prompt",
    skill: "Skill",
    custom: "Custom",
    mcp_prompt: "MCP prompt",
    file: "File",
  };
  return labels[source];
}

export function AgentComposer({
  providerLabel,
  commands,
  queuedMessages,
  supportsSteer,
  supportsImages,
  running,
  pending,
  stopping,
  disabled,
  controls,
  contextUsage,
  onSubmit,
  onStop,
  onEditQueued,
  onDeleteQueued,
  onSteerQueued,
  restoreDraftKey,
}: {
  providerLabel: string;
  commands: AgentSlashCommand[];
  queuedMessages: AgentQueuedMessage[];
  supportsSteer: boolean;
  supportsImages: boolean;
  running: boolean;
  pending: boolean;
  stopping: boolean;
  disabled: boolean;
  controls: AgentComposerControlsProps;
  contextUsage?: AgentSessionStats["contextUsage"];
  onSubmit: (
    message: string,
    images: AgentPromptImage[],
  ) => Promise<boolean>;
  onStop: () => void;
  onEditQueued: (id: string) => Promise<boolean>;
  onDeleteQueued: (id: string) => Promise<boolean>;
  onSteerQueued: (id: string) => Promise<boolean>;
  restoreDraftKey?: string;
}) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [dismissedDraft, setDismissedDraft] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    attachments,
    uploading,
    readyParts,
    addFiles,
    addReadyParts,
    removeAttachment,
    clearAttachments,
  } = useChatAttachments();
  const listboxId = useId();
  const optionIdPrefix = useId();
  const composerContextUsage =
    contextUsage?.tokens !== null && contextUsage?.tokens !== undefined
      ? {
          usedTokens: contextUsage.tokens,
          contextWindow: contextUsage.contextWindow,
        }
      : undefined;

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [input]);

  useEffect(() => {
    if (!restoreDraftKey) return;
    const draft = window.sessionStorage.getItem(restoreDraftKey);
    if (draft === null) return;
    window.sessionStorage.removeItem(restoreDraftKey);
    let focusFrame: number | undefined;
    const restoreFrame = requestAnimationFrame(() => {
      setInput((current) => current || draft);
      focusFrame = requestAnimationFrame(() => {
        const element = textareaRef.current;
        element?.focus({ preventScroll: true });
        element?.setSelectionRange(element.value.length, element.value.length);
      });
    });
    return () => {
      cancelAnimationFrame(restoreFrame);
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    };
  }, [restoreDraftKey]);

  const query = agentSlashCommandQuery(input);
  const filteredCommands = useMemo(() => {
    if (query === null) return [];
    if (!query) return commands;
    return commands.filter((command) =>
      [command.name, command.description ?? "", command.source]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [commands, query]);
  const menuOpen =
    query !== null &&
    input !== dismissedDraft &&
    filteredCommands.length > 0;
  const activeRow = Math.min(
    activeIndex,
    Math.max(0, filteredCommands.length - 1),
  );

  function selectCommand(command: AgentSlashCommand) {
    if (
      command.source === "builtin" &&
      !command.argumentHint &&
      !pending &&
      !disabled
    ) {
      void submitMessage(`/${command.name}`, []);
      return;
    }

    setInput(`/${command.name} `);
    setDismissedDraft(null);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      element?.focus({ preventScroll: true });
      element?.setSelectionRange(element.value.length, element.value.length);
    });
  }

  async function submitMessage(
    message: string,
    images: AgentPromptImage[],
  ) {
    if (
      (!message && images.length === 0) ||
      pending ||
      submittingRef.current ||
      disabled
    )
      return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const accepted = await onSubmit(message, images);
      if (!accepted) return;
      setInput("");
      clearAttachments();
      setDismissedDraft(null);
      setActiveIndex(0);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function submit() {
    const message = input.trim();
    const prefix = "/api/uploads/";
    const images = readyParts.flatMap((part) =>
      part.url.startsWith(prefix) &&
      AGENT_IMAGE_MEDIA_TYPES.includes(
        part.mediaType as AgentPromptImage["mediaType"],
      )
        ? [
            {
              uploadId: part.url.slice(prefix.length),
              filename: part.filename || "image",
              mediaType: part.mediaType as AgentPromptImage["mediaType"],
            },
          ]
        : [],
    );
    void submitMessage(message, images);
  }

  function addImageFiles(files: readonly File[]) {
    const images = files.filter((file) =>
      AGENT_IMAGE_MEDIA_TYPES.includes(
        file.type as AgentPromptImage["mediaType"],
      ),
    );
    if (images.length === 0) {
      if (files.some((file) => file.type.startsWith("image/"))) {
        toast.error({ title: "Use PNG, JPEG, GIF, or WebP images" });
      }
      return;
    }
    if (!supportsImages) {
      toast.error({ title: "The selected model does not support images" });
      return;
    }
    const available = Math.max(0, MAX_AGENT_IMAGES - attachments.length);
    if (available === 0) {
      toast.error({ title: `Attach up to ${MAX_AGENT_IMAGES} images` });
      return;
    }
    let totalBytes = attachments.reduce(
      (total, attachment) => total + (attachment.meta?.size ?? 0),
      0,
    );
    const accepted = images.slice(0, available).filter((file) => {
      if (file.size > MAX_AGENT_IMAGE_BYTES) {
        toast.error({ title: `${file.name || "Image"} exceeds 10MB` });
        return false;
      }
      if (totalBytes + file.size > MAX_AGENT_IMAGE_TOTAL_BYTES) {
        toast.error({ title: "Image attachments must total 20MB or less" });
        return false;
      }
      totalBytes += file.size;
      return true;
    });
    if (images.length > available) {
      toast.error({ title: `Attach up to ${MAX_AGENT_IMAGES} images` });
    }
    addFiles(accepted);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = getDataTransferFiles(event.clipboardData);
    if (!files.some((file) => file.type.startsWith("image/"))) return;
    event.preventDefault();
    addImageFiles(files);
  }

  async function editQueuedMessage(message: AgentQueuedMessage) {
    if (
      pending ||
      submittingRef.current ||
      disabled ||
      input.trim() ||
      attachments.length > 0
    )
      return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const accepted = await onEditQueued(message.id);
      if (!accepted) return;
      setInput(message.message);
      addReadyParts(
        (message.images ?? []).map((image) => ({
          type: "file",
          url: `/api/uploads/${image.uploadId}`,
          mediaType: image.mediaType,
          filename: image.filename,
        })),
      );
      requestAnimationFrame(() => textareaRef.current?.focus());
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function steerQueuedMessage(id: string) {
    if (pending || submittingRef.current || disabled) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSteerQueued(id);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function deleteQueuedMessage(id: string) {
    if (pending || submittingRef.current || disabled) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onDeleteQueued(id);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (menuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedDraft(input);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex(
          (activeRow + delta + filteredCommands.length) %
            filteredCommands.length,
        );
        return;
      }
      if (
        (event.key === "Enter" && !event.shiftKey) ||
        (event.key === "Tab" && !event.shiftKey)
      ) {
        event.preventDefault();
        selectCommand(filteredCommands[activeRow]);
        return;
      }
    }
    if (event.key === "Escape" && running) {
      event.preventDefault();
      onStop();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="relative @container" data-testid="agent-composer">
      {menuOpen && (
        <div
          className={cn(
            "absolute bottom-full left-0 z-30 mb-2 w-full max-w-lg overflow-hidden rounded-xl border bg-popover text-sm text-popover-foreground shadow-md",
            motionClasses.palette,
          )}
        >
          <div
            id={listboxId}
            role="listbox"
            aria-label={`${providerLabel} commands`}
            className="max-h-72 overflow-y-auto p-1.5"
          >
            {filteredCommands.map((command, index) => (
              <button
                key={`${command.source}:${command.name}`}
                id={`${optionIdPrefix}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeRow}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => selectCommand(command)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left motion-colors",
                  index === activeRow && "bg-accent text-accent-foreground",
                )}
              >
                <Command className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    /{command.name}
                    {command.argumentHint && (
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {command.argumentHint}
                      </span>
                    )}
                  </span>
                  {command.description && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {command.description}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {commandSource(command.source)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {queuedMessages.length > 0 && (
        <section
          aria-label="Pending messages"
          className="mx-3 mb-2 max-h-44 space-y-2 overflow-y-auto"
        >
          {queuedMessages.map((queuedMessage) => {
            const sending = queuedMessage.status === "sending";
            const uncertain = queuedMessage.status === "uncertain";
            const imageCount = queuedMessage.images?.length ?? 0;
            return (
              <article
                key={queuedMessage.id}
                className="flex min-h-12 min-w-0 flex-wrap items-center gap-2 rounded-xl border bg-background px-3 py-2 text-xs shadow-sm @2xl:flex-nowrap"
              >
                {sending ? (
                  <Loader2
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground",
                      motionClasses.spinner,
                    )}
                  />
                ) : (
                  <ListEnd className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className="line-clamp-2 whitespace-pre-wrap text-foreground"
                    title={queuedMessage.message}
                  >
                    {queuedMessage.message ||
                      `${imageCount} attached ${imageCount === 1 ? "image" : "images"}`}
                  </p>
                  <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                    {uncertain
                      ? "Delivery unknown — inspect the session before resending"
                      : sending
                        ? "Sending"
                        : "Queued"}
                    {imageCount > 0
                      ? ` · ${imageCount} ${imageCount === 1 ? "image" : "images"}`
                      : ""}
                  </p>
                </div>
                {!sending && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 rounded-md"
                      disabled={
                        pending ||
                        submitting ||
                        disabled ||
                        Boolean(input.trim()) ||
                        attachments.length > 0
                      }
                      onClick={() => void editQueuedMessage(queuedMessage)}
                      aria-label="Edit queued message"
                      title={
                        input.trim() || attachments.length > 0
                          ? "Clear the current draft before editing"
                          : "Edit queued message"
                      }
                    >
                      <Pencil />
                    </Button>
                    {supportsSteer && running && !uncertain && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-md px-2 text-xs"
                        disabled={pending || submitting || disabled}
                        onClick={() =>
                          void steerQueuedMessage(queuedMessage.id)
                        }
                        aria-label="Steer with queued message"
                        title={`Add this message to the active ${providerLabel} turn`}
                      >
                        <CornerUpRight />
                        Steer
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 rounded-md text-muted-foreground hover:text-destructive"
                      disabled={pending || submitting || disabled}
                      onClick={() =>
                        void deleteQueuedMessage(queuedMessage.id)
                      }
                      aria-label="Delete queued message"
                      title="Delete queued message"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      <div className="relative flex flex-col gap-2 rounded-3xl border bg-background px-3.5 pt-3.5 pb-2.5 shadow-sm motion-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
        {attachments.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-1">
            {attachments.map((attachment) => (
              <AgentImageChip
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.id)}
              />
            ))}
          </div>
        )}
        <Textarea
          ref={textareaRef}
          rows={1}
          value={input}
          disabled={disabled || pending || submitting}
          placeholder={`Message ${providerLabel} or type / for commands`}
          className="max-h-48 min-h-10 resize-none border-0 bg-transparent px-1 py-0 shadow-none focus-visible:ring-0 md:text-sm dark:bg-transparent"
          onChange={(event) => {
            setInput(event.target.value);
            setDismissedDraft(null);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          role="combobox"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? listboxId : undefined}
          aria-activedescendant={
            menuOpen ? `${optionIdPrefix}-${activeRow}` : undefined
          }
          aria-autocomplete="list"
        />
        <div className="flex min-h-10 items-center gap-1 @2xl:min-h-8">
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            {supportsImages && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={AGENT_IMAGE_MEDIA_TYPES.join(",")}
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addImageFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full"
                  disabled={pending || submitting || uploading || disabled}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach images"
                  title="Attach images"
                >
                  <ImagePlus />
                </Button>
              </>
            )}
            <AgentComposerControls {...controls} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {composerContextUsage && (
              <>
                <UsageIndicator
                  contextUsage={composerContextUsage}
                  compact
                  side="top"
                  className="@2xl:hidden"
                />
                <UsageIndicator
                  contextUsage={composerContextUsage}
                  side="top"
                  className="hidden @2xl:inline-flex"
                />
              </>
            )}
            {running && (
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                className="rounded-full"
                disabled={pending || submitting}
                onClick={onStop}
                aria-label={`${stopping ? "Stopping" : "Stop"} ${providerLabel}`}
                title={`${stopping ? "Stopping" : "Stop"} ${providerLabel}`}
              >
                {stopping ? (
                  <Loader2 className={cn("size-3.5", motionClasses.spinner)} />
                ) : (
                  <Square className="size-3 fill-current" />
                )}
              </Button>
            )}
            <Button
              type="button"
              size="icon-sm"
              className="rounded-full"
              disabled={
                (!input.trim() && readyParts.length === 0) ||
                uploading ||
                pending ||
                submitting ||
                disabled
              }
              onClick={submit}
              aria-label={
                running ? `Queue message for ${providerLabel}` : "Send message"
              }
              title={
                running
                  ? `Queue after ${providerLabel} finishes`
                  : "Send message"
              }
            >
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentImageChip({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove: () => void;
}) {
  const src = attachment.previewUrl ?? attachment.part?.url;
  return (
    <div className="relative size-16 shrink-0 overflow-hidden rounded-lg border bg-muted">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={attachment.filename}
          className="size-full object-cover"
        />
      )}
      {attachment.status === "uploading" && (
        <span className="absolute inset-0 flex items-center justify-center bg-background/60">
          <Loader2 className={cn("size-4", motionClasses.spinner)} />
        </span>
      )}
      {attachment.status === "error" && (
        <span
          className="absolute inset-0 flex items-center justify-center bg-destructive/10 px-1 text-center text-[10px] text-destructive"
          title={attachment.error}
        >
          Upload failed
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.filename}`}
        className="absolute top-1 right-1 rounded-full bg-foreground/70 p-0.5 text-background"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
