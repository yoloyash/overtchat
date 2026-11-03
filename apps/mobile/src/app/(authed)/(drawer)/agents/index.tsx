import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, StyleSheet, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  KeyboardAvoidingView,
  useKeyboardState,
} from "react-native-keyboard-controller";
import { randomUUID } from "expo-crypto";
import { Ionicons } from "@expo/vector-icons";
import {
  agentProviderMetadata,
  agentPromptWithHistory,
  isAgentProviderId,
  type AgentProviderId,
  type AgentSessionLaunchConfig,
} from "@overtchat/agent-bridge";
import { resolveAgentSessionDraftSelection } from "@overtchat/shared/agent-creation";
import { AgentProviderIcon } from "@/components/agents/AgentProviderIcon";
import { AgentComposer } from "@/components/agents/AgentComposer";
import {
  AgentControls,
  type AgentSettingsPanel,
} from "@/components/agents/AgentControls";
import {
  AgentSetupPicker,
  type AgentSetupPickerPanel,
} from "@/components/agents/AgentSetupPicker";
import {
  AgentButton,
  AgentFeedback,
  AgentNotice,
  AgentText,
} from "@/components/agents/AgentPrimitives";
import { ErrorNotice } from "@/components/ErrorNotice";
import { thinkingLabel } from "@/lib/agents/model";
import { recentAgentSetups, type AgentSetup } from "@/lib/agents/setups";
import { toastError } from "@/lib/toast";
import { useTheme } from "@/lib/theme";
import { useAgentConnections, useAgentCatalog } from "@/lib/queries/agents";
import { useAgentDraft } from "@/lib/agents/drafts";
import { agentJson } from "@/lib/agents/api";
import { getAuthClient } from "@/lib/auth/client";

/**
 * The Agents home: a new session with the agent and workspace used most
 * recently, or the ones the opener named. Pills above the composer switch
 * the machine, folder and agent; the draft follows the switch.
 */
export default function NewAgentScreen() {
  const params = useLocalSearchParams<{
    workspace?: string;
    provider?: string;
    fork?: string;
    chooseWorkspace?: string;
  }>();
  const { colors } = useTheme();
  const connections = useAgentConnections();
  const setups = useMemo(
    () => recentAgentSetups(connections.data ?? []),
    [connections.data],
  );
  const requested =
    params.workspace && isAgentProviderId(params.provider ?? "")
      ? { workspaceId: params.workspace, provider: params.provider as AgentProviderId }
      : null;
  // An agent without its own record of a folder starts from another agent's
  // record, so the folder is looked up by id alone.
  const folder = requested
    ? setups.find((setup) => setup.workspaceId === requested.workspaceId)
    : setups[0];
  const provider = requested?.provider ?? folder?.provider;

  if (!folder || !provider) {
    if (connections.isPending) {
      return (
        <View style={[styles.centered, { backgroundColor: colors.background }]}>
          <Stack.Screen options={{ title: "New agent" }} />
          <ActivityIndicator accessibilityLabel="Loading workspaces" color={colors.mutedForeground} />
        </View>
      );
    }
    if (connections.error) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <Stack.Screen options={{ title: "New agent" }} />
          <AgentFeedback
            error={connections.error.message}
            retry={() => void connections.refetch()}
          />
        </View>
      );
    }
    if (requested) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <Stack.Screen options={{ title: "New agent" }} />
          <AgentFeedback error="This workspace is no longer available. Pick another from the drawer." />
        </View>
      );
    }
    return (
      <View style={[styles.centered, { backgroundColor: colors.background, gap: 12, padding: 24 }]}>
        <Stack.Screen options={{ title: "New agent" }} />
        <Ionicons name="folder-open-outline" size={32} color={colors.mutedForeground} />
        <AgentText title>Your agents, on your phone</AgentText>
        <AgentText muted>
          Add an Agent Connection and a workspace on the web, then start a
          session here.
        </AgentText>
        <AgentButton
          label="Agent connections"
          icon="settings-outline"
          onPress={() => router.push("/settings/connections")}
        />
      </View>
    );
  }
  return (
    <NewAgent
      key={`${folder.workspaceId}:${provider}:${params.fork ?? ""}`}
      setups={setups}
      workspace={folder.workspaceId}
      provider={provider}
      folder={folder}
      chooseWorkspace={params.chooseWorkspace === "1"}
      fork={params.fork}
    />
  );
}

