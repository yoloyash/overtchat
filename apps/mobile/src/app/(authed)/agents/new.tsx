import { useEffect, useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  KeyboardAvoidingView,
  useKeyboardState,
} from "react-native-keyboard-controller";
import { randomUUID } from "expo-crypto";
import {
  agentProviderMetadata,
  agentPromptWithHistory,
  isAgentProviderId,
  type AgentProviderId,
  type AgentSessionLaunchConfig,
} from "@overtchat/agent-bridge";
import { resolveAgentSessionDraftSelection } from "@overtchat/shared/agent-creation";
import { AgentSessionHeaderTitle } from "@/components/agents/AgentSessionHeader";
import { AgentProviderIcon } from "@/components/agents/AgentProviderIcon";
import { AgentComposer } from "@/components/agents/AgentComposer";
import { AgentControls } from "@/components/agents/AgentControls";
import {
  AgentButton,
  AgentSheet,
  AgentFeedback,
  AgentText,
} from "@/components/agents/AgentPrimitives";
import { toastError } from "@/lib/toast";
import { useTheme } from "@/lib/theme";
import { useAgentConnections, useAgentCatalog } from "@/lib/queries/agents";
import { useAgentDraft } from "@/lib/agents/drafts";
import { agentJson } from "@/lib/agents/api";

export default function NewAgentScreen() {
  const params = useLocalSearchParams<{
    workspace: string;
    provider: string;
    name: string;
    fork?: string;
    chooseWorkspace?: string;
  }>();
  if (!params.workspace || !isAgentProviderId(params.provider ?? ""))
    return <AgentFeedback error="Choose a workspace from Agent Connections." />;
  return (
    <NewAgent
      key={`${params.workspace}:${params.provider}:${params.fork ?? ""}`}
      workspace={params.workspace}
      provider={params.provider as AgentProviderId}
      chooseWorkspace={params.chooseWorkspace === "1"}
      fork={params.fork}
      name={params.name}
    />
  );
}

function NewAgent({
  workspace,
  provider,
  name,
  fork,
  chooseWorkspace,
}: {
  workspace: string;
  provider: AgentProviderId;
  name: string;
  fork?: string;
  chooseWorkspace?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const keyboard = useKeyboardState((state) => state.isVisible);
  const connections = useAgentConnections();
  const [targetWorkspace, setTargetWorkspace] = useState(workspace);
  const [workspacePicker, setWorkspacePicker] = useState(
    chooseWorkspace === true,
  );
  const workspaceOptions = (connections.data ?? [])
    .filter((connection) => connection.provider === provider)
    .flatMap((connection) =>
      connection.workspaces.map((workspace) => ({
        id: workspace.id,
        label: `${workspace.name} · ${connection.host.name}`,
      })),
    );
  const catalog = useAgentCatalog(targetWorkspace, provider);
  const { draft, setDraft, storageError, saveDraftToSession } = useAgentDraft(
    fork ? `fork:${fork}` : `new:${workspace}:${provider}`,
  );
  const [config, setConfig] = useState<AgentSessionLaunchConfig>(
    draft.forkContext?.launchConfig ?? {},
  );
  const [settings, setSettings] = useState(false);
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
        `/api/agent-workspaces/${encodeURIComponent(targetWorkspace)}/sessions`,
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
        if (mounted.current)
          router.replace({
            pathname: "/agents/[id]",
            params: { id: sessionId, workspace: targetWorkspace, name },
          });
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
      <Stack.Screen
        options={{
          title: "New chat",
          headerTitleAlign: "left",
          headerBackButtonDisplayMode: "minimal",
          headerTitle: () => (
            <AgentSessionHeaderTitle
              title="New chat"
              provider={provider}
              workspaceName={name}
            />
          ),
        }}
      />
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          gap: 10,
          padding: 24,
        }}
      >
        <AgentProviderIcon provider={provider} size={40} />
        <AgentText title>
          New {agentProviderMetadata(provider).label} chat
        </AgentText>
        <AgentText muted>{name}</AgentText>
      </View>
      {(catalog.isPending ||
        catalog.error ||
        error ||
        storageError ||
        (catalog.data && !model)) && (
        <AgentFeedback
          loading={catalog.isPending}
          error={
            error ??
            storageError ??
            catalog.error?.message ??
            (catalog.data && !model
              ? "No models are available for this agent."
              : undefined)
          }
          retry={catalog.error ? () => void catalog.refetch() : undefined}
        />
      )}
      <View style={{ paddingBottom: keyboard ? 0 : insets.bottom }}>
        {draft.forkContext && (
          <View style={{ padding: 12 }}>
            <AgentButton
              label={`Workspace: ${workspaceOptions.find((option) => option.id === targetWorkspace)?.label ?? name}`}
              onPress={() => setWorkspacePicker(true)}
            />
            <AgentSheet
              visible={workspacePicker}
              title="Fork workspace"
              onClose={() => setWorkspacePicker(false)}
            >
              {workspaceOptions.map((option) => (
                <AgentButton
                  key={option.id}
                  label={option.label}
                  onPress={() => {
                    setTargetWorkspace(option.id);
                    setWorkspacePicker(false);
                  }}
                />
              ))}
            </AgentSheet>
            <AgentText>Chat history attached</AgentText>
            <AgentButton
              label="Remove history"
              onPress={() =>
                setDraft(
                  ({ forkContext: _context, ...current }) => current,
                  true,
                )
              }
            />
          </View>
        )}
        <AgentComposer
          draft={draft}
          setDraft={setDraft}
          commands={[]}
          provider={provider}
          supportsImages={model?.input.includes("image") === true}
          disabled={!catalog.data || !model}
          sending={pending}
          running={false}
          modelLabel={model?.label ?? "Loading model…"}
          thinkingLabel={selection.thinkingOptionId || undefined}
          modeLabel={
            selection.modes.find((mode) => mode.id === selection.modeId)
              ?.label ?? ""
          }
          onSettings={() => {
            Keyboard.dismiss();
            setSettings(true);
          }}
          onSend={() => void send()}
          onStop={() => {}}
        />
      </View>
      <AgentControls
        visible={settings}
        provider={provider}
        onClose={() => setSettings(false)}
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
