import { resolveAgentSessionThinking } from "@overtchat/shared/agent-creation";
import { restoreAgentComposer } from "@overtchat/shared/agent-presentation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Keyboard, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { useHeaderHeight } from "expo-router/react-navigation";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  KeyboardAvoidingView,
  useKeyboardState,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import {
  agentProviderMetadata,
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
import { AgentSessionHeaderMenu } from "@/components/agents/AgentSessionHeaderMenu";
import { RenameSheet } from "@/components/ui/RenameSheet";
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
import {
  useAgentCommand,
  useAgentSession,
  useAgentSessionListing,
  useMarkAgentSessionSeen,
} from "@/lib/queries/agents";
import { ErrorNotice } from "@/components/ErrorNotice";
import { useTheme } from "@/lib/theme";
import { toastSuccess } from "@/lib/toast";
import { useSpeech } from "@/lib/useSpeech";
import { MiniSpeechPlayer } from "@/components/chat/MiniSpeechPlayer";
import { getAuthClient } from "@/lib/auth/client";

export default function AgentSessionScreen() {
  const { id, workspace, name } = useLocalSearchParams<{
    id: string;
    workspace?: string;
    name?: string;
  }>();
  return <AgentSession key={id} id={id} workspace={workspace} name={name} />;
}

function AgentSession({
  id,
  workspace: workspaceParam,
  name: nameParam,
}: {
  id: string;
  workspace?: string;
  name?: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  // A notification opens a session by id alone; the connection list fills in
  // its folder, and knows the provider's own session id for copying.
  const listing = useAgentSessionListing(id);
  const workspace = workspaceParam || listing?.item.workspaceId || "";
  const name =
    nameParam ?? listing?.group.name ?? t("agents.mobile.session.fallbackName");
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
  useMarkAgentSessionSeen(id, snapshot?.status);
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
  const thinking =
    resolveAgentSessionThinking(model, snapshot?.state.thinkingLevel) ?? "";
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
          throw new Error(t("agents.session.noForkHistory"));
        const fork = Crypto.randomUUID();
        saveDraftToSession(`fork:${fork}`, {
          message: "",
          images: [],
          forkContext: result.forkContext,
        });
        // The new-session screen is the Agents home; it carries the history.
        router.push({
          pathname: "/agents",
          params: {
            workspace,
            provider: snapshot.provider,
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
          pathname: "/agent/[id]",
          params: { id: result.sessionId, workspace, name },
        });
        return true;
      }
      session.reconnect();
      return true;
    } catch (cause) {
      if (!mounted.current) return false;
      setError(
        cause instanceof Error
          ? cause.message
          : t("agents.mobile.errors.commandSendFailed"),
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
      setError(
        cause instanceof Error
          ? cause.message
          : t("agents.mobile.errors.invalidCommand"),
      );
    }
  }

  const implementPlan = useCallback(
    (plan: string) => {
      Alert.alert(
        t("agents.mobile.session.implementPlanTitle"),
        t("agents.mobile.session.implementPlanDescription"),
        [
          { text: t("common.actions.cancel"), style: "cancel" },
          {
            text: t("agents.mobile.session.implementPlanConfirm"),
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
    [id, ready, mutation.mutateAsync, t],
  );

  const renameRef = useRef<BottomSheetModal>(null);
  const sessionName = text(snapshot?.state.sessionName).trim();
  const title = sessionName || name;
  function confirmCompact() {
    Alert.alert(
      t("agents.dialogs.compactTitle"),
      t("agents.mobile.session.compactDescription"),
      [
        { text: t("common.actions.cancel"), style: "cancel" },
        {
          text: t("agents.dialogs.compactAction"),
          onPress: () => void execute({ type: "compact" }),
        },
      ],
    );
  }
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
      <Drawer.Screen
        options={{
          headerTitle: () => (
            <AgentSessionHeaderTitle
              title={title}
              working={busy && session.status === "connected"}
              provider={snapshot?.provider}
              workspace={workspace}
              workspaceName={name}
            />
          ),
          headerRight: () => (
            <AgentSessionHeaderMenu
              title={title}
              disabled={!snapshot && !listing}
              renameSupported={
                !snapshot ||
                agentProviderMetadata(snapshot.provider).capabilities
                  .renameSession !== false
              }
              ready={ready}
              busy={busy}
              commandPending={mutation.isPending}
              usageSupported={snapshot?.capabilities.usage === true}
              workspaceKnown={!!workspace}
              providerSessionId={listing?.item.session.providerSessionId ?? null}
              workspacePath={listing?.group.path ?? null}
              onRename={() => renameRef.current?.present()}
              onCompact={confirmCompact}
              onUsage={() => void execute({ type: "show_usage" })}
              onOpenWorkspace={() =>
                router.push({
                  pathname: "/agents/workspace",
                  params: { workspace, name },
                })
              }
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
            accessibilityLabel={t("agents.mobile.session.loadingConversation")}
            color={colors.mutedForeground}
          />
        </View>
      )}
      <MiniSpeechPlayer speech={speech} />
      <RenameSheet
        ref={renameRef}
        targetId={id}
        initialTitle={sessionName || null}
        heading={t("agents.session.rename")}
        placeholder={t("agents.mobile.session.namePlaceholder")}
        maxLength={120}
        onSubmit={(_, next) =>
          void execute({ type: "set_session_name", name: next }).then(
            (sent) => {
              if (sent) toastSuccess(t("agents.mobile.session.renamedToast"));
            },
          )
        }
      />
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
                      label: t("agents.mobile.session.retryInteractive"),
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
            message={t("agents.mobile.session.waitingForResponse")}
            actions={[
              {
                label: t("agents.mobile.session.respond"),
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
            message={t("agents.mobile.session.deliveryNotConfirmed")}
            actions={[
              {
                label: t("agents.mobile.session.alreadyDelivered"),
                onPress: () =>
                  setDraft(
                    (current) =>
                      current === draft ? { message: "", images: [] } : current,
                    true,
                  ),
              },
              {
                label: t("agents.mobile.session.sendAgainEllipsis"),
                disabled: !ready,
                onPress: () =>
                  Alert.alert(
                    t("agents.mobile.session.sendAsNewTitle"),
                    t("agents.mobile.session.sendAsNewDescription"),
                    [
                      { text: t("common.actions.cancel"), style: "cancel" },
                      {
                        text: t("agents.mobile.session.sendAgain"),
                        onPress: () => send(true),
                      },
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
          modelLabel={model?.label || modelId || t("agents.composer.model")}
          thinkingLabel={thinkingLabel(model, thinking)}
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
        thinking={thinking}
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
        title={t("agents.session.accountUsage")}
        visible={!!usage}
        onClose={() => setUsage(undefined)}
      >
        {usage?.planType && <AgentText title>{usage.planType}</AgentText>}
        {usage?.windows.map((window) => (
          <View key={window.id}>
            <AgentText>
              {t("agents.mobile.session.usageWindow", {
                label: window.label,
                percent: Math.round(window.usedPercent),
              })}
            </AgentText>
            {window.resetsAt && (
              <AgentText muted>
                {t("agents.dialogs.resetsAt", {
                  time: new Date(window.resetsAt * 1000).toLocaleString(),
                })}
              </AgentText>
            )}
          </View>
        ))}
        {usage?.credits && (
          <AgentText>
            {t("agents.mobile.session.usageCredits", {
              value: usage.credits.unlimited
                ? t("agents.dialogs.unlimited")
                : (usage.credits.balance ?? t("agents.dialogs.available")),
            })}
          </AgentText>
        )}
        {usage?.unavailableReason && (
          <AgentText muted>{usage.unavailableReason}</AgentText>
        )}
      </AgentSheet>
    </KeyboardAvoidingView>
  );
}
