import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Keyboard, ScrollView, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
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
  AgentButton,
  AgentFeedback,
  AgentSheet,
  AgentText,
} from "@/components/agents/AgentPrimitives";
import { AgentSessionHeaderTitle } from "@/components/agents/AgentSessionHeader";
import {
  AgentContextButton,
  AgentContextSheet,
} from "@/components/agents/AgentContextUsage";
import { AgentComposer } from "@/components/agents/AgentComposer";
import { AgentConnectionFeedback } from "@/components/agents/AgentConnectionFeedback";
import { AgentControls } from "@/components/agents/AgentControls";
import { AgentInteraction } from "@/components/agents/AgentInteraction";
import { AgentTranscript } from "@/components/agents/AgentTranscript";
import { useAgentDraft } from "@/lib/agents/drafts";
import {
  prepareSubmission,
  record,
  sessionModes,
  submissionFingerprint,
  text,
} from "@/lib/agents/model";
import { useAgentCommand, useAgentSession } from "@/lib/queries/agents";
import { useTheme } from "@/lib/theme";

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
  const snapshot = session.snapshot;
  const mutation = useAgentCommand(id);
  const { draft, setDraft, storageError } = useAgentDraft(id);
  const [settings, setSettings] = useState(false);
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
  const modelId = text(record(snapshot?.state.model).id);
  const model = snapshot?.models.find((item) => item.id === modelId);
  const modes = snapshot ? sessionModes(snapshot) : [];
  const modeId = text(snapshot?.state.modeId);
  const ready =
    session.status === "connected" && !!snapshot && !snapshot.readOnly;
  const busy =
    snapshot?.status === "running" || snapshot?.state.isCompacting === true;

  async function execute(
    command: AgentSessionCommand,
    clearDraft = false,
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen
        options={{
          title: text(snapshot?.state.sessionName).trim() || name,
          headerTitleAlign: "left",
          headerBackButtonDisplayMode: "minimal",
          headerRight: () => (
            <AgentContextButton
              usage={snapshot?.stats.contextUsage}
              onPress={() => {
                Keyboard.dismiss();
                setContextVisible(true);
              }}
            />
          ),
          headerTitle: () => (
            <AgentSessionHeaderTitle
              title={text(snapshot?.state.sessionName).trim() || name}
              working={busy && session.status === "connected"}
              provider={snapshot?.provider}
              workspace={workspace}
              workspaceName={name}
            />
          ),
        }}
      />
      {snapshot?.pendingInteraction && !interaction && (
        <View
          style={{
            marginHorizontal: 12,
            marginVertical: 6,
            paddingLeft: 12,
            borderRadius: 12,
            backgroundColor: colors.muted,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <View style={{ flex: 1 }}>
            <AgentText>Response needed</AgentText>
          </View>
          <AgentButton
            label="Respond"
            icon="chatbubble-ellipses-outline"
            onPress={() => {
              Keyboard.dismiss();
              setInteraction(true);
            }}
          />
        </View>
      )}
      {!snapshot && (
        <AgentFeedback
          loading={session.status !== "error"}
          error={session.error}
          retry={session.reconnect}
        />
      )}
      {snapshot && (
        <AgentConnectionFeedback
          status={session.status}
          error={session.error}
          retry={session.reconnect}
        />
      )}
      {snapshot?.readOnly && (
        <View style={{ padding: 12 }}>
          <AgentText muted>{snapshot.readOnly.reason}</AgentText>
          {snapshot.readOnly.retryable && (
            <AgentButton
              label="Retry interactive session"
              disabled={mutation.isPending || session.status !== "connected"}
              onPress={() => void execute({ type: "retry_interactive" })}
            />
          )}
        </View>
      )}
      {snapshot && (
        <AgentTranscript
          snapshot={snapshot}
          disabled={!ready || mutation.isPending}
          onImplementPlan={implementPlan}
        />
      )}
      {!!(error || storageError || snapshot?.error) && (
        <ScrollView
          style={{ maxHeight: 110 }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6 }}
        >
          <AgentText danger>
            {error || storageError || snapshot?.error}
          </AgentText>
        </ScrollView>
      )}
      {!!notice && (
        <View style={{ paddingHorizontal: 12 }}>
          <AgentText muted>{notice}</AgentText>
          <AgentButton label="Dismiss" onPress={() => setNotice(undefined)} />
        </View>
      )}
      {!!draft.pending &&
        !mutation.isPending &&
        draft.pending.fingerprint ===
          submissionFingerprint(draft.message, draft.images) && (
          <View style={{ paddingHorizontal: 12, paddingVertical: 6, gap: 4 }}>
            <AgentText muted>
              Delivery not confirmed. Check the conversation before retrying.
            </AgentText>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              <AgentButton
                label="Already delivered"
                icon="checkmark"
                onPress={() =>
                  setDraft(
                    (current) =>
                      current === draft ? { message: "", images: [] } : current,
                    true,
                  )
                }
              />
              <AgentButton
                label="Send again…"
                icon="refresh-outline"
                disabled={!ready}
                onPress={() =>
                  Alert.alert(
                    "Send as a new message?",
                    "Only send again if you checked the conversation and it wasn't delivered. This could otherwise send it twice.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Send again", onPress: () => send(true) },
                    ],
                  )
                }
              />
            </View>
          </View>
        )}
      <View style={{ paddingBottom: keyboard ? 0 : insets.bottom }}>
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
          disabled={!ready}
          sending={mutation.isPending}
          running={busy}
          provider={snapshot?.provider}
          modelLabel={model?.label || modelId || "Model"}
          thinkingLabel={
            model?.thinkingOptions?.length
              ? text(snapshot?.state.thinkingLevel) || "Reasoning"
              : undefined
          }
          modeLabel={modes.find((mode) => mode.id === modeId)?.label ?? ""}
          onSettings={() => {
            Keyboard.dismiss();
            setSettings(true);
          }}
          onSend={() => send()}
          onStop={() => void execute({ type: "abort" })}
        />
      </View>
      <AgentControls
        visible={settings}
        error={error}
        notice={notice}
        provider={snapshot?.provider}
        onClose={() => setSettings(false)}
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
      {snapshot?.pendingInteraction && (
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
