import { restoreAgentComposer } from "@overtchat/shared/agent-presentation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { DrawerToggleButton } from "expo-router/build/react-navigation/drawer";
import {
  KeyboardAvoidingView,
  useKeyboardState,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import {
  type AgentSessionCommand,
  type AgentUsageSnapshot,
} from "@overtchat/agent-bridge";
import {
  AgentFeedback,
  AgentNotice,
  AgentSheet,
  AgentText,
} from "@/components/agents/AgentPrimitives";
import { AgentSessionHeaderTitle } from "@/components/agents/AgentSessionHeader";
import { AgentContextSheet } from "@/components/agents/AgentContextUsage";
import { AgentComposer } from "@/components/agents/AgentComposer";
import { AgentConnectionFeedback } from "@/components/agents/AgentConnectionFeedback";
import {
  AgentControls,
  type AgentSettingsPanel,
} from "@/components/agents/AgentControls";
import { isAgentQuestion } from "@overtchat/shared/agent-interaction";
import { AgentQuestionCard } from "@/components/agents/AgentQuestionCard";
import { AgentInteraction } from "@/components/agents/AgentInteraction";
import { AgentTranscript } from "@/components/agents/AgentTranscript";
import { useAgentDraft } from "@/lib/agents/drafts";
import {
  prepareSubmission,
  sessionModel,
  sessionModes,
  submissionFingerprint,
  text,
  thinkingLabel,
} from "@/lib/agents/model";
import { useAgentCommand, useAgentSession } from "@/lib/queries/agents";
import { ErrorNotice } from "@/components/ErrorNotice";
import { useTheme } from "@/lib/theme";
import { useSpeech } from "@/lib/useSpeech";
import { MiniSpeechPlayer } from "@/components/chat/MiniSpeechPlayer";
import { getAuthClient } from "@/lib/auth/client";

export default function AgentSessionScreen() {
  const {
    id,
    workspace = "",
    name = "Agent chat",
  } = useLocalSearchParams<{ id: string; workspace?: string; name?: string }>();
  return <AgentSession key={id} id={id} workspace={workspace} name={name} />;
}

function AgentSession({
  id,
  workspace,
  name,
}: {
  id: string;
  workspace: string;
  name: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const keyboard = useKeyboardState((state) => state.isVisible);
  const session = useAgentSession(id);
  const speech = useSpeech();
  const stopSpeech = speech.stop;
  const authSession = getAuthClient().useSession();
  const isAdmin =
    (authSession.data?.user as { role?: string | null } | undefined)?.role ===
    "admin";
  useFocusEffect(useCallback(() => () => stopSpeech(), [stopSpeech]));
  const snapshot = session.snapshot;
  const mutation = useAgentCommand(id);
  const { draft, setDraft, storageError, saveDraftToSession } =
    useAgentDraft(id);
  const [settings, setSettings] = useState<AgentSettingsPanel | null>(null);
  const [followSignal, setFollowSignal] = useState(0);
  const [contextVisible, setContextVisible] = useState(false);
  const [interaction, setInteraction] = useState(false);
  const [usage, setUsage] = useState<AgentUsageSnapshot>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const requestId = snapshot?.pendingInteraction?.id;
  useEffect(() => {
    setInteraction(!!requestId);
  }, [requestId]);
  const { id: modelId, model } = snapshot
    ? sessionModel(snapshot)
    : { id: "", model: undefined };
  const modes = snapshot ? sessionModes(snapshot) : [];
  const modeId = text(snapshot?.state.modeId);
  const mode = modes.find((item) => item.id === modeId);
  const ready =
    session.status === "connected" && !!snapshot && !snapshot.readOnly;
  const busy =
    snapshot?.status === "running" || snapshot?.state.isCompacting === true;

  async function execute(
    command: AgentSessionCommand,
    clearDraft = false,
    chooseWorkspace = false,
  ): Promise<boolean> {
    if (lock.current || (!ready && command.type !== "retry_interactive"))
      return false;
    lock.current = true;
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await mutation.mutateAsync(command);
      if (clearDraft)
        setDraft((current) => {
          const sameIdentity =
            "clientMessageId" in command
              ? !!current.pending &&
                "clientMessageId" in current.pending.command &&
                command.clientMessageId ===
                  current.pending.command.clientMessageId
              : current === draft;
          if (!sameIdentity) return current;
          const unchanged =
            current.message === draft.message &&
            current.images.map((image) => image.uploadId).join() ===
              draft.images.map((image) => image.uploadId).join();
          return unchanged
            ? { message: "", images: [] }
            : { ...current, pending: undefined };
        }, true);
      if (!mounted.current) return false;
      if (command.type === "fork_message") {
        if (!result.forkContext || !snapshot)
          throw new Error("The agent did not return conversation history.");
        const fork = Crypto.randomUUID();
        saveDraftToSession(`fork:${fork}`, {
          message: "",
          images: [],
          forkContext: result.forkContext,
        });
        router.push({
          pathname: "/agents/new",
          params: {
            workspace,
            provider: snapshot.provider,
            name,
            fork,
            chooseWorkspace: chooseWorkspace ? "1" : "0",
          },
        });
        return true;
      }
      if (command.type === "rewind" && result.draft !== undefined) {
        setDraft(
          (current) => ({
            ...current,
            message: restoreAgentComposer(current.message, result.draft!),
          }),
          true,
        );
      }
      if (result.usage) setUsage(result.usage);
      if (result.notice) setNotice(result.notice.message);
      if (result.sessionId && result.sessionId !== id) {
        router.replace({
          pathname: "/agents/[id]",
          params: { id: result.sessionId, workspace, name },
        });
        return true;
      }
      session.reconnect();
      return true;
    } catch (cause) {
      if (!mounted.current) return false;
      setError(
        cause instanceof Error ? cause.message : "Couldn't send the command.",
      );
      session.reconnect();
      return false;
    } finally {
      lock.current = false;
    }
  }

  function send(asNew = false) {
    if (!snapshot || !ready || lock.current) return;
    try {
      const images = draft.images.map(({ uploadId, filename, mediaType }) => ({
        uploadId,
        filename,
        mediaType,
      }));
      const { command, pending } = prepareSubmission(
        snapshot,
        draft.message,
        images,
        asNew ? undefined : draft.pending,
        Crypto.randomUUID,
      );
      if (pending) setDraft({ ...draft, pending }, true);
      setFollowSignal((value) => value + 1);
      void execute(command, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid command.");
    }
  }

  const implementPlan = useCallback(
    (plan: string) => {
      Alert.alert(
        "Implement this plan?",
        "The agent will begin implementing the plan in this workspace.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Implement",
            onPress: () =>
              void execute({
                type: "implement_plan",
                plan,
                clientMessageId: Crypto.randomUUID(),
              }),
          },
        ],
      );
      // The callback reads the current session and command state.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [id, ready, mutation.mutateAsync],
  );

  const title = text(snapshot?.state.sessionName).trim() || name;
  const pendingResponse =
    snapshot?.pendingInteraction &&
    !isAgentQuestion(snapshot.pendingInteraction) &&
    !interaction;
  const unconfirmed =
    !!draft.pending &&
    !mutation.isPending &&
    draft.pending.fingerprint ===
      submissionFingerprint(draft.message, draft.images);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen
        options={{
          title,
          headerTitleAlign: "left",
          headerBackButtonDisplayMode: "minimal",
          headerBackVisible: true,
          headerLeft: ({ canGoBack }) =>
            canGoBack ? null : <DrawerToggleButton tintColor={colors.foreground} />,
          headerRight: ({ canGoBack }) =>
            canGoBack ? <DrawerToggleButton tintColor={colors.foreground} /> : null,
          headerTitle: () => (
            <AgentSessionHeaderTitle
              title={title}
              working={busy && session.status === "connected"}
              provider={snapshot?.provider}
              workspace={workspace}
              workspaceName={name}
            />
          ),
        }}
      />
      {snapshot ? (
        <>
          <AgentConnectionFeedback
            status={session.status}
            error={session.error}
            retry={session.reconnect}
          />
          <AgentTranscript
            history={{
              hasOlder: Boolean(snapshot.history?.beforeCursor),
              loading: session.history.isPending,
              error: session.history.error?.message,
              load: () => session.history.mutate(),
            }}
            onFork={async (messageId, chooseWorkspace) => {
              await execute(
                { type: "fork_message", messageId },
                false,
                chooseWorkspace,
              );
            }}
            onRewind={async (messageId, mode) => {
              await execute({ type: "rewind", messageId, mode });
            }}
            speech={speech}
            snapshot={snapshot}
            error={snapshot.error}
            followSignal={followSignal}
            question={
              isAgentQuestion(snapshot.pendingInteraction) &&
              snapshot.pendingInteraction ? (
                <AgentQuestionCard
                  key={snapshot.pendingInteraction.id}
                  request={snapshot.pendingInteraction}
                  pending={mutation.isPending || !ready}
                  error={error}
                  onRespond={(response) =>
                    void execute({
                      type: "interaction_response",
                      id: snapshot.pendingInteraction!.id,
                      ...response,
                    })
                  }
                />
              ) : undefined
            }
            disabled={!ready || mutation.isPending}
            onImplementPlan={implementPlan}
          />
        </>
      ) : session.status === "error" ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <AgentFeedback error={session.error} retry={session.reconnect} />
        </View>
      ) : (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator
            accessibilityLabel="Loading conversation"
            color={colors.mutedForeground}
          />
        </View>
      )}
      <MiniSpeechPlayer speech={speech} />
      <View
        style={{
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: keyboard ? 8 : 12 + insets.bottom,
          gap: 8,
        }}
      >
        {snapshot?.readOnly && (
          <AgentNotice
            icon="lock-closed-outline"
            message={snapshot.readOnly.reason}
            actions={
              snapshot.readOnly.retryable
                ? [
                    {
                      label: "Retry interactive session",
                      disabled:
                        mutation.isPending || session.status !== "connected",
                      onPress: () => void execute({ type: "retry_interactive" }),
                    },
                  ]
                : []
            }
          />
        )}
        {pendingResponse && (
          <AgentNotice
            icon="hand-left-outline"
            warning
            message="The agent is waiting for your response."
            actions={[
              {
                label: "Respond",
                primary: true,
                onPress: () => {
                  Keyboard.dismiss();
                  setInteraction(true);
                },
              },
            ]}
          />
        )}
        {!!(error || storageError) && (
          <ErrorNotice
            message={error || storageError}
            onDismiss={error ? () => setError(undefined) : undefined}
          />
        )}
        {!!notice && (
          <AgentNotice message={notice} onDismiss={() => setNotice(undefined)} />
        )}
        {unconfirmed && (
          <AgentNotice
            icon="help-circle-outline"
            warning
            message="Delivery not confirmed. Check the conversation before retrying."
            actions={[
              {
                label: "Already delivered",
                onPress: () =>
                  setDraft(
                    (current) =>
                      current === draft ? { message: "", images: [] } : current,
                    true,
                  ),
              },
              {
                label: "Send again…",
                disabled: !ready,
                onPress: () =>
                  Alert.alert(
                    "Send as a new message?",
                    "Only send again if you checked the conversation and it wasn't delivered. This could otherwise send it twice.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Send again", onPress: () => send(true) },
                    ],
                  ),
              },
            ]}
          />
        )}
        <AgentComposer
          draft={draft}
          setDraft={setDraft}
          commands={snapshot?.commands ?? []}
          queuedMessages={snapshot?.queuedMessages ?? []}
          supportsSteer={
            snapshot?.capabilities.steer === true &&
            snapshot.status === "running"
          }
          onEditQueued={(id) => execute({ type: "remove_queued_message", id })}
          onSteerQueued={(id) =>
            void execute({ type: "steer_queued_message", id })
          }
          onRemoveQueued={(id) =>
            void execute({ type: "remove_queued_message", id })
          }
          supportsImages={model?.input.includes("image") === true}
          disabled={!ready || !!snapshot?.pendingInteraction}
          canStop={ready}
          sending={mutation.isPending}
          running={busy}
          isAdmin={isAdmin}
          onBeforeDictate={stopSpeech}
          provider={snapshot?.provider}
          modelLabel={model?.label || modelId || "Model"}
          thinkingLabel={thinkingLabel(model, text(snapshot?.state.thinkingLevel))}
          permission={
            mode ? { label: mode.label, dangerous: mode.dangerous === true } : undefined
          }
          contextUsage={snapshot ? (snapshot.stats.contextUsage ?? null) : undefined}
          onContext={() => {
            Keyboard.dismiss();
            setContextVisible(true);
          }}
          onSettings={() => {
            Keyboard.dismiss();
            setSettings("settings");
          }}
          onPermissions={() => {
            Keyboard.dismiss();
            setSettings("permissions");
          }}
          onSend={() => send()}
          onStop={() => void execute({ type: "abort" })}
        />
      </View>
      <AgentControls
        visible={settings !== null}
        initialPanel={settings ?? "settings"}
        error={error}
        notice={notice}
        provider={snapshot?.provider}
        onClose={() => setSettings(null)}
        models={snapshot?.models ?? []}
        modelId={modelId}
        modes={modes}
        modeId={modeId}
        thinking={text(snapshot?.state.thinkingLevel)}
        disabled={!ready || mutation.isPending}
        onModel={(model) =>
          void execute({ type: "set_model", modelId: model.id })
        }
        onMode={(mode) => void execute({ type: "set_mode", modeId: mode.id })}
        onThinking={(option) =>
          void execute({ type: "set_thinking_level", level: option.id })
        }
        planMode={snapshot?.state.collaborationMode === "plan"}
        onPlan={
          Array.isArray(snapshot?.state.collaborationModes) &&
          snapshot.state.collaborationModes.includes("plan")
            ? () =>
                void execute({
                  type: "set_collaboration_mode",
                  mode:
                    snapshot?.state.collaborationMode === "plan"
                      ? "default"
                      : "plan",
                })
            : undefined
        }
      />
      <AgentContextSheet
        usage={snapshot?.stats.contextUsage}
        visible={contextVisible}
        onClose={() => setContextVisible(false)}
        stale={!!snapshot && session.status !== "connected"}
      />
      {snapshot?.pendingInteraction && !isAgentQuestion(snapshot.pendingInteraction) && (
        <AgentInteraction
          key={snapshot.pendingInteraction.id}
          request={snapshot.pendingInteraction}
          visible={interaction}
          onClose={() => setInteraction(false)}
          pending={mutation.isPending || !ready}
          error={error}
          onRespond={(response) =>
            void execute({
              type: "interaction_response",
              id: snapshot.pendingInteraction!.id,
              ...response,
            })
          }
        />
      )}
      <AgentSheet
        title="Account usage"
        visible={!!usage}
        onClose={() => setUsage(undefined)}
      >
        {usage?.planType && <AgentText title>{usage.planType}</AgentText>}
        {usage?.windows.map((window) => (
          <View key={window.id}>
            <AgentText>
              {window.label} · {Math.round(window.usedPercent)}% used
            </AgentText>
            {window.resetsAt && (
              <AgentText muted>
                Resets {new Date(window.resetsAt * 1000).toLocaleString()}
              </AgentText>
            )}
          </View>
        ))}
        {usage?.credits && (
          <AgentText>
            Credits:{" "}
            {usage.credits.unlimited
              ? "Unlimited"
              : (usage.credits.balance ?? "Available")}
          </AgentText>
        )}
        {usage?.unavailableReason && (
          <AgentText muted>{usage.unavailableReason}</AgentText>
        )}
      </AgentSheet>
    </KeyboardAvoidingView>
  );
}