function NewAgent({
  setups,
  workspace,
  provider,
  folder,
  fork,
  chooseWorkspace,
}: {
  setups: AgentSetup[];
  workspace: string;
  provider: AgentProviderId;
  folder: AgentSetup;
  fork?: string;
  chooseWorkspace?: boolean;
}) {
  const { colors, fonts } = useTheme();
  const authSession = getAuthClient().useSession();
  const isAdmin =
    (authSession.data?.user as { role?: string | null } | undefined)?.role ===
    "admin";
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const keyboard = useKeyboardState((state) => state.isVisible);
  const name = folder.workspaceName;
  const [picker, setPicker] = useState<AgentSetupPickerPanel | null>(
    chooseWorkspace ? "workspace" : null,
  );
  const catalog = useAgentCatalog(workspace, provider);
  // One draft for the whole screen, as on the web, so switching the setup
  // keeps what was typed. A fork carries its own history instead.
  const { draft, setDraft, storageError, saveDraftToSession } = useAgentDraft(
    fork ? `fork:${fork}` : "new:agent",
  );
  const [config, setConfig] = useState<AgentSessionLaunchConfig>(
    draft.forkContext?.launchConfig ?? {},
  );
  const [settings, setSettings] = useState<AgentSettingsPanel | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [error, setError] = useState<string>();
  const selection = resolveAgentSessionDraftSelection({
    provider,
    catalog: catalog.data,
    modelId: config.model ?? "",
    thinkingOptionId: config.thinkingOptionId ?? "",
    modeId: config.modeId ?? "",
  });
  const model = selection.model;

  async function send() {
    if (
      lock.current ||
      !catalog.data ||
      !model ||
      (!draft.message.trim() && !draft.images.length)
    )
      return;
    lock.current = true;
    setPending(true);
    setError(undefined);
    let sessionId: string | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    const images = draft.images.map(({ uploadId, filename, mediaType }) => ({
      uploadId,
      filename,
      mediaType,
    }));
    let message: string;
    try {
      message = agentPromptWithHistory(
        draft.message.trim(),
        draft.forkContext?.text,
      );
    } catch (cause) {
      setError(String(cause));
      lock.current = false;
      setPending(false);
      clearTimeout(timer);
      return;
    }
    const command = {
      type: "prompt" as const,
      message,
      ...(images.length ? { images } : {}),
      clientMessageId: randomUUID(),
    };
    try {
      const result = await agentJson<{ session: { id: string } }>(
        `/api/agent-workspaces/${encodeURIComponent(workspace)}/sessions`,
        {
          provider,
          launchConfig: {
            model: model.id,
            ...(selection.thinkingOptionId
              ? { thinkingOptionId: selection.thinkingOptionId }
              : {}),
            ...(selection.modeId ? { modeId: selection.modeId } : {}),
          },
        },
        controller.signal,
      );
      sessionId = result.session.id;
      // Preserve the first prompt and its identity in the new chat before sending.
      // If delivery fails, retry from that chat instead of creating another session.
      if (!mounted.current) {
        saveDraftToSession(sessionId, {
          ...draft,
          message,
          forkContext: undefined,
          pending: undefined,
        });
        return;
      }
      const submittedDraft = {
        ...draft,
        message,
        forkContext: undefined,
        pending: { fingerprint: JSON.stringify({ message, images }), command },
      };
      saveDraftToSession(sessionId, submittedDraft);
      await agentJson(
        `/api/agent-sessions/${encodeURIComponent(sessionId)}`,
        command,
        controller.signal,
      );
      saveDraftToSession(sessionId, (current) =>
        current === submittedDraft ? { message: "", images: [] } : current,
      );
    } catch (cause) {
      if (!mounted.current) return;
      if (!sessionId)
        setError(
          `${cause instanceof Error ? cause.message : "Couldn't start the session."} If the connection was lost, check the session list before trying again.`,
        );
      else
        toastError(
          "First message couldn't be confirmed. Your draft is saved in the chat.",
          cause,
        );
    } finally {
      clearTimeout(timer);
      if (sessionId) {
        setDraft(
          (current) =>
            current === draft ? { message: "", images: [] } : current,
          true,
        );
        if (mounted.current) {
          // The conversation lives beside the chat screen, outside this
          // stack, so a replace would leave this screen behind: pop it first.
          if (router.canGoBack()) router.back();
          router.navigate({
            pathname: "/agent/[id]",
            params: { id: sessionId, workspace, name },
          });
        }
      }
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen options={{ title: "New agent" }} />
      <View style={styles.hero}>
        <AgentProviderIcon provider={provider} size={40} />
        <AgentText title>
          New {agentProviderMetadata(provider).label} session
        </AgentText>
        <Text
          numberOfLines={1}
          style={{
            color: colors.mutedForeground,
            fontFamily: fonts.sansRegular,
            fontSize: 14,
          }}
        >
          {name} · {folder.hostLabel}
        </Text>
      </View>
      <View
        style={{
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: keyboard ? 8 : 12 + insets.bottom,
          gap: 8,
        }}
      >
        {catalog.isPending && (
          <ActivityIndicator
            accessibilityLabel="Loading models"
            color={colors.mutedForeground}
          />
        )}
        {!!(
          error ||
          storageError ||
          catalog.error ||
          (catalog.data && !model)
        ) && (
          <ErrorNotice
            message={
              error ??
              storageError ??
              catalog.error?.message ??
              "No models are available for this agent."
            }
            action={
              catalog.error
                ? { label: "Retry", onPress: () => void catalog.refetch() }
                : undefined
            }
          />
        )}
        {draft.forkContext && (
          <AgentNotice
            icon="git-branch-outline"
            message={`Chat history attached · ${name}`}
            actions={[
              {
                label: "Change workspace",
                onPress: () => setPicker("workspace"),
              },
              {
                label: "Remove history",
                onPress: () =>
                  setDraft(
                    ({ forkContext: _context, ...current }) => current,
                    true,
                  ),
              },
            ]}
          />
        )}
        <AgentSetupPicker
          setups={setups}
          workspaceId={workspace}
          provider={provider}
          // A fork keeps its agent: history only reads back on the same one.
          lockedProvider={draft.forkContext ? provider : null}
          open={picker}
          onOpen={setPicker}
          onChange={(setup) =>
            router.setParams({
              workspace: setup.workspaceId,
              provider: setup.provider,
              chooseWorkspace: "0",
            })
          }
        />
        <AgentComposer
          draft={draft}
          setDraft={setDraft}
          commands={[]}
          provider={provider}
          supportsImages={model?.input.includes("image") === true}
          disabled={!catalog.data || !model}
          sending={pending}
          running={false}
          isAdmin={isAdmin}
          modelLabel={model?.label ?? "Loading model…"}
          thinkingLabel={thinkingLabel(model ?? undefined, selection.thinkingOptionId)}
          permission={(() => {
            const mode = selection.modes.find((item) => item.id === selection.modeId);
            return mode ? { label: mode.label, dangerous: mode.dangerous === true } : undefined;
          })()}
          onSettings={() => {
            Keyboard.dismiss();
            setSettings("settings");
          }}
          onPermissions={() => {
            Keyboard.dismiss();
            setSettings("permissions");
          }}
          onSend={() => void send()}
          onStop={() => {}}
        />
      </View>
      <AgentControls
        visible={settings !== null}
        initialPanel={settings ?? "settings"}
        provider={provider}
        onClose={() => setSettings(null)}
        models={catalog.data?.models ?? []}
        modelId={model?.id ?? ""}
        modes={selection.modes}
        modeId={selection.modeId}
        thinking={selection.thinkingOptionId}
        disabled={pending}
        onModel={(model) =>
          setConfig((value) => ({
            ...value,
            model: model.id,
            thinkingOptionId: undefined,
          }))
        }
        onMode={(mode) => setConfig((value) => ({ ...value, modeId: mode.id }))}
        onThinking={(option) =>
          setConfig((value) => ({ ...value, thinkingOptionId: option.id }))
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  hero: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    padding: 24,
  },
});
