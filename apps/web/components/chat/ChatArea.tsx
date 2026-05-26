"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { useSelectedModel } from "@/lib/config";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import { chatKeys } from "@/lib/queries/keys";
import type { ChatListItem } from "@/lib/queries/chats";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { useSpeech } from "@/lib/useSpeech";
import { authClient } from "@/lib/auth/client";
import {
  readMessageStats,
  readStoredMessageStats,
  writeStoredMessageStats,
  type StoredMessageStats,
} from "@/lib/chat/stats";
import { AdminOnboardingCard } from "@/components/AdminOnboardingCard";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
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
  const [storedStats, setStoredStats] = useState<StoredMessageStats>(() =>
    readStoredMessageStats(),
  );

  const isNewRef = useRef(isNew ?? false);

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
    onFinish: ({ message }) => {
      const stats = readMessageStats(message);
      if (stats && !temporaryRef.current) {
        setStoredStats((current) => {
          const next = { ...current, [message.id]: stats };
          writeStoredMessageStats(next);
          return next;
        });
      }
      if (temporaryRef.current) return;
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
      if (text) void requestTitle(text);
    }
    sendMessage({ text, files: attachments }, { body: requestBody() });
  }

  async function requestTitle(userText: string) {
    try {
      const r = await fetch(`/api/chats/${chatId}/title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelConfigId: selectedId,
          userText,
          projectId: projectId ?? null,
        }),
      });
      if (!r.ok) return;
      const { title } = (await r.json()) as { title: string };
      if (!title) return;
      document.title = title;
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (prev) =>
        prev?.map((c) => (c.id === chatId ? { ...c, title } : c)),
      );
    } catch (err) {
      console.error("[title]", err);
    }
  }

  function handleRegenerate(messageId: string) {
    if (streaming || !configured) return;
    regenerate({ messageId, body: requestBody() });
  }

  function handleRetry() {
    if (streaming || !configured) return;
    regenerate({ body: requestBody() });
  }

  function handleEdit(messageId: string, text: string) {
    if (streaming || !configured) return;
    sendMessage({ text, messageId }, { body: requestBody() });
  }

  const composer = (
    <Composer
      configured={configured}
      streaming={streaming}
      searchEnabled={searchEnabled}
      onToggleSearch={() => setSearchEnabled(!searchEnabled)}
      onSubmit={handleSubmit}
      onStop={handleStop}
      isAdmin={isAdmin}
    />
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ChatHeader
        models={models}
        selectedId={selectedId}
        onSelectModel={setSelectedId}
        showTempToggle={Boolean(isNew) && messages.length === 0}
        temporary={temporary}
        onToggleTemporary={() => setTemporary((t) => !t)}
      />

      <MiniSpeechPlayer speech={speech} />

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {showOnboarding ? (
            <AdminOnboardingCard
              modelCount={models?.length ?? 0}
              onDismiss={() => setOnboardingDismissed(true)}
            />
          ) : (
            <div className="w-full max-w-3xl">
              <h1 className="mb-10 text-center font-heading text-2xl font-semibold tracking-tight md:text-3xl">
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
