import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";
import type { AgentDraft } from "@/lib/agents/drafts";
import { snapshot } from "@/lib/agents/test-fixtures";

const mocks = vi.hoisted(() => ({
  snapshot: undefined as ReturnType<typeof snapshot> | undefined,
  status: "connected",
  sessionError: undefined as string | undefined,
  send: vi.fn(),
  reconnect: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  alert: vi.fn(),
  copy: vi.fn(),
  uuid: vi.fn(),
  invalidDismiss: vi.fn(),
  backHandlers: new Set<() => boolean>(),
  scrollToEnd: vi.fn(),
  listHandlers: {} as {
    onLoad?: () => void;
    onScrollBeginDrag?: () => void;
    onEndReached?: () => void;
    onContentSizeChange?: () => void;
    onScroll?: (event: {
      nativeEvent: {
        contentSize: { height: number };
        contentOffset: { y: number };
        layoutMeasurement: { height: number };
      };
    }) => void;
  },
  measurements: { height: 2000, viewport: 500, offset: 1500 },
  draft: { message: "", images: [] } as AgentDraft,
  params: {
    id: "session",
    workspace: "workspace",
    name: "Project",
    provider: "codex",
  },
  api: vi.fn(),
  saveDraftToSession: vi.fn(),
  catalog: undefined as unknown,
  connections: [] as AgentConnectionListItem[],
}));

// Native host primitives are adapted to DOM for interaction tests. Production
// components, event handlers, command construction, and transcript projection run unchanged.
vi.mock("react-native", async () => {
  const React = await import("react");
  type Props = {
    children?: ReactNode;
    accessibilityLabel?: string;
    onPress?: () => void;
    disabled?: boolean;
    value?: string;
    onChangeText?: (value: string) => void;
    editable?: boolean;
    testID?: string;
  };
  const View = ({ children }: Props) => <div>{children}</div>;
  const Text = ({ children }: Props) => <span>{children}</span>;
  const TextInput = ({
    value,
    onChangeText,
    accessibilityLabel,
    editable,
  }: Props) => (
    <input
      aria-label={accessibilityLabel}
      value={value ?? ""}
      disabled={editable === false}
      onInput={(event) => onChangeText?.(event.currentTarget.value)}
      onChange={() => {}}
    />
  );
  return {
    View,
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    Text,
    ScrollView: View,
    FlatList: ({
      data,
      renderItem,
      ListHeaderComponent,
      ListEmptyComponent,
    }: {
      data: unknown[];
      renderItem: (args: { item: unknown }) => ReactNode;
      ListHeaderComponent?: ReactNode;
      ListEmptyComponent?: ReactNode;
    }) => (
      <div>
        {ListHeaderComponent}
        {data.length
          ? data.map((item, i) => <div key={i}>{renderItem({ item })}</div>)
          : ListEmptyComponent}
      </div>
    ),
    SectionList: ({
      sections,
      renderItem,
      renderSectionHeader,
      renderSectionFooter,
    }: {
      sections: { key: string; data: unknown[] }[];
      renderItem: (args: { item: unknown; section: unknown }) => ReactNode;
      renderSectionHeader: (args: { section: unknown }) => ReactNode;
      renderSectionFooter: (args: { section: unknown }) => ReactNode;
    }) => (
      <div>
        {sections.map((section) => (
          <div key={section.key}>
            {renderSectionHeader({ section })}
            {section.data.map((item, i) => (
              <div key={i}>{renderItem({ item, section })}</div>
            ))}
            {renderSectionFooter({ section })}
          </div>
        ))}
      </div>
    ),
    TextInput,
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      testID,
    }: Props) => (
      <button
        aria-label={accessibilityLabel}
        data-testid={testID}
        disabled={disabled}
        onClick={onPress}
      >
        {children}
      </button>
    ),
    ActivityIndicator: ({
      accessibilityLabel,
    }: {
      accessibilityLabel?: string;
    }) => (
      <span role="progressbar" aria-label={accessibilityLabel}>
        Loading
      </span>
    ),
    BackHandler: { addEventListener: (_: string, handler: () => boolean) => {
      mocks.backHandlers.add(handler);
      return { remove: () => mocks.backHandlers.delete(handler) };
    } },
    Keyboard: { dismiss: vi.fn() },
    Alert: { alert: mocks.alert },
    Linking: { openURL: vi.fn() },
    Switch: ({
      value,
      onValueChange,
      accessibilityLabel,
    }: {
      value: boolean;
      onValueChange: (value: boolean) => void;
      accessibilityLabel: string;
    }) => (
      <input
        type="checkbox"
        aria-label={accessibilityLabel}
        checked={value}
        onChange={() => onValueChange(!value)}
      />
    ),
  };
});
vi.mock("@gorhom/bottom-sheet", async () => {
  const { useState, useRef, useImperativeHandle, forwardRef } = await import(
    "react"
  );
  const { TextInput, View } = await import("react-native");
  return {
    BottomSheetBackdrop: View,
    BottomSheetScrollView: View,
    BottomSheetTextInput: TextInput,
    BottomSheetModal: forwardRef(
      (
        { children, onDismiss }: { children: ReactNode; onDismiss: () => void },
        ref,
      ) => {
        const [open, setOpen] = useState(false);
        const stuckDismissing = useRef(false);
        useImperativeHandle(ref, () => ({
          present: () => {
            if (!stuckDismissing.current) setOpen(true);
          },
          dismiss: () => {
            if (open) {
              setOpen(false);
              onDismiss();
            } else {
              // Gorhom 5.2: dismissing INITIAL blocks subsequent portal renders.
              stuckDismissing.current = true;
              mocks.invalidDismiss();
            }
          },
        }));
        return open ? <div role="dialog">{children}</div> : null;
      },
    ),
  };
});
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ colors: {}, fonts: {}, radii: {} }),
}));
vi.mock("react-native-svg", () => ({
  default: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => mocks.params,
  router: { replace: mocks.replace, push: mocks.push },
  Stack: {
    Screen: ({
      options,
    }: {
      options?: {
        headerTitle?: () => ReactNode;
        headerRight?: () => ReactNode;
      };
    }) => (
      <header>
        {options?.headerTitle?.()}
        {options?.headerRight?.()}
      </header>
    ),
  },
}));
vi.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 50 }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 20 }),
}));
vi.mock("react-native-keyboard-controller", async () => ({
  KeyboardAvoidingView: (await import("react-native")).View,
  useKeyboardState: () => false,
}));
vi.mock("expo-crypto", () => ({ randomUUID: mocks.uuid }));
vi.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => (
    <span data-icon={name} aria-hidden="true" />
  ),
}));
vi.mock("expo-paste-input", () => ({
  TextInputWrapper: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: mocks.copy }));
