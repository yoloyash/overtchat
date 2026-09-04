"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import {
  hasSuccessfulMemoryMutation,
  modelSupportsToolCalling,
  type ChatKind,
  type ChatRequestAction,
  type VoiceHistoryItem,
} from "@overtchat/shared";
import { FileUp } from "lucide-react";
import { useSelectedModel } from "@/lib/model-config/client";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import {
  activityKeys,
  chatKeys,
  personalizationKeys,
} from "@/lib/queries/keys";
import { usePublicCapabilities } from "@/lib/queries/capabilities";
import {
  useChats,
  setActiveChatInCache,
  useChatUsage,
  useLoadOlderChatMessages,
  type ChatListItem,
} from "@/lib/queries/chats";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { useSpeech } from "@/lib/useSpeech";
import { motionClasses } from "@/lib/motion";
import {
  DEFAULT_WEB_SEARCH_ENABLED,
  WEB_SEARCH_ENABLED_STORAGE_KEY,
} from "@/lib/tool-preferences";
import { authClient } from "@/lib/auth/client";
import {
  readMessageStats,
  readStoredMessageStats,
  writeStoredMessageStats,
  type StoredMessageStats,
} from "@/lib/chat/stats";
import { messagesForChatRequest } from "@/lib/chat/history";
import { useChatGenerationRecovery } from "@/lib/chat/useChatGenerationRecovery";
import { stripCitationMarkers } from "@/lib/citations";
import { voiceHistoryToUiMessages } from "@/lib/voice/history";
import {
  CONTEXT_METER_STORAGE_KEY,
  DEFAULT_CONTEXT_METER_ENABLED,
} from "@/lib/chat/context-meter";
import {
  DEFAULT_SESSION_COST_ENABLED,
  SESSION_COST_STORAGE_KEY,
} from "@/lib/chat/session-cost";
import {
  getDataTransferFiles,
  hasDataTransferFiles,
} from "@/lib/chat/attachments";
import {
  INFERENCE_ACTIVITY_DATA_TYPE,
  isInferenceActivity,
  type InferenceActivity,
} from "@/lib/chat/inference-activity";
import {
  chatComposerDraftScope,
  newChatComposerDraftScope,
} from "@/lib/chat/composer-drafts";
import { AdminOnboardingCard } from "@/components/AdminOnboardingCard";
import { useSidebar } from "@/components/sidebar-context";
import { toast } from "@/components/ui/toast";
import { ChatHeader } from "./ChatHeader";
import { Composer, type ComposerHandle } from "./Composer";
import { MessageList } from "./MessageList";
import { MiniSpeechPlayer } from "./MiniSpeechPlayer";
import {
  RealtimeVoiceSession,
  type RealtimeVoiceSessionHandle,
} from "./RealtimeVoiceSession";
import type { VoiceTranscriptUpdate } from "@/lib/voice/client";

const MESSAGE_STATS_STORAGE_KEY = "overtchat_stats_for_nerds";

function shouldAutofocusComposer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

interface Props {
  chatId: string;
  chatKind?: ChatKind;
  initialMessages?: UIMessage[];
  initialMessageCursor?: string | null;
  isNew?: boolean;
  projectId?: string | null;
  initialQuery?: string;
}

