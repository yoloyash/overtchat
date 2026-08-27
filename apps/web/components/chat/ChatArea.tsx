"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type ChatAddToolOutputFunction,
  type FileUIPart,
  type UIMessage,
} from "ai";
import {
  EXECUTE_CODE_TOOL_NAME,
  modelSupportsToolCalling,
} from "@overtchat/shared";
import { FileUp } from "lucide-react";
import { useSelectedModel } from "@/lib/model-config/client";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import { activityKeys, chatKeys } from "@/lib/queries/keys";
import {
  useChats,
  useChatUsage,
  type ChatListItem,
} from "@/lib/queries/chats";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { useSpeech } from "@/lib/useSpeech";
import { motionClasses } from "@/lib/motion";
import {
  DEFAULT_WEB_SEARCH_ENABLED,
  WEB_SEARCH_ENABLED_STORAGE_KEY,
} from "@/lib/tool-preferences";
import {
  executePython,
  resetPythonExecutor,
} from "@/lib/code-execution/browser-python";
import { loadPythonInputs } from "@/lib/code-execution/inputs";
import { persistPythonOutput } from "@/lib/code-execution/persistence";
import { authClient } from "@/lib/auth/client";
import {
  readMessageStats,
  readStoredMessageStats,
  writeStoredMessageStats,
  type StoredMessageStats,
} from "@/lib/chat/stats";
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
import { AdminOnboardingCard } from "@/components/AdminOnboardingCard";
import { useSidebar } from "@/components/sidebar-context";
import { ChatHeader } from "./ChatHeader";
import { Composer, type ComposerHandle } from "./Composer";
import { MessageList } from "./MessageList";
import { MiniSpeechPlayer } from "./MiniSpeechPlayer";

const MESSAGE_STATS_STORAGE_KEY = "overtchat_stats_for_nerds";

function shouldAutofocusComposer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

interface Props {
  chatId: string;
  initialMessages?: UIMessage[];
  isNew?: boolean;
  projectId?: string | null;
  initialQuery?: string;
}

export function ChatArea({
  chatId,
  initialMessages,
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
          body: { ...body, messages, trigger, messageId },
        }),
      }),
  );

  const temporaryRef = useRef(false);
  useEffect(() => {
    temporaryRef.current = temporary;
  }, [temporary]);

  const addToolOutputRef = useRef<
    ChatAddToolOutputFunction<UIMessage> | null
  >(null);
  const messagesRef = useRef<UIMessage[]>(initialMessages ?? []);
  const chat = useChat({
    id: temporary ? undefined : chatId,
    resume: !temporary && !isNew,
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      if (toolCall.dynamic || toolCall.toolName !== EXECUTE_CODE_TOOL_NAME) {
        return;
      }
      try {
        const input = toolCall.input as { language?: unknown; code?: unknown };
        if (
          input.language !== "python" ||
          typeof input.code !== "string"
        ) {
          throw new Error("Invalid Python execution request");
        }
        const loaded = await loadPythonInputs(messagesRef.current);
        const localOutput = await executePython(input.code, loaded.files);
        const output = await persistPythonOutput({
          ...localOutput,
          stderr: [localOutput.stderr, ...loaded.warnings]
            .filter(Boolean)
            .join("\n") || null,
        });
        void addToolOutputRef.current?.({
          tool: EXECUTE_CODE_TOOL_NAME,
          toolCallId: toolCall.toolCallId,
          output,
        });
      } catch (cause) {
        void addToolOutputRef.current?.({
          tool: EXECUTE_CODE_TOOL_NAME,
          toolCallId: toolCall.toolCallId,
          state: "output-error",
          errorText:
            cause instanceof Error ? cause.message : "Python execution failed",
        });
      }
    },
    onData: (part) => {
      if (
        part.type === INFERENCE_ACTIVITY_DATA_TYPE &&
        isInferenceActivity(part.data)
      ) {
        setInferenceActivity(part.data);
      }
    },
    onError: () => setInferenceActivity(null),
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
      if (isError) return;
      setChatPersisted(true);
      void Promise.all([
        qc.invalidateQueries({ queryKey: chatKeys.list() }),
        qc.invalidateQueries({ queryKey: chatKeys.usage(chatId) }),
        qc.invalidateQueries({ queryKey: activityKeys.all() }),
      ]);
    },
  });
  useLayoutEffect(() => {
    addToolOutputRef.current = chat.addToolOutput;
    return () => {
      addToolOutputRef.current = null;
    };
  }, [chat.addToolOutput]);
  const { messages, sendMessage, regenerate, status, stop, error } = chat;
  useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    resetPythonExecutor();
    return resetPythonExecutor;
  }, [chatId]);

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

  const requestBody = (forceSearch = false) => ({
    modelConfigId: selectedId,
    webSearchEnabled,
    codeExecutionSupported: true,
    forceSearch: searchAvailable && forceSearch,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
    setInferenceActivity(null);
    stop();
    if (!temporary) {
      void fetch(`/api/chat/${chatId}/stream/cancel`, { method: "POST" }).catch(
        () => undefined,
      );
    }
  }

  function handleSubmit(text: string, attachments: FileUIPart[]) {
    setInferenceActivity(null);
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
    sendMessage(
      { text, files: attachments },
      { body: requestBody(searchRequested) },
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
    regenerate({ messageId, body: requestBody() });
  }

  function handleRetry() {
    if (streaming || !configured) return;
    setInferenceActivity(null);
    regenerate({ body: requestBody() });
  }

  function handleEdit(messageId: string, text: string, files: FileUIPart[]) {
    if (streaming || !configured) return;
    setInferenceActivity(null);
    sendMessage({ text, files, messageId }, { body: requestBody() });
  }

  // A per-message search request is scoped to the model that supports it, so
  // switching models drops it.
  function handleSelectModel(modelId: string) {
    setSearchRequested(false);
    setSelectedId(modelId);
  }

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
            configured={configured}
            speech={speech}
            showStats={messageStatsEnabled}
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
