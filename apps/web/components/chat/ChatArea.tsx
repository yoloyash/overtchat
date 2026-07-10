"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { FileUp } from "lucide-react";
import { useSelectedModel } from "@/lib/config";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import { chatKeys } from "@/lib/queries/keys";
import { useChats, type ChatListItem } from "@/lib/queries/chats";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { useSpeech } from "@/lib/useSpeech";
import { authClient } from "@/lib/auth/client";
import {
  readMessageStats,
  readStoredMessageStats,
  writeStoredMessageStats,
  type StoredMessageStats,
} from "@/lib/chat/stats";
import {
  getDataTransferFiles,
  hasDataTransferFiles,
} from "@/lib/chat/attachments";
import { AdminOnboardingCard } from "@/components/AdminOnboardingCard";
import { ChatHeader } from "./ChatHeader";
import { Composer, type ComposerHandle } from "./Composer";
import { MessageList } from "./MessageList";
import { MiniSpeechPlayer } from "./MiniSpeechPlayer";

const SEARCH_STORAGE_KEY = "overtchat_search_enabled";
const STATS_FOR_NERDS_STORAGE_KEY = "overtchat_stats_for_nerds";

interface Props {
  chatId: string;
  initialMessages?: UIMessage[];
  isNew?: boolean;
  projectId?: string | null;
}