vi.mock("@/lib/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("expo-image-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("@/lib/api", () => ({
  uploadFile: vi.fn(),
  getApiBase: () => "https://chat.example",
  getAuthCookie: () => "cookie",
}));
vi.mock("expo-image", () => ({ Image: () => <img /> }));
vi.mock("react-native-image-viewing", () => ({ default: () => null }));
vi.mock("./AgentProviderIcon", () => ({
  AgentProviderIcon: ({ provider }: { provider: string }) => (
    <span data-provider={provider} />
  ),
}));
vi.mock("./AgentImage", () => ({
  AgentImage: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock("@/components/chat/MarkdownBody", () => ({
  MarkdownBody: ({ text }: { text: string }) => <p>{text}</p>,
}));
vi.mock("@shopify/flash-list", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    FlashList: forwardRef(
      (
        props: {
          data: unknown[];
          renderItem: (args: { item: unknown }) => ReactNode;
          ListEmptyComponent: ReactNode;
          ListFooterComponent: ReactNode;
        } & typeof mocks.listHandlers,
        ref,
      ) => {
        mocks.listHandlers = props;
        useImperativeHandle(ref, () => ({
          scrollToEnd: mocks.scrollToEnd,
          getWindowSize: () => ({ height: mocks.measurements.viewport }),
          getChildContainerDimensions: () => ({
            height: mocks.measurements.height,
          }),
          getAbsoluteLastScrollOffset: () => mocks.measurements.offset,
        }));
        return (
          <div>
            {props.data.length
              ? props.data.map((item, i) => (
                  <div key={i}>{props.renderItem({ item })}</div>
                ))
              : props.ListEmptyComponent}
            {props.ListFooterComponent}
          </div>
        );
      },
    ),
  };
});
vi.mock("@/lib/queries/agents", () => ({
  useAgentSession: () => ({
    snapshot: mocks.snapshot,
    status: mocks.status,
    error: mocks.sessionError,
    reconnect: mocks.reconnect,
  }),
  useAgentCommand: () => ({ mutateAsync: mocks.send, isPending: false }),
  useAgentConnections: () => ({
    data: mocks.connections,
    refetch: vi.fn(),
    isPending: false,
  }),
  useAgentGitStatus: () => ({
    data: { isGit: true, branch: "main", dirty: false },
  }),
  useAgentCatalog: () => ({ data: mocks.catalog, isPending: false }),
}));
vi.mock("@/lib/agents/api", () => ({ agentJson: mocks.api }));
vi.mock("@/lib/agents/drafts", async () => {
  const { useState } = await import("react");
  return {
    useAgentDraft: () => {
      const [draft, update] = useState(mocks.draft);
      return {
        draft,
        saveDraftToSession: mocks.saveDraftToSession,
        setDraft: (next: AgentDraft | ((value: AgentDraft) => AgentDraft)) => {
          mocks.draft = typeof next === "function" ? next(mocks.draft) : next;
          update(mocks.draft);
        },
      };
    },
  };
});

import AgentSessionScreen from "@/app/(authed)/agents/[id]";
import AgentsScreen from "@/app/(authed)/agents/index";
import AgentWorkspaceScreen from "@/app/(authed)/agents/workspace";
import { AgentDetailSections } from "./AgentToolDetails";
import NewAgentScreen from "@/app/(authed)/agents/new";

let root: Root;
let container: HTMLElement;
const model = {
  id: "first",
  label: "First model",
  provider: "codex" as const,
  api: "codex",
  baseUrl: "",
  reasoning: true,
  input: ["text", "image"] as ("text" | "image")[],
  contextWindow: null,
  maxTokens: null,
  thinkingOptions: [
    { id: "low", label: "Low" },
    { id: "high", label: "High" },
  ],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.copy.mockResolvedValue(undefined);
  mocks.uuid.mockReturnValue("message-id");
  mocks.measurements = { height: 2000, viewport: 500, offset: 1500 };
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: (timestamp: number) => void) => setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  const { window } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    vi.stubGlobal(key, value);
  container = window.document.getElementById("root") as unknown as HTMLElement;
  root = createRoot(container);
  mocks.snapshot = {
    ...snapshot(),
    models: [model, { ...model, id: "second", label: "Second model" }],
    state: {
      model: { id: "first" },
      modeId: "safe",
      modes: [
        { id: "safe", label: "Safe", description: "Ask before changes" },
        {
          id: "full",
          label: "Full access",
          description: "Unrestricted",
          dangerous: true,
        },
      ],
    },
    commands: [
      { name: "compact", source: "builtin", description: "Compact context" },
    ],
  };
  mocks.draft = { message: "", images: [] };
  mocks.status = "connected";
  mocks.sessionError = undefined;
  mocks.send.mockResolvedValue({});
  mocks.catalog = {
    provider: "codex",
    models: [model],
    modes: mocks.snapshot.state.modes,
    defaultModeId: "safe",
  };
  mocks.api.mockResolvedValue({ session: { id: "created" } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(element: ReactNode = <AgentSessionScreen />) {
  await act(async () => root.render(element));
}
async function click(label: string) {
  const button = container.querySelector(
    `button[aria-label="${label}"]`,
  ) as HTMLButtonElement | null;
  expect(button, `button ${label}`).not.toBeNull();
  await act(async () => button!.click());
}
async function input(value: string) {
  const field = container.querySelector(
    'input[aria-label="Message agent"]',
  ) as HTMLInputElement;
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("agent context usage", () => {
  it("opens details from the header and updates them from live context, not cumulative tokens", async () => {
    mocks.snapshot!.stats.contextUsage = {
      tokens: 49000,
      contextWindow: 100000,
      percent: 49,
    };
    mocks.snapshot!.stats.tokens.total = 900000;
    await render();
    expect(
      container.querySelector(
        'header [aria-label="Context: 49% used. Show details"]',
      ),
    ).not.toBeNull();
    await click("Context: 49% used. Show details");
    const details = () =>
      container.querySelector('[role="dialog"]')!.textContent;
    expect(details()).toContain("49,000 tokens");
    expect(details()).toContain("51,000 tokens");
    expect(details()).toContain("100,000 tokens");
    expect(details()).not.toContain("900,000");
    mocks.snapshot!.stats.contextUsage.tokens = 120000;
    await render();
    expect(details()).toContain("120% used");
    expect(details()).toContain("Remaining0 tokens");
    await click("Close context usage");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps missing usage unknown, including after compaction clears a reading", async () => {
    mocks.snapshot!.stats.contextUsage = {
      tokens: null,
      contextWindow: 100000,
      percent: null,
    };
    await render();
    await click("Context usage unavailable. Show details");
    expect(container.textContent).toContain(
      "hasn't reported context usage yet",
    );
    expect(container.textContent).not.toContain("0% used");
    mocks.snapshot!.stats.contextUsage.tokens = 10000;
    await render();
    expect(container.textContent).toContain("10% used");
    mocks.snapshot!.stats.contextUsage.tokens = null;
    await render();
    expect(container.textContent).not.toContain("10% used");
    mocks.status = "reconnecting";
    await render();
    expect(container.textContent).toContain("Last reported usage");
  });
});

describe("native agent screen workflows", () => {
  it("suppresses brief reconnect notices while disabling sends immediately", async () => {
    vi.useFakeTimers();
    mocks.draft.message = "Continue";
    await render();
    mocks.status = "reconnecting";
    await render();
    const sendButton = () => container.querySelector(
      'button[aria-label="Send message"]',
    ) as HTMLButtonElement;
    expect(sendButton().disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(container.textContent).not.toContain("Reconnecting to your agent");
    mocks.status = "connected";
    await render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(container.textContent).not.toContain("Reconnecting to your agent");
    expect(sendButton().disabled).toBe(false);
  });

  it("shows sustained recovery, keeps its deadline across retries, and clears it on pause", async () => {
    vi.useFakeTimers();
    mocks.status = "reconnecting";
    await render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    mocks.sessionError = "Network lost";
    await render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(container.textContent).not.toContain("Reconnecting to your agent");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(container.textContent).toContain("Reconnecting to your agent");
    await click("Retry");
    expect(mocks.reconnect).toHaveBeenCalledTimes(1);
    mocks.status = "paused";
    await render();
    expect(container.textContent).not.toContain("Reconnecting to your agent");
    mocks.status = "reconnecting";
    await render();
    expect(container.textContent).not.toContain("Reconnecting to your agent");
  });

  it("shows terminal connection errors immediately and cancels a pending recovery notice", async () => {
    vi.useFakeTimers();
    mocks.status = "reconnecting";
    await render();
    mocks.status = "error";
    mocks.sessionError = "Your session expired. Sign in again.";
    await render();
    expect(container.textContent).toContain(mocks.sessionError);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(container.textContent).not.toContain("Reconnecting to your agent");
  });

  it("renders a resumed transcript, sends a prompt, and clears only acknowledged drafts", async () => {
    mocks.snapshot!.messages = [
      { role: "user", content: "Earlier request" },
      { role: "assistant", content: [{ type: "text", text: "Earlier reply" }] },
    ];
    await render();
    expect(container.textContent).toContain("Earlier reply");
    await input("Continue");
    await click("Send message");
    expect(mocks.send).toHaveBeenCalledWith({
      type: "prompt",
      message: "Continue",
      clientMessageId: "message-id",
    });
    expect(mocks.draft.message).toBe("");
    expect(mocks.reconnect).toHaveBeenCalled();
  });
  it("retains an uncertain send and retries with its original identity", async () => {
    mocks.send.mockRejectedValueOnce(new TypeError("Network lost"));
    await render();
    await input("Keep going");
    await click("Send message");
    expect(mocks.draft.message).toBe("Keep going");
    expect(container.textContent).toContain(
      "Check the conversation before retrying",
    );
    await click("Send message");
    expect(mocks.send.mock.calls[1][0]).toEqual(mocks.send.mock.calls[0][0]);
    expect(mocks.draft.message).toBe("");
  });
  it("queues while running and exposes stop and slash commands", async () => {
    mocks.snapshot!.status = "running";
    await render();
    await input("Then test it");
    await click("Queue message");
    expect(mocks.send.mock.lastCall?.[0].type).toBe("queue");
    await click("Stop agent");
    expect(mocks.send.mock.lastCall?.[0]).toEqual({ type: "abort" });
    await input("/");
    await click("/compact");
    await click("Queue message");
    expect(mocks.send.mock.lastCall?.[0]).toEqual({ type: "compact" });
  });
  it("changes models and reasoning and requires confirmation for full access", async () => {
    await render();
    await click("Model, effort, and permissions");
    await click("Model");
    await click("Second model");
    expect(mocks.send.mock.lastCall?.[0]).toEqual({
      type: "set_model",
      modelId: "second",
    });
    await click("Reasoning effort");
    await click("High");
    expect(mocks.send.mock.lastCall?.[0]).toEqual({
      type: "set_thinking_level",
      level: "high",
    });
    const calls = mocks.send.mock.calls.length;
    await click("Permissions");
    await click("Full access");
    expect(mocks.send).toHaveBeenCalledTimes(calls);
    const actions = mocks.alert.mock.lastCall?.[2] as {
      text: string;
      onPress?: () => void;
    }[];
    await act(async () =>
      actions.find((action) => action.text === "Enable")!.onPress!(),
    );
    expect(mocks.send.mock.lastCall?.[0]).toEqual({
      type: "set_mode",
      modeId: "full",
    });
  });
  it("submits the provider's approval value and leaves dismissed requests pending", async () => {
    mocks.snapshot!.pendingInteraction = {
      type: "interaction_request",
      id: "approval",
      method: "select",
      title: "Approve command?",
      options: ["Allow once", "Deny"],
    };
    await render();
    await click("Close request");
    expect(mocks.send).not.toHaveBeenCalled();
    await click("Respond");
    await click("Allow once");
    await click("Submit response");
    expect(mocks.send).toHaveBeenCalledWith({
      type: "interaction_response",
      id: "approval",
      value: "Allow once",
    });
  });
  it("sends image references and supports image-only prompts", async () => {
    mocks.draft.images = [
      {
        uploadId: "image",
        filename: "screen.png",
        mediaType: "image/png",
        size: 100,
        uri: "file:///screen.png",
      },
    ];
    await render();
    await click("Send message");
    expect(mocks.send.mock.lastCall?.[0]).toEqual({
      type: "prompt",
      message: "",
      clientMessageId: "message-id",
      images: [
        { uploadId: "image", filename: "screen.png", mediaType: "image/png" },
      ],
    });
  });
  it("disables sends while reconnecting but allows editing the draft", async () => {
    mocks.status = "reconnecting";
    await render();
    await input("Save for later");
    await click("Send message");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.draft.message).toBe("Save for later");
  });
  it("opens the composer without creating a session, then sends using resolved defaults", async () => {
    await render(<NewAgentScreen />);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(
      container.querySelector('button[aria-label="Start chat"]'),
    ).toBeNull();
    await input("Build the feature");
    await click("Send message");
    expect(mocks.api).toHaveBeenNthCalledWith(
      1,
      "/api/agent-workspaces/workspace/sessions",
      {
        provider: "codex",
        launchConfig: {
          model: "first",
          modeId: "safe",
          thinkingOptionId: "low",
        },
      },
      expect.any(AbortSignal),
    );
    expect(mocks.api).toHaveBeenNthCalledWith(
      2,
      "/api/agent-sessions/created",
      {
        type: "prompt",
        message: "Build the feature",
        clientMessageId: "message-id",
      },
      expect.any(AbortSignal),
    );
    expect(mocks.replace).toHaveBeenCalledWith({
      pathname: "/agents/[id]",
      params: { id: "created", workspace: "workspace", name: "Project" },
    });
    const submitted = mocks.saveDraftToSession.mock.calls[0][1];
    const clear = mocks.saveDraftToSession.mock.lastCall![1];
    expect(clear(submitted)).toEqual({ message: "", images: [] });
    const newer = { message: "Newer draft", images: [] };
    expect(clear(newer)).toBe(newer);
  });
  it("uses a provider-designated model and effort even when they are not first in the catalog", async () => {
    mocks.catalog = {
      provider: "codex",
      models: [
        model,
        {
          ...model,
          id: "preferred",
          label: "Provider default",
          isDefault: true,
          defaultThinkingOptionId: "high",
        },
      ],
      modes: [{ id: "safe", label: "Safe" }],
      defaultModeId: "safe",
    };
    await render(<NewAgentScreen />);
    await input("Hello");
    await click("Send message");
    expect(mocks.api.mock.calls[0][1]).toEqual({
      provider: "codex",
      launchConfig: {
        model: "preferred",
        thinkingOptionId: "high",
        modeId: "safe",
      },
    });
  });
  it("retains optional model controls without requiring a selection before writing", async () => {
    mocks.catalog = {
      provider: "codex",
      models: [model, { ...model, id: "second", label: "Second model" }],
      modes: [{ id: "safe", label: "Safe" }],
      defaultModeId: "safe",
    };
    await render(<NewAgentScreen />);
    await input("Hello");
    await click("Model, effort, and permissions");
    await click("Model");
    await click("Second model");
    await click("Reasoning effort");
    await click("High");
    await click("Done");
    await click("Send message");
    expect(mocks.api.mock.calls[0][1]).toEqual({
      provider: "codex",
      launchConfig: {
        model: "second",
        thinkingOptionId: "high",
        modeId: "safe",
      },
    });
  });
  it("keeps the first prompt and message identity in the created chat if sending fails", async () => {
    mocks.api
      .mockResolvedValueOnce({ session: { id: "created" } })
      .mockRejectedValueOnce(new Error("Disconnected"));
    await render(<NewAgentScreen />);
    await input("Keep this message");
    await click("Send message");
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.saveDraftToSession).toHaveBeenCalledTimes(1);
    expect(mocks.saveDraftToSession).toHaveBeenCalledWith("created", {
      message: "Keep this message",
      images: [],
      pending: {
        fingerprint: JSON.stringify({
          message: "Keep this message",
          images: [],
        }),
        command: {
          type: "prompt",
          message: "Keep this message",
          clientMessageId: "message-id",
        },
      },
    });
    expect(mocks.replace.mock.lastCall?.[0].params.id).toBe("created");
  });
  it("keeps the draft if creation fails and doesn't send or navigate", async () => {
    mocks.api.mockRejectedValueOnce(new Error("Provider unavailable"));
    await render(<NewAgentScreen />);
    await input("Keep this draft");
    await click("Send message");
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.draft.message).toBe("Keep this draft");
    expect(container.textContent).toContain("Provider unavailable");
  });
  it("allows drafting while defaults are unavailable and prevents creation", async () => {
    mocks.catalog = undefined;
    await render(<NewAgentScreen />);
    await input("Write while loading");
    expect(
      (
        container.querySelector(
          'button[aria-label="Send message"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.draft.message).toBe("Write while loading");
  });
});

describe("agent presentation regressions", () => {
  it("opens, dismisses, and reopens settings without dismissing an unmounted native sheet", async () => {
    await render();
    expect(mocks.invalidDismiss).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      await click("Model, effort, and permissions");
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();
      await click("Done");
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    }
    expect(mocks.invalidDismiss).not.toHaveBeenCalled();
  });

  it("renders Codex's answer once and reserves footer content for copying", async () => {
    const answer = "## Finished\n\n**All done.**";
    mocks.snapshot!.messages = [
      {
        id: "assistant",
        role: "assistant",
        overtchatTurnBoundaryId: "turn",
        content: [{ type: "text", text: answer }],
      },
      {
        id: "footer",
        role: "turnFooter",
        messageId: "turn",
        content: answer,
        durationMs: 65000,
      },
    ];
    await render();
    expect(container.textContent?.split(answer)).toHaveLength(2);
    expect(container.textContent).toContain("Worked for 1m 5s");
    expect(container.textContent).not.toContain("Copy response");
    await click("Copy response");
    expect(mocks.copy).toHaveBeenCalledWith(answer);
    expect(
      container.querySelector('button[aria-label="Copied response"]'),
    ).not.toBeNull();
  });

  it("keeps the jump button hidden during initial layout and clears it when jumping or reaching the end", async () => {
    await render();
    const scroll = (offset: number) =>
      mocks.listHandlers.onScroll?.({
        nativeEvent: {
          contentSize: { height: 2000 },
          contentOffset: { y: offset },
          layoutMeasurement: { height: 500 },
        },
      });
    const jump = () =>
      container.querySelector('button[aria-label="Jump to latest"]');
    await act(async () => scroll(0));
    expect(jump()).toBeNull();
    await act(async () => mocks.listHandlers.onLoad?.());
    expect(mocks.scrollToEnd).toHaveBeenCalledWith({ animated: false });
    await act(async () => {
      mocks.listHandlers.onScrollBeginDrag?.();
      scroll(200);
    });
    expect(jump()).not.toBeNull();
    await click("Jump to latest");
    expect(mocks.scrollToEnd).toHaveBeenCalledWith({ animated: true });
    expect(jump()).toBeNull();
    // Position correction may leave a stale native callback on the way down.
    await act(async () => scroll(200));
    expect(jump()).toBeNull();
    await act(async () => {
      mocks.listHandlers.onScrollBeginDrag?.();
      scroll(200);
    });
    expect(jump()).not.toBeNull();
    await act(async () => mocks.listHandlers.onEndReached?.());
    expect(jump()).toBeNull();
  });

  it("recomputes the jump button when content shrinks without a scroll callback", async () => {
    await render();
    await act(async () => {
      mocks.listHandlers.onScrollBeginDrag?.();
      mocks.listHandlers.onScroll?.({
        nativeEvent: {
          contentSize: { height: 2000 },
          contentOffset: { y: 200 },
          layoutMeasurement: { height: 500 },
        },
      });
    });
    const jump = container.querySelector(
      'button[aria-label="Jump to latest"]',
    )!;
    expect(jump).not.toBeNull();
    expect(jump.querySelector('[data-icon="arrow-down"]')).not.toBeNull();
    expect(jump.querySelector('[data-icon="checkmark"]')).toBeNull();
    mocks.measurements = { height: 600, viewport: 500, offset: 100 };
    await act(async () => {
      mocks.listHandlers.onContentSizeChange?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(
      container.querySelector('button[aria-label="Jump to latest"]'),
    ).toBeNull();
  });
});

describe("workspace navigation at scale", () => {
  function setupWorkspaces() {
    const sessions = Array.from({ length: 105 }, (_, i) => ({
      id: `chat-${i}`,
      providerSessionId: `native-${i}`,
      name: `Chat ${i}`,
      firstMessage: null,
      messageCount: 2,
      createdAt: i,
      modifiedAt: i,
      runtimeStatus: "idle" as const,
    }));
    const host = {
      id: "host",
      connectorId: "connector",
      name: "My computer",
      transport: "local" as const,
      sshAlias: null,
    };
    const connection = {
      id: "codex",
      provider: "codex" as const,
      executable: "codex",
      detectedVersion: null,
      lastValidatedAt: null,
      host,
      workspaces: [
        { id: "workspace", path: "/project", name: "Project", sessions },
        { id: "other", path: "/other", name: "Other project", sessions: [] },
      ],
    };
    mocks.connections = [
      connection,
      {
        ...connection,
        id: "claude",
        provider: "claude",
        workspaces: [
          {
            id: "claude-workspace",
            name: "Project",
            path: "/project",
            sessions: [
              {
                ...sessions[0],
                id: "claude-chat",
                name: "Claude chat",
                modifiedAt: 200,
              },
            ],
          },
        ],
      },
    ];
  }
  it("caps previews, combines providers, collapses a workspace, and opens full history", async () => {
    setupWorkspaces();
    await render(<AgentsScreen />);
    expect(container.querySelectorAll("[data-provider]")).toHaveLength(5);
    expect(container.textContent).toContain("Other project");
    expect(container.textContent).not.toContain("Chat 0");
    expect(
      container.querySelectorAll('button[aria-label="Collapse Project"]'),
    ).toHaveLength(1);
    await click("Collapse Project");
    expect(container.textContent).not.toContain("Claude chat");
    await click("Expand Project");
    await click("View all 106 chats");
    expect(mocks.push).toHaveBeenLastCalledWith({
      pathname: "/agents/workspace",
      params: { workspace: "workspace", name: "Project" },
    });
    await render(<AgentWorkspaceScreen />);
    expect(container.textContent).toContain("Chat 0");
    await click("Claude chat, Claude Code");
    expect(mocks.push.mock.lastCall?.[0].params).toEqual({
      id: "claude-chat",
      workspace: "claude-workspace",
      name: "Project",
    });
  });
  it("finds an older chat outside the preview without expanding all histories", async () => {
    setupWorkspaces();
    await render(<AgentsScreen />);
    const field = container.querySelector(
      'input[aria-label="Search workspaces and chats"]',
    ) as HTMLInputElement;
    await act(async () => {
      field.value = "Chat 0";
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Chat 0");
    expect(container.textContent).not.toContain("Other project");
    expect(container.querySelectorAll("[data-provider]")).toHaveLength(1);
  });
});

describe("queued-message composer cards", () => {
  function queue(status: "pending" | "sending" | "uncertain" = "pending") {
    mocks.snapshot!.status = "running";
    mocks.snapshot!.capabilities.steer = true;
    mocks.snapshot!.queuedMessages = [
      { id: "queued-1", message: "Then add tests", status },
    ];
  }
  it("shows the actual queued card and its actions above the input, without a standing notice", async () => {
    queue();
    await render();
    expect(container.textContent).not.toContain("Messages sent while working");
    expect(container.textContent).toContain("Then add tests");
    expect(container.textContent).toContain("Queued");
    const card = container.querySelector(
      'button[aria-label="Edit queued message"]',
    )!;
    const input = container.querySelector('input[aria-label="Message agent"]')!;
    expect(
      [...container.querySelectorAll("button, input")].indexOf(card),
    ).toBeLessThan(
      [...container.querySelectorAll("button, input")].indexOf(input),
    );
    await click("Steer with queued message");
    expect(mocks.send.mock.lastCall?.[0]).toEqual({
      type: "steer_queued_message",
      id: "queued-1",
    });
    await click("Delete queued message");
    expect(mocks.send.mock.lastCall?.[0]).toEqual({
      type: "remove_queued_message",
      id: "queued-1",
    });
  });
  it("moves a queued message and images into an empty composer only after removal succeeds", async () => {
    queue();
    mocks.snapshot!.queuedMessages[0].images = [
      { uploadId: "image", filename: "screen.png", mediaType: "image/png" },
    ];
    await render();
    await click("Edit queued message");
    expect(mocks.send.mock.lastCall?.[0]).toEqual({
      type: "remove_queued_message",
      id: "queued-1",
    });
    expect(mocks.draft.message).toBe("Then add tests");
    expect(mocks.draft.images[0]).toMatchObject({
      uploadId: "image",
      filename: "screen.png",
      mediaType: "image/png",
    });
    expect(
      (
        container.querySelector(
          'button[aria-label="Edit queued message"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("keeps the draft empty when removing a queued message fails", async () => {
    queue();
    mocks.send.mockRejectedValueOnce(new Error("Already sending"));
    await render();
    await click("Edit queued message");
    expect(mocks.draft).toEqual({ message: "", images: [] });
    expect(container.textContent).toContain("Already sending");
  });
  it("matches web's sending and uncertain delivery action availability", async () => {
    queue("sending");
    await render();
    expect(
      container.querySelector('button[aria-label="Edit queued message"]'),
    ).toBeNull();
    expect(
      container.querySelector('button[aria-label="Delete queued message"]'),
    ).toBeNull();
    queue("uncertain");
    await render();
    expect(
      container.querySelector('button[aria-label="Steer with queued message"]'),
    ).toBeNull();
    await click("Delete queued message");
    expect(mocks.send.mock.lastCall?.[0]).toEqual({
      type: "remove_queued_message",
      id: "queued-1",
    });
  });
});

describe("agent conversation header", () => {
  it("places the conversation title, provider icon, branch in the navigation bar without an idle-status row", async () => {
    mocks.snapshot!.state.sessionName = "Polish mobile navigation";
    await render();
    const header = container.querySelector("header")!;
    expect(header.textContent).toContain("Polish mobile navigation");
    expect(header.textContent).toContain("main");
    expect(header.querySelector('[data-provider="codex"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Ready");
    expect(
      container.querySelector('button[aria-label="Open workspace files"]'),
    ).toBeNull();
  });
  it("keeps the workspace title while a session has no name", async () => {
    await render();
    const header = container.querySelector("header")!;
    expect(header.textContent).toContain("Project");
    expect(header.textContent).not.toContain("Ready");
  });
});

describe("agent working indicators", () => {
  it("shows activity in the chat header while working or compacting, and removes it when idle or disconnected", async () => {
    mocks.snapshot!.status = "running";
    await render();
    const spinner = () =>
      container.querySelector('header [aria-label="Agent working"]');
    expect(spinner()).not.toBeNull();
    mocks.snapshot!.status = "idle";
    await render();
    expect(spinner()).toBeNull();
    mocks.snapshot!.state.isCompacting = true;
    await render();
    expect(spinner()).not.toBeNull();
    mocks.status = "connecting";
    await render();
    expect(spinner()).toBeNull();
  });
  it("shows activity on running chat rows and on their collapsed workspace", async () => {
    mocks.connections = [
      {
        id: "codex",
        provider: "codex",
        executable: "codex",
        detectedVersion: null,
        lastValidatedAt: null,
        host: {
          id: "host",
          connectorId: "connector",
          name: "Computer",
          transport: "local",
          sshAlias: null,
        },
        workspaces: [
          {
            id: "workspace",
            name: "Project",
            path: "/project",
            sessions: [
              {
                id: "running-chat",
                providerSessionId: "native",
                name: "Working chat",
                firstMessage: null,
                messageCount: 2,
                modifiedAt: 1,
                createdAt: 1,
                runtimeStatus: "running",
              },
            ],
          },
        ],
      },
    ];
    await render(<AgentsScreen />);
    expect(
      container.querySelector('[aria-label="Agent working"]'),
    ).not.toBeNull();
    await click("Collapse Project");
    expect(
      container.querySelector('[aria-label="1 agent working in Project"]'),
    ).not.toBeNull();
    mocks.connections[0].workspaces[0].sessions[0].runtimeStatus = "idle";
    mocks.connections = [...mocks.connections];
    await render(<AgentsScreen />);
    expect(
      container.querySelector('[aria-label="1 agent working in Project"]'),
    ).toBeNull();
  });
});

describe("readable approvals and tool output", () => {
  it("renders a tool approval command once with direct provider-valued actions", async () => {
    mocks.snapshot!.pendingInteraction = {
      type: "interaction_request",
      id: "approval",
      method: "select",
      title: "Allow tool: bash",
      approvalKind: "tool",
      message: "Command: npm test",
      toolDetail: { type: "shell", command: "npm test" },
      approveValue: "Approve",
      denyValue: "Deny",
    };
    await render();
    expect(container.textContent?.split("npm test")).toHaveLength(2);
    expect(container.textContent).not.toContain('"type"');
    expect(
      container.querySelector('button[aria-label="Submit response"]'),
    ).toBeNull();
    await click("Allow once");
    expect(mocks.send.mock.lastCall?.[0]).toEqual({
      type: "interaction_response",
      id: "approval",
      value: "Approve",
    });
  });
  it("shows Codex's command as code and submits Allow for session directly", async () => {
    mocks.snapshot!.pendingInteraction = {
      type: "interaction_request",
      id: "codex:1",
      method: "select",
      title: "Approve command?",
      message: "Requires network\n\n$ npm install",
      options: ["Allow once", "Allow for session", "Deny"],
    };
    await render();
    expect(container.textContent).toContain("Requires network");
    await click("Copy command");
    expect(mocks.copy).toHaveBeenCalledWith("npm install");
    await click("Allow for session");
    expect(mocks.send.mock.lastCall?.[0]).toEqual({
      type: "interaction_response",
      id: "codex:1",
      value: "Allow for session",
    });
  });
  it("keeps tool output out of the transcript until a tool detail sheet is opened", async () => {
    mocks.snapshot!.messages = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "t1",
            name: "bash",
            arguments: { command: "npm test", cwd: "/repo" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "bash",
        content: [{ type: "text", text: "Tests passed" }],
      },
    ];
    await render();
    expect(container.textContent).not.toContain("Tests passed");
    const summary = [...container.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label")?.includes("command"),
    );
    expect(summary).toBeDefined();
    await act(async () => summary!.click());
    expect(container.textContent).not.toContain("Tests passed");
    await click("Terminal: npm test, completed");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "Tests passed",
    );
    expect(container.textContent).toContain("Working directory");
    await click("Copy output");
    expect(mocks.copy).toHaveBeenCalledWith("Tests passed");
    await click("Close tool details");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

it("expands long output explicitly and copies the full value", async () => {
  const output = Array.from({ length: 300 }, (_, i) => `Output line ${i}`).join(
    "\n",
  );
  await render(
    <AgentDetailSections
      sections={[{ label: "Output", value: output, kind: "code" }]}
    />,
  );
  expect(container.textContent).not.toContain("Output line 299");
  await click("Show more");
  await click("Show more");
  expect(container.textContent).toContain("Output line 299");
  await click("Copy output");
  expect(mocks.copy).toHaveBeenCalledWith(output);
});

describe("audit regressions", () => {
  it("keeps a failed model-change error visible inside the open sheet", async () => {
    mocks.send.mockRejectedValueOnce(new Error("Model unavailable"));
    await render();
    await click("Model, effort, and permissions");
    await click("Model");
    await click("Second model");
    expect(container.querySelector('[role="dialog"]')!.textContent).toContain(
      "Model unavailable",
    );
  });
  it("preserves partially typed decimal answers", async () => {
    mocks.snapshot!.pendingInteraction = {
      type: "interaction_request",
      id: "numeric",
      method: "form",
      title: "Input",
      fields: [
        { id: "amount", label: "Amount", type: "number", required: true },
      ],
    };
    await render();
    const field = container.querySelector(
      'input[aria-label="Amount"]',
    ) as HTMLInputElement;
    await act(async () => {
      field.value = "1.";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(field.value).toBe("1.");
    await act(async () => {
      field.value = "-";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(field.value).toBe("-");
    expect(
      (
        container.querySelector(
          'button[aria-label="Submit response"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () => {
      field.value = "-1.25";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Submit response");
    expect(mocks.send.mock.lastCall?.[0].values).toEqual({ amount: -1.25 });
  });
  it("accepts an explicit No for a required boolean", async () => {
    mocks.snapshot!.pendingInteraction = {
      type: "interaction_request",
      id: "boolean",
      method: "form",
      title: "Input",
      fields: [
        { id: "answer", label: "Answer", type: "boolean", required: true },
      ],
    };
    await render();
    const submit = container.querySelector(
      'button[aria-label="Submit response"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await click("No");
    expect(submit.disabled).toBe(false);
    await click("Submit response");
    expect(mocks.send.mock.lastCall?.[0].values).toEqual({ answer: false });
  });
  it("does not erase a newer draft when an abandoned creation finishes", async () => {
    let finish!: (value: unknown) => void;
    mocks.api.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(<NewAgentScreen key="old" />);
    await input("Old request");
    await click("Send message");
    await render(<NewAgentScreen key="new" />);
    await input("New draft written while the other session starts");
    await act(async () => finish({ session: { id: "created" } }));
    expect(mocks.draft.message).toBe(
      "New draft written while the other session starts",
    );
  });
});

describe("delivery recovery", () => {
  it("requires confirmation before a fresh send, preserving identity for ordinary retries", async () => {
    mocks.uuid.mockReturnValueOnce("original").mockReturnValue("fresh");
    mocks.send.mockRejectedValue(new Error("Previous outcome unknown"));
    await render();
    await input("Keep going");
    await click("Send message");
    await click("Send message");
    expect(mocks.send.mock.calls[1][0].clientMessageId).toBe("original");
    await click("Send again…");
    expect(mocks.send).toHaveBeenCalledTimes(2);
    const buttons = mocks.alert.mock.lastCall![2];
    mocks.snapshot!.status = "running";
    await render();
    // Reopen against the current session state; a new send must now queue.
    await click("Send again…");
    const confirm = mocks.alert.mock.lastCall![2].find(
      (b: { text: string }) => b.text === "Send again",
    );
    await act(async () => confirm.onPress());
    expect(mocks.send.mock.lastCall![0]).toMatchObject({
      type: "queue",
      clientMessageId: "fresh",
    });
    expect(
      buttons.find((b: { text: string }) => b.text === "Cancel"),
    ).toBeDefined();
  });
  it("can discard an already delivered draft after reopening without sending it", async () => {
    mocks.draft = {
      message: "Keep going",
      images: [],
      pending: {
        fingerprint: JSON.stringify({ message: "Keep going", images: [] }),
        command: {
          type: "prompt",
          message: "Keep going",
          clientMessageId: "original",
        },
      },
    };
    await render();
    await click("Already delivered");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.draft).toEqual({ message: "", images: [] });
  });
});

it("opens a single-agent workspace directly in the new chat composer", async () => {
  mocks.connections = [
    {
      id: "connection",
      provider: "codex",
      executable: "codex",
      detectedVersion: null,
      lastValidatedAt: null,
      host: {
        id: "host",
        connectorId: "connector",
        name: "Host",
        transport: "local",
        sshAlias: null,
      },
      workspaces: [
        { id: "workspace", name: "Solo", path: "/solo", sessions: [] },
      ],
    },
  ];
  await render(<AgentsScreen />);
  await click("New chat in Solo");
  expect(mocks.push).toHaveBeenCalledWith({
    pathname: "/agents/new",
    params: { workspace: "workspace", provider: "codex", name: "Solo" },
  });
});

it("renders file approval previews as diffs while preserving provider decision values", async () => {
  mocks.snapshot!.pendingInteraction = {
    type: "interaction_request",
    id: "codex:edit",
    method: "select",
    title: "Approve file changes?",
    options: ["Allow once", "Allow for session", "Deny"],
    toolDetail: {
      type: "edit",
      changes: [{ filePath: "one.ts", patch: "@@\n-old\n+new" }],
    },
  };
  await render();
  const dialog = container.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("one.ts");
  expect(dialog.textContent).toContain("+new");
  expect(dialog.textContent).not.toContain("did not provide a change preview");
  await click("Allow for session");
  expect(mocks.send.mock.lastCall![0]).toMatchObject({
    type: "interaction_response",
    id: "codex:edit",
    value: "Allow for session",
  });
});

it("dismisses the top sheet on Android Back and releases its handler", async () => {
  await render();
  await click("Model, effort, and permissions");
  expect(mocks.backHandlers.size).toBe(1);
  await act(async()=>expect([...mocks.backHandlers].at(-1)!()).toBe(true));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.backHandlers.size).toBe(0);
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});