export function ChatArea({
  chatId,
  chatKind,
  initialMessages,
  initialMessageCursor,
  isNew,
  projectId,
  initialQuery,
}: Props) {
  const qc = useQueryClient();
  const router = useRouter();
  const { openPalette } = useSidebar();
  const { data: chats } = useChats();

  const { data: modelsData, isError: modelsError } = useModelConfigs();
  const models = modelsError ? [] : (modelsData ?? null);
  const [selectedId, setSelectedId] = useSelectedModel();

  useEffect(() => {
    if (!models || models.length === 0) return;
    if (!models.some((m) => m.id === selectedId)) {
      setSelectedId(models[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  const configured = (models?.length ?? 0) > 0 && Boolean(selectedId);
  const selectedModel = models?.find((model) => model.id === selectedId);
  const modelSupportsSearch = modelSupportsToolCalling(selectedModel);
  const [webSearchEnabled] = useLocalStorage<boolean>(
    WEB_SEARCH_ENABLED_STORAGE_KEY,
    DEFAULT_WEB_SEARCH_ENABLED,
  );
  const searchAvailable = webSearchEnabled && modelSupportsSearch;
  const searchUnavailableReason = !webSearchEnabled
    ? "Web search is disabled in Settings → Tools"
    : "Web search is unavailable for this model";

  const [searchRequested, setSearchRequested] = useState(false);
  const { data: capabilitiesData } = usePublicCapabilities();
  const voiceCapability = capabilitiesData?.capabilities.voice;
  const [resolvedChatKind, setResolvedChatKind] = useState<ChatKind | null>(
    chatKind ?? null,
  );
  const [voiceActive, setVoiceActive] = useState(false);
  const [messageStatsEnabled] = useLocalStorage<boolean>(
    MESSAGE_STATS_STORAGE_KEY,
    false,
  );
  const [contextMeterEnabled] = useLocalStorage<boolean>(
    CONTEXT_METER_STORAGE_KEY,
    DEFAULT_CONTEXT_METER_ENABLED,
  );
  const [sessionCostEnabled] = useLocalStorage<boolean>(
    SESSION_COST_STORAGE_KEY,
    DEFAULT_SESSION_COST_ENABLED,
  );

  const [temporary, setTemporary] = useState(false);
  const [composerDraftScope, setComposerDraftScope] = useState<string | null>(
    () =>
      initialQuery?.trim()
        ? null
        : isNew
          ? newChatComposerDraftScope(projectId)
          : chatComposerDraftScope(chatId),
  );
  const [chatPersisted, setChatPersisted] = useState(!isNew);
  const { data: sessionUsage } = useChatUsage(
    chatId,
    sessionCostEnabled && chatPersisted && !temporary,
  );
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
  const [inferenceActivity, setInferenceActivity] =
    useState<InferenceActivity | null>(null);
  const [dragDepth, setDragDepth] = useState(0);

  const isNewRef = useRef(isNew ?? false);
  const composerRef = useRef<ComposerHandle>(null);
  const voiceSessionRef = useRef<RealtimeVoiceSessionHandle>(null);

  useEffect(() => {
    if (!configured || !shouldAutofocusComposer()) return;
    const id = window.setTimeout(() => {
      composerRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(id);
  }, [chatId, configured]);

  const [transport] = useState(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({
          messages,
          body,
          trigger,
          messageId,
        }) => ({
          // Saved chats send only the user intent. The server reconstructs
          // canonical context from persistence, avoiding an O(history) upload
          // and preventing the browser from becoming the history authority.
          body: {
            ...body,
            messages: messagesForChatRequest(
              messages,
              body?.temporary === true,
            ),
            trigger,
            messageId,
          },
        }),
      }),
  );

  const temporaryRef = useRef(false);
  useEffect(() => {
    temporaryRef.current = temporary;
  }, [temporary]);

  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    status,
    stop,
    error,
    resumeStream,
    clearError,
  } = useChat({
    id: temporary ? undefined : chatId,
    resume: false,
    transport,
    messages: initialMessages,
    throttle: 32,
    onData: (part) => {
      if (
        part.type === INFERENCE_ACTIVITY_DATA_TYPE &&
        isInferenceActivity(part.data)
      ) {
        setInferenceActivity(part.data);
      }
    },
    onError: () => {
      setInferenceActivity(null);
      if (!temporaryRef.current) {
        void qc.invalidateQueries({ queryKey: chatKeys.active() });
      }
    },
    onFinish: ({ message, isError }) => {
      setInferenceActivity(null);
      const stats = readMessageStats(message);
      if (stats && !temporaryRef.current) {
        setStoredStats((current) => {
          const next = { ...current, [message.id]: stats };
          writeStoredMessageStats(next);
          return next;
        });
      }
      if (temporaryRef.current) return;
      setActiveChatInCache(qc, chatId, false);
      if (hasSuccessfulMemoryMutation(message)) {
        void qc.invalidateQueries({ queryKey: personalizationKeys.all() });
      }
      if (isError) return;
      setChatPersisted(true);
      void Promise.all([
        qc.invalidateQueries({ queryKey: chatKeys.list() }),
        qc.invalidateQueries({ queryKey: chatKeys.active() }),
        qc.invalidateQueries({ queryKey: chatKeys.usage(chatId) }),
        qc.invalidateQueries({ queryKey: activityKeys.all() }),
      ]);
    },
  });
  const handleGenerationSettled = useCallback(() => {
    setInferenceActivity(null);
    setChatPersisted(true);
    setActiveChatInCache(qc, chatId, false);
    void Promise.all([
      qc.invalidateQueries({ queryKey: chatKeys.list() }),
      qc.invalidateQueries({ queryKey: chatKeys.active() }),
      qc.invalidateQueries({ queryKey: chatKeys.usage(chatId) }),
      qc.invalidateQueries({ queryKey: activityKeys.all() }),
    ]);
  }, [chatId, qc]);
  const reconcileGeneration = useChatGenerationRecovery({
    chatId,
    enabled: !temporary && chatPersisted,
    recoverOnMount: !isNew,
    stopLocalStream: stop,
    resumeStream,
    clearError,
    setMessages,
    onSettled: handleGenerationSettled,
  });
  const [olderMessageCursor, setOlderMessageCursor] = useState(
    initialMessageCursor ?? null,
  );
  const {
    mutateAsync: loadOlderMessages,
    isPending: loadingOlderMessages,
  } = useLoadOlderChatMessages(chatId);
  const loadingOlderMessagesRef = useRef(false);
  const handleLoadOlderMessages = useCallback(async () => {
    if (!olderMessageCursor || loadingOlderMessagesRef.current) return;
    loadingOlderMessagesRef.current = true;
    try {
      const page = await loadOlderMessages(olderMessageCursor);
      setMessages((current) => {
        const currentIds = new Set(current.map(({ id }) => id));
        return [
          ...page.messages.filter(({ id }) => !currentIds.has(id)),
          ...current,
        ];
      });
      setOlderMessageCursor(page.nextCursor);
    } catch {
      toast.error({
        title: "Could not load older messages",
        description: "Check your connection and try again.",
      });
    } finally {
      loadingOlderMessagesRef.current = false;
    }
  }, [loadOlderMessages, olderMessageCursor, setMessages]);

  const speech = useSpeech();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user.role === "admin";
  const [onboardingDismissed, setOnboardingDismissed] =
    useLocalStorage<boolean>("overtchat_onboarding_dismissed", false);
  const showOnboarding =
    isAdmin &&
    !temporary &&
    !configured &&
    !onboardingDismissed &&
    models !== null;

  const requestBody = (action: ChatRequestAction, forceSearch = false) => ({
    modelConfigId: selectedId,
    webSearchEnabled,
    forceSearch: searchAvailable && forceSearch,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    chatId,
    clientRequestId: crypto.randomUUID(),
    projectId: projectId ?? null,
    temporary,
    action,
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
    if (resolvedChatKind === "voice" || voiceActive) return;
    if (!hasDataTransferFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragDepth(0);
    const files = getDataTransferFiles(e.dataTransfer);
    if (files.length > 0) composerRef.current?.addFiles(files);
  }

  function handleStop() {
    setInferenceActivity(null);
    stop();
    if (!temporary) {
      void fetch(`/api/chat/${chatId}/stream/cancel`, { method: "POST" }).catch(
        () => undefined,
      );
    }
  }

  const markNewChatPersisted = useCallback(() => {
    if (!isNewRef.current) return false;
    isNewRef.current = false;
    setChatPersisted(true);
    setComposerDraftScope(chatComposerDraftScope(chatId));
    window.history.replaceState(null, "", `/chat/${chatId}`);
    return true;
  }, [chatId]);

  const markGenerationStarted = useCallback(() => {
    if (!temporaryRef.current) {
      setActiveChatInCache(qc, chatId, true);
    }
  }, [chatId, qc]);

  function handleSubmit(text: string, attachments: FileUIPart[]) {
    if (voiceActive) {
      voiceSessionRef.current?.sendMessage(text);
      return;
    }
    if (resolvedChatKind === "voice") return;
    setInferenceActivity(null);
    const wasNew = !temporary && markNewChatPersisted();
    if (wasNew) {
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (prev) => {
        const next: ChatListItem = {
          id: chatId,
          title: null,
          kind: "text",
          projectId: projectId ?? null,
          updatedAt: Date.now(),
        };
        if (!prev) return [next];
        if (prev.some((c) => c.id === chatId)) return prev;
        return [next, ...prev];
      });
    }
    markGenerationStarted();
    sendMessage(
      { text, files: attachments },
      { body: requestBody({ type: "submit" }, searchRequested) },
    );
    setSearchRequested(false);
  }

  const initialQueryFiredRef = useRef(false);
  useEffect(() => {
    const query = initialQuery?.trim();
    const selectedModelReady = models?.some(
      (model) => model.id === selectedId,
    );
    if (!query || initialQueryFiredRef.current || !selectedModelReady) return;
    initialQueryFiredRef.current = true;
    handleSubmit(query, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, models, selectedId]);

  function handleRegenerate(messageId: string) {
    if (streaming || !configured) return;
    setInferenceActivity(null);
    markGenerationStarted();
    regenerate({
      messageId,
      body: requestBody({
        type: "regenerate",
        targetAssistantMessageId: messageId,
      }),
    });
  }

  function handleReconnect() {
    if (streaming || !configured) return;
    setInferenceActivity(null);
    void reconcileGeneration();
  }

  function handleEdit(messageId: string, text: string, files: FileUIPart[]) {
    if (streaming || !configured) return;
    setInferenceActivity(null);
    markGenerationStarted();
    sendMessage(
      { text, files, messageId },
      {
        body: requestBody({
          type: "edit",
          targetUserMessageId: messageId,
        }),
      },
    );
  }

  // A per-message search request is scoped to the model that supports it, so
  // switching models drops it.
  function handleSelectModel(modelId: string) {
    setSearchRequested(false);
    setSelectedId(modelId);
  }

  const mergeVoiceMessages = useCallback(
    (incoming: UIMessage[]) => {
      if (incoming.length === 0) return;
      setMessages((current) => {
        const next = [...current];
        const indexes = new Map(
          next.map((message, index) => [message.id, index] as const),
        );
        for (const message of incoming) {
          const index = indexes.get(message.id);
          if (index === undefined) {
            indexes.set(message.id, next.length);
            next.push(message);
          } else {
            next[index] = message;
          }
        }
        return next;
      });
    },
    [setMessages],
  );

  const handleVoiceTranscript = useCallback(
    (update: VoiceTranscriptUpdate) => {
      const text = stripCitationMarkers(update.text).trim();
      if (!text) return;
      mergeVoiceMessages([
        {
          id: `voice:${chatId}:${update.id}`,
          role: update.role,
          parts: [{ type: "text", text }],
        },
      ]);
    },
    [chatId, mergeVoiceMessages],
  );

  const handleVoiceHistory = useCallback(
    (items: VoiceHistoryItem[]) => {
      mergeVoiceMessages(voiceHistoryToUiMessages(chatId, items));
    },
    [chatId, mergeVoiceMessages],
  );

  const handleVoicePersisted = useCallback(
    (chat: ChatListItem) => {
      setResolvedChatKind("voice");
      setChatPersisted(true);
      markNewChatPersisted();
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (current) => {
        const withoutChat = (current ?? []).filter((item) => item.id !== chat.id);
        return [chat, ...withoutChat];
      });
      void Promise.all([
        qc.invalidateQueries({ queryKey: chatKeys.list() }),
        qc.invalidateQueries({ queryKey: chatKeys.usage(chatId) }),
        qc.invalidateQueries({ queryKey: activityKeys.all() }),
      ]);
    },
    [chatId, markNewChatPersisted, qc],
  );

  // Temporary mode is only switchable before the first message, matching the
  // header toggle's visibility rule.
  const canToggleTemporary = Boolean(isNew) && messages.length === 0;
  let contextUsage:
    | { usedTokens: number; contextWindow?: number }
    | undefined;
  if (contextMeterEnabled) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "assistant") continue;
      const stats = readMessageStats(message) ?? storedStats[message.id];
      if (stats?.contextTokens === undefined) continue;
      contextUsage = {
        usedTokens: stats.contextTokens,
        // The header describes the next turn, so a model switch must update
        // the limit immediately. The message snapshot is only an offline/error
        // fallback when the selected model config is unavailable.
        contextWindow:
          selectedModel?.contextWindow ?? stats.contextWindow,
      };
      break;
    }
  }

  const composer = (
    <Composer
      ref={composerRef}
      configured={configured}
      streaming={streaming}
      searchAvailable={searchAvailable}
      searchUnavailableReason={searchUnavailableReason}
      searchRequested={searchAvailable && searchRequested}
      dropActive={dropActive}
      models={models}
      selectedModelId={selectedId}
      voiceInstalled={voiceCapability?.installed ?? false}
      voiceEligible={
        resolvedChatKind === "voice" ||
        (Boolean(isNew) && messages.length === 0 && !temporary)
      }
      voiceAvailable={Boolean(voiceCapability?.available && configured)}
      voiceActive={voiceActive}
      voiceUnavailableReason={
        !configured
          ? "Configure a model before starting voice"
          : voiceCapability?.unavailableReason === "stt-unavailable"
            ? "Speech-to-text is disabled"
            : voiceCapability?.unavailableReason === "tts-unavailable"
              ? "Text-to-speech is disabled"
              : voiceCapability?.unavailableReason === "not-configured"
                ? "Voice authentication is not configured"
                : "Realtime voice is unavailable"
      }
      attachmentsEnabled={resolvedChatKind !== "voice" && !voiceActive}
      textInputDisabled={resolvedChatKind === "voice" && !voiceActive}
      commandActions={{
        temporary: canToggleTemporary
          ? { active: temporary, onToggle: () => setTemporary((t) => !t) }
          : undefined,
        onNewChat: () => router.push("/"),
        onSearchChats: openPalette,
        onOpenSettings: () => router.push("/settings"),
        onSelectModel: handleSelectModel,
      }}
      onToggleSearch={() => {
        if (searchAvailable) setSearchRequested((selected) => !selected);
      }}
      onSubmit={handleSubmit}
      onStop={handleStop}
      onStartVoice={() => setVoiceActive(true)}
      onEndVoice={() => setVoiceActive(false)}
      isAdmin={isAdmin}
      draftUserId={session?.user.id}
      draftScope={composerDraftScope}
      draftEnabled={!temporary}
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
        onSelectModel={handleSelectModel}
        contextUsage={contextUsage}
        sessionUsage={sessionCostEnabled ? sessionUsage : undefined}
        showTempToggle={canToggleTemporary}
        temporary={temporary}
        onToggleTemporary={() => setTemporary((t) => !t)}
      />

      <MiniSpeechPlayer speech={speech} />

      {dropActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/70 backdrop-blur-[2px] motion-overlay">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ring bg-background/90 px-8 py-6 text-center shadow-lg ring-1 ring-ring/20">
            <div
              className={`flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm ${motionClasses.dropIcon}`}
            >
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

      {messages.length === 0 && !voiceActive ? (
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
                  No models configured. An admin can add one in Settings →
                  Models.
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
            inferenceActivity={inferenceActivity}
            error={error}
            configured={configured && resolvedChatKind !== "voice"}
            speech={speech}
            showStats={messageStatsEnabled}
            storedStats={storedStats}
            hasOlderMessages={olderMessageCursor !== null}
            loadingOlderMessages={loadingOlderMessages}
            onLoadOlderMessages={handleLoadOlderMessages}
            onRegenerate={handleRegenerate}
            onEdit={handleEdit}
            onReconnect={handleReconnect}
          />

          <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-3xl">
              {voiceActive && selectedModel && (
                <RealtimeVoiceSession
                  ref={voiceSessionRef}
                  chatId={chatId}
                  projectId={projectId ?? null}
                  modelConfigId={selectedId}
                  modelLabel={selectedModel.label}
                  webSearchEnabled={searchAvailable}
                  onTranscript={handleVoiceTranscript}
                  onHistoryItems={handleVoiceHistory}
                  onPersisted={handleVoicePersisted}
                />
              )}
              {composer}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