export function ChatArea({ chatId, initialMessages, isNew, projectId }: Props) {
  const qc = useQueryClient();
  const { data: chats } = useChats();

  const { data: modelsData, isError: modelsError } = useModelConfigs();
  const models = modelsError ? [] : modelsData ?? null;
  const [selectedId, setSelectedId] = useSelectedModel();

  useEffect(() => {
    if (!models || models.length === 0) return;
    if (!models.some((m) => m.id === selectedId)) {
      setSelectedId(models[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  const configured = (models?.length ?? 0) > 0 && Boolean(selectedId);

  const [searchEnabled, setSearchEnabled] = useLocalStorage<boolean>(
    SEARCH_STORAGE_KEY,
    false,
  );
  const [statsForNerds] = useLocalStorage<boolean>(
    STATS_FOR_NERDS_STORAGE_KEY,
    false,
  );

  const [temporary, setTemporary] = useState(false);
  useEffect(() => {
    if (temporary) {
      document.title = "overtchat";
      return;
    }
    document.title =
      chats?.find((chat) => chat.id === chatId)?.title?.trim() || "overtchat";
  }, [chatId, chats, temporary]);

  const [storedStats, setStoredStats] = useState<StoredMessageStats>(() =>
    readStoredMessageStats(),
  );
  const [dragDepth, setDragDepth] = useState(0);

  const isNewRef = useRef(isNew ?? false);
  const composerRef = useRef<ComposerHandle>(null);

  const [transport] = useState(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, body, trigger, messageId }) => ({
          body: { ...body, messages, trigger, messageId },
        }),
      }),
  );

  const temporaryRef = useRef(false);
  useEffect(() => {
    temporaryRef.current = temporary;
  }, [temporary]);

  const { messages, sendMessage, regenerate, status, stop, error } = useChat({
    id: temporary ? undefined : chatId,
    resume: !temporary && !isNew,
    transport,
    messages: initialMessages,
    onFinish: ({ message, isAbort, isError }) => {
      const stats = readMessageStats(message);
      if (stats && !temporaryRef.current) {
        setStoredStats((current) => {
          const next = { ...current, [message.id]: stats };
          writeStoredMessageStats(next);
          return next;
        });
      }
      if (temporaryRef.current) return;
      if (isAbort || isError) return;
      qc.invalidateQueries({ queryKey: chatKeys.list() });
    },
  });

  const speech = useSpeech();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user.role === "admin";
  const [onboardingDismissed, setOnboardingDismissed] = useLocalStorage<boolean>(
    "overtchat_onboarding_dismissed",
    false,
  );
  const showOnboarding =
    isAdmin &&
    !temporary &&
    !configured &&
    !onboardingDismissed &&
    models !== null;

  const requestBody = () => ({
    modelConfigId: selectedId,
    searchEnabled,
    chatId,
    projectId: projectId ?? null,
    temporary,
  });

  const streaming = status === "streaming" || status === "submitted";
  const dropActive = dragDepth > 0;

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!hasDataTransferFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragDepth((depth) => depth + 1);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!hasDataTransferFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!hasDataTransferFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragDepth((depth) => Math.max(0, depth - 1));
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!hasDataTransferFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragDepth(0);
    const files = getDataTransferFiles(e.dataTransfer);
    if (files.length > 0) composerRef.current?.addFiles(files);
  }

  function handleStop() {
    stop();
    if (!temporary) {
      void fetch(`/api/chat/${chatId}/stream/cancel`, { method: "POST" });
    }
  }

  function handleSubmit(text: string, attachments: FileUIPart[]) {
    const wasNew = isNewRef.current && !temporary;
    if (wasNew) {
      isNewRef.current = false;
      window.history.replaceState(null, "", `/chat/${chatId}`);
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (prev) => {
        const next: ChatListItem = {
          id: chatId,
          title: null,
          projectId: projectId ?? null,
          updatedAt: Date.now(),
        };
        if (!prev) return [next];
        if (prev.some((c) => c.id === chatId)) return prev;
        return [next, ...prev];
      });
    }
    sendMessage({ text, files: attachments }, { body: requestBody() });
  }

  function handleRegenerate(messageId: string) {
    if (streaming || !configured) return;
    regenerate({ messageId, body: requestBody() });
  }

  function handleRetry() {
    if (streaming || !configured) return;
    regenerate({ body: requestBody() });
  }

  function handleEdit(messageId: string, text: string, files: FileUIPart[]) {
    if (streaming || !configured) return;
    sendMessage({ text, files, messageId }, { body: requestBody() });
  }

  const composer = (
    <Composer
      ref={composerRef}
      configured={configured}
      streaming={streaming}
      searchEnabled={searchEnabled}
      dropActive={dropActive}
      onToggleSearch={() => setSearchEnabled(!searchEnabled)}
      onSubmit={handleSubmit}
      onStop={handleStop}
      isAdmin={isAdmin}
    />
  );

  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ChatHeader
        models={models}
        selectedId={selectedId}
        onSelectModel={setSelectedId}
        showTempToggle={Boolean(isNew) && messages.length === 0}
        temporary={temporary}
        onToggleTemporary={() => setTemporary((t) => !t)}
      />

      <MiniSpeechPlayer speech={speech} />

      {dropActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/70 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ring bg-background/90 px-8 py-6 text-center shadow-lg ring-1 ring-ring/20">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm animate-in zoom-in-95">
              <FileUp className="size-6" />
            </div>
            <div>
              <div className="text-sm font-medium">Drop files to attach</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Images, PDFs, docs, spreadsheets, and text files
              </div>
            </div>
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {showOnboarding ? (
            <AdminOnboardingCard
              modelCount={models?.length ?? 0}
              onDismiss={() => setOnboardingDismissed(true)}
            />
          ) : (
            <div className="w-full max-w-3xl">
              <h1 className="mb-10 text-center text-2xl font-semibold tracking-tight md:text-3xl">
                {temporary ? "Temporary chat" : "What can I help with?"}
              </h1>
              {!configured && (
                <p className="mb-6 text-center text-sm text-muted-foreground">
                  No models configured yet. An admin needs to add one in Settings → Models.
                </p>
              )}
              {configured && temporary && (
                <p className="mb-6 text-center text-sm text-muted-foreground">
                  {"Messages won't be saved to your history."}
                </p>
              )}
              {composer}
            </div>
          )}
        </div>
      ) : (
        <>
          <MessageList
            messages={messages}
            streaming={streaming}
            status={status}
            error={error}
            configured={configured}
            speech={speech}
            showStats={statsForNerds}
            storedStats={storedStats}
            onRegenerate={handleRegenerate}
            onEdit={handleEdit}
            onRetry={handleRetry}
          />

          <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-3xl">{composer}</div>
          </div>
        </>
      )}
    </div>
  );
}
