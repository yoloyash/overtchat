import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toastError, toastSuccess } from "@/lib/toast";
import type {
  AgentConnectionListItem,
  AgentProviderSnapshot,
} from "@overtchat/agent-bridge";
import type { AgentDraft } from "@/lib/agents/drafts";
import { snapshot } from "@/lib/agents/test-fixtures";

const mocks = vi.hoisted(() => ({
  screenReader: false,
  snapshot: undefined as ReturnType<typeof snapshot> | undefined,
  status: "connected",
  sessionError: undefined as string | undefined,
  send: vi.fn(),
  reconnect: vi.fn(),
  history: { mutate: vi.fn(), isPending: false, error: null as Error | null },
  replace: vi.fn(),
  push: vi.fn(),
  navigate: vi.fn(),
  back: vi.fn(),
  setParams: vi.fn(),
  // One object, as the real hook returns, so effects keyed on it run once.
  navigation: { setParams: (params: object) => mocks.setParams(params) },
  setRead: vi.fn(),
  sync: vi.fn(),
  pathname: "/chat",
  canGoBack: false,
  toggleDrawer: vi.fn(),
  storage: new Map<string, string>(),
  alert: vi.fn(),
  copy: vi.fn(),
  stopSpeech: vi.fn(),
  playSpeech: vi.fn(),
  dictation: {
    status: "idle" as "idle" | "recording" | "transcribing",
    error: null as { kind: string; role?: string } | null,
    onResult: (_text: string) => {},
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    clearError: vi.fn(),
  },
  uuid: vi.fn(),
  invalidDismiss: vi.fn(),
  backHandlers: new Set<() => boolean>(),
  scrollToOffset: vi.fn(),
  listHandlers: {} as {
    inverted?: boolean;
    maintainVisibleContentPosition?: unknown;
    onScrollBeginDrag?: () => void;
    onScrollEndDrag?: () => void;
    onMomentumScrollBegin?: () => void;
    onMomentumScrollEnd?: () => void;
    onEndReached?: () => void;
    onContentSizeChange?: (width: number, height: number) => void;
    onScroll?: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
  },
  layouts: new Map<string, (event: { nativeEvent: { layout: { y: number; height: number } } }) => void>(),
  draft: { message: "", images: [] } as AgentDraft,
  params: {
    id: "session",
    workspace: "workspace",
    name: "Project",
    provider: "codex",
  } as Record<string, string | undefined>,
  api: vi.fn(),
  saveDraftToSession: vi.fn(),
  catalog: undefined as unknown,
  connections: [] as AgentConnectionListItem[],
  providerSnapshot: undefined as AgentProviderSnapshot | undefined,
}));

// Native host primitives are adapted to DOM for interaction tests. Production
// components, event handlers, command construction, and transcript projection run unchanged.
vi.mock("react-native", async () => {
  const React = await import("react");
  type Props = {
    children?: ReactNode;
    accessibilityLabel?: string;
    accessibilityState?: { selected?: boolean; expanded?: boolean };
    onPress?: () => void;
    onLongPress?: () => void;
    disabled?: boolean;
    value?: string;
    onChangeText?: (value: string) => void;
    editable?: boolean;
    testID?: string;
  };
  const View = ({
    children,
    testID,
    onLayout,
  }: Props & {
    onLayout?: (event: { nativeEvent: { layout: { y: number; height: number } } }) => void;
  }) => {
    if (testID && onLayout) mocks.layouts.set(testID, onLayout);
    return <div data-testid={testID}>{children}</div>;
  };
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
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1, absoluteFill: {} },
    Platform: { OS: "ios", select: (options: { ios?: unknown; default?: unknown }) => options.ios ?? options.default },
    AccessibilityInfo: {
      isScreenReaderEnabled: async () => mocks.screenReader,
      addEventListener: () => ({ remove: () => {} }),
    },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    Text,
    ScrollView: View,
    FlatList: React.forwardRef(
      (
        props: {
          data: unknown[];
          renderItem: (args: { item: unknown; index: number }) => ReactNode;
          keyExtractor?: (item: unknown, index: number) => string;
          CellRendererComponent?: React.ComponentType<{
            cellKey: string;
            children: ReactNode;
          }>;
          ListHeaderComponent?: ReactNode;
          ListFooterComponent?: ReactNode;
          ListEmptyComponent?: ReactNode;
          inverted?: boolean;
        } & typeof mocks.listHandlers,
        ref: React.Ref<unknown>,
      ) => {
        if (props.inverted) mocks.listHandlers = props;
        React.useImperativeHandle(ref, () => ({
          scrollToOffset: mocks.scrollToOffset,
        }));
        const Cell = props.CellRendererComponent;
        const rows = props.data.map((item, index) => {
          const key = props.keyExtractor?.(item, index) ?? String(index);
          return Cell ? (
            <Cell key={key} cellKey={key}>
              {props.renderItem({ item, index })}
            </Cell>
          ) : (
            <div key={key}>{props.renderItem({ item, index })}</div>
          );
        });
        // Inverted lists render newest first; keep the DOM in reading order.
        return props.inverted ? (
          <div>
            {props.ListFooterComponent}
            {rows.reverse()}
            {props.ListHeaderComponent}
          </div>
        ) : (
          <div>
            {props.ListHeaderComponent}
            {props.data.length ? rows : props.ListEmptyComponent}
            {props.ListFooterComponent}
          </div>
        );
      },
    ),
    SectionList: ({
      sections,
      renderItem,
      renderSectionHeader,
      renderSectionFooter,
      ListHeaderComponent,
      ListEmptyComponent,
    }: {
      ListEmptyComponent?: ReactNode;
      sections: { key: string; data: unknown[] }[];
      renderItem: (args: { item: unknown; section: unknown }) => ReactNode;
      renderSectionHeader: (args: { section: unknown }) => ReactNode;
      renderSectionFooter?: (args: { section: unknown }) => ReactNode;
      ListHeaderComponent?: ReactNode;
    }) => (
      <div>
        {ListHeaderComponent}
        {!sections.length && ListEmptyComponent}
        {sections.map((section) => (
          <div key={section.key}>
            {renderSectionHeader({ section })}
            {section.data.map((item, i) => (
              <div key={i}>{renderItem({ item, section })}</div>
            ))}
            {renderSectionFooter?.({ section })}
          </div>
        ))}
      </div>
    ),
    TextInput,
    Pressable: ({
      children,
      onPress,
      onLongPress,
      disabled,
      accessibilityLabel,
      accessibilityState,
      testID,
    }: Props) => (
      <button
        aria-label={accessibilityLabel}
        aria-expanded={accessibilityState?.expanded}
        aria-selected={accessibilityState?.selected}
        data-testid={testID}
        disabled={disabled}
        onClick={onPress}
        onContextMenu={onLongPress}
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
// The drawer's virtualized list renders like the plain one here.
vi.mock("@shopify/flash-list", async () => {
  const { FlatList } = await import("react-native");
  return { FlashList: FlatList };
});
vi.mock("@gorhom/bottom-sheet", async () => {
  const { useState, useRef, useImperativeHandle, forwardRef } = await import(
    "react"
  );
  const { TextInput, View } = await import("react-native");
  return {
    BottomSheetBackdrop: View,
    BottomSheetScrollView: View,
    BottomSheetView: View,
    BottomSheetFooter: View,
    BottomSheetTextInput: TextInput,
    BottomSheetModal: forwardRef(
      (
        {
          children,
          onDismiss,
          footerComponent,
        }: {
          children: ReactNode;
          onDismiss?: () => void;
          footerComponent?: (props: object) => ReactNode;
        },
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
              onDismiss?.();
            } else {
              // Gorhom 5.2: dismissing INITIAL blocks subsequent portal renders.
              stuckDismissing.current = true;
              mocks.invalidDismiss();
            }
          },
        }));
        return open ? (
          <div role="dialog">
            {children}
            {footerComponent?.({})}
          </div>
        ) : null;
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
vi.mock("expo-secure-store", () => ({
  getItem: (key: string) => mocks.storage.get(key) ?? null,
  setItem: (key: string, value: string) => mocks.storage.set(key, value),
}));
vi.mock("expo-router", async () => ({
  useFocusEffect: (await import("react")).useEffect,
  useNavigation: () => mocks.navigation,
  useLocalSearchParams: () => mocks.params,
  usePathname: () => mocks.pathname,
  router: {
    replace: mocks.replace,
    push: mocks.push,
    navigate: mocks.navigate,
    back: mocks.back,
    setParams: mocks.setParams,
    canGoBack: () => mocks.canGoBack,
  },
  Stack: {
    Screen: ({
      options,
    }: {
      options?: {
        headerTitle?: () => ReactNode;
        headerLeft?: (props: { canGoBack: boolean }) => ReactNode;
        headerRight?: (props: { canGoBack: boolean }) => ReactNode;
        headerBackVisible?: boolean;
      };
    }) => (
      <header data-back-visible={options?.headerBackVisible}>
        <div data-header-left>{options?.headerLeft?.({ canGoBack: mocks.canGoBack })}</div>
        {options?.headerTitle?.()}
        <div data-header-right>{options?.headerRight?.({ canGoBack: mocks.canGoBack })}</div>
      </header>
    ),
  },
}));
// The conversation screen sits in the drawer, whose header always carries
// the drawer button on the left.
vi.mock("expo-router/drawer", () => ({
  Drawer: {
    Screen: ({
      options,
    }: {
      options?: { headerTitle?: () => ReactNode; headerRight?: () => ReactNode };
    }) => (
      <header>
        <div data-header-left>
          <button aria-label="Show navigation menu" onClick={mocks.toggleDrawer} />
        </div>
        {options?.headerTitle?.()}
        <div data-header-right>{options?.headerRight?.()}</div>
      </header>
    ),
  },
}));
vi.mock("expo-router/build/react-navigation/drawer", () => ({
  useDrawerStatus: () => "open",
  DrawerToggleButton: () => <button aria-label="Show navigation menu" onClick={mocks.toggleDrawer} />,
}));
vi.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 50 }));
vi.mock("@/lib/useSpeech", () => ({
  useSpeech: () => ({
    activeId: null,
    status: "idle",
    stop: mocks.stopSpeech,
    play: mocks.playSpeech,
  }),
}));
vi.mock("@/components/chat/MiniSpeechPlayer", () => ({
  MiniSpeechPlayer: () => null,
}));
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
vi.mock("react-native-popover-view", async () => {
  const { useEffect, useRef } = await import("react");
  function Popover({
    isVisible,
    children,
    onCloseComplete,
  }: {
    isVisible: boolean;
    children: ReactNode;
    onCloseComplete?: () => void;
  }) {
    const shown = useRef(false);
    useEffect(() => {
      if (shown.current && !isVisible) onCloseComplete?.();
      shown.current = isVisible;
    }, [isVisible, onCloseComplete]);
    return isVisible ? <div role="menu">{children}</div> : null;
  }
  return {
    default: Popover,
    PopoverPlacement: { AUTO: "auto", TOP: "top", BOTTOM: "bottom" },
    Rect: class {},
  };
});
vi.mock("@/components/ui/useMeasuredPopoverAnchor", async () => {
  const { useState } = await import("react");
  return {
    useMeasuredPopoverAnchor: () => {
      const [visible, setVisible] = useState(false);
      return {
        anchorRef: { current: null },
        anchorRect: { x: 0, y: 0, width: 1, height: 1 },
        visible,
        open: () => setVisible(true),
        close: () => setVisible(false),
      };
    },
  };
});
vi.mock("expo-haptics", () => ({
  selectionAsync: () => Promise.resolve(),
  impactAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Medium: "medium" },
}));
vi.mock("expo-paste-input", () => ({
  TextInputWrapper: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: mocks.copy }));
vi.mock("@/lib/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({
  getAuthClient: () => ({
    useSession: () => ({ data: { user: { role: "admin" } } }),
  }),
}));
vi.mock("@/lib/useDictation", () => ({
  useDictation: (onResult: (text: string) => void) => {
    mocks.dictation.onResult = onResult;
    return mocks.dictation;
  },
}));
vi.mock("expo-image-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("@/lib/api", () => ({
  uploadFile: vi.fn(),
  getApiBase: () => "https://chat.example",
  getAuthCookie: () => "cookie",
}));
vi.mock("@/lib/auth/useAuthCookie", () => ({ useAuthCookie: () => "cookie" }));
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
vi.mock("react-native-reanimated", async () => {
  const { useRef } = await import("react");
  const { View } = await import("react-native");
  const transition = { delay: () => transition, duration: () => transition, reduceMotion: () => transition };
  return {
    default: { View }, FadeIn: transition, ReduceMotion: { System: "system" },
    Easing: { linear: "linear" },
    useSharedValue: (value: number) => useRef({ value }).current,
    useAnimatedStyle: (style: () => unknown) => style(),
    withTiming: (value: number) => value,
    withRepeat: (value: number) => value,
    withSequence: (...values: number[]) => values[0],
  };
});
vi.mock("@/lib/queries/agents", async () => {
  const { findAgentSession, groupWorkspaces } = await import(
    "@/lib/agents/workspaces"
  );
  return {
  useAgentSessionListing: (id: string) =>
    findAgentSession(groupWorkspaces(mocks.connections), id),
  useAgentSession: () => ({
    snapshot: mocks.snapshot,
    status: mocks.status,
    error: mocks.sessionError,
    reconnect: mocks.reconnect,
    history: mocks.history,
  }),
  useAgentCommand: () => ({ mutateAsync: mocks.send, isPending: false }),
  useMarkAgentSessionSeen: () => {},
  useSetAgentSessionRead: () => ({ mutate: mocks.setRead, isPending: false }),
  useSyncAgentWorkspaces: () => ({ mutate: mocks.sync, isPending: false }),
  useAgentConnections: () => ({
    data: mocks.connections,
    refetch: vi.fn(),
    isPending: false,
  }),
  useAgentGitStatus: () => ({
    data: { isGit: true, branch: "main", dirty: false },
  }),
  useAgentCatalog: () => ({ data: mocks.catalog, isPending: false }),
  useAgentProviderSnapshot: () => ({
    data: mocks.providerSnapshot,
    isSuccess: true,
    isError: false,
  }),
  };
});
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

import AgentSessionScreen from "@/app/(authed)/(drawer)/agent/[id]";
import NewAgentScreen from "@/app/(authed)/(drawer)/agents/index";
import AgentHistoryScreen from "@/app/(authed)/(drawer)/agents/history";
import AgentWorkspaceScreen from "@/app/(authed)/(drawer)/agents/workspace";
import { AgentsDrawer } from "@/components/drawer/AgentsDrawer";
import type { useAgentConnections } from "@/lib/queries/agents";
import { AgentDetailSections } from "./AgentToolDetails";

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
  mocks.screenReader = false;
  mocks.storage.clear();
  mocks.history.isPending = false;
  mocks.history.error = null;
  mocks.pathname = "/chat";
  mocks.canGoBack = false;
  mocks.params = { id: "session", workspace: "workspace", name: "Project", provider: "codex" };
  mocks.providerSnapshot = undefined;
  mocks.connections = [];
  mocks.copy.mockResolvedValue(undefined);
  mocks.uuid.mockReturnValue("message-id");
  mocks.layouts.clear();
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
  mocks.dictation.status = "idle";
  mocks.dictation.error = null;
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
async function input(value: string, label = "Message agent") {
  const field = container.querySelector(
    `input[aria-label="${label}"]`,
  ) as HTMLInputElement;
  expect(field, `input ${label}`).not.toBeNull();
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function longPress(label: string) {
  const button = container.querySelector(
    `button[aria-label="${label}"]`,
  ) as HTMLButtonElement | null;
  expect(button, `button ${label}`).not.toBeNull();
  await act(async () => {
    button!.dispatchEvent(new Event("contextmenu", { bubbles: true }));
  });
}
const localHost = {
  id: "host",
  connectorId: "connector",
  name: "My computer",
  transport: "local" as const,
  sshAlias: null,
};
function chat(
  id: string,
  overrides: Partial<AgentConnectionListItem["workspaces"][number]["sessions"][number]> = {},
): AgentConnectionListItem["workspaces"][number]["sessions"][number] {
  return {
    id,
    providerSessionId: `native-${id}`,
    name: id,
    firstMessage: null,
    messageCount: 2,
    createdAt: 1,
    modifiedAt: 1,
    runtimeStatus: "idle",
    ...overrides,
  };
}
function connection(
  provider: AgentConnectionListItem["provider"],
  workspaces: AgentConnectionListItem["workspaces"],
): AgentConnectionListItem {
  return {
    id: provider,
    provider,
    executable: provider,
    detectedVersion: null,
    lastValidatedAt: null,
    host: localHost,
    workspaces,
  };
}
/** The new-session screen resolves its folder from the list, so one must exist. */
async function renderNewAgent() {
  if (!mocks.connections.length) {
    mocks.connections = [
      connection("codex", [
        { id: "workspace", path: "/project", name: "Project", sessions: [] },
      ]),
    ];
  }
  await render(<NewAgentScreen />);
}
function agentConnections() {
  return {
    data: mocks.connections,
    isPending: false,
    error: null,
    refreshing: false,
    refresh: vi.fn(),
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useAgentConnections>;
}
function renderAgentsDrawer(pathname = "/chat", onNavigate = vi.fn()) {
  return render(
    <AgentsDrawer
      key={`${pathname}:${mocks.connections.length}`}
      connections={agentConnections()}
      pathname={pathname}
      onNavigate={onNavigate}
    />,
  );
}
const rowLabels = () =>
  [...container.querySelectorAll('button[aria-label*="My computer"]')].map((row) =>
    row.getAttribute("aria-label"),
  );

it("keeps the drawer button on the left, the session menu on the right, and the context control reachable", async () => {
  await render();
  expect(container.querySelectorAll('button[aria-label="Show navigation menu"]')).toHaveLength(1);
  expect(
    container.querySelector('button[aria-label="Show navigation menu"]')?.closest("[data-header-left]"),
  ).not.toBeNull();
  expect(
    container.querySelector('button[aria-label="Session actions"]')?.closest("[data-header-right]"),
  ).not.toBeNull();
  await click("Show navigation menu");
  expect(mocks.toggleDrawer).toHaveBeenCalledTimes(1);
  await click("Context usage unavailable. Show details");
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});

describe("agent session menu", () => {
  function listSession() {
    mocks.connections = [
      {
        id: "codex",
        provider: "codex",
        executable: "codex",
        detectedVersion: null,
        lastValidatedAt: null,
        host: { id: "host", connectorId: "connector", name: "My computer", transport: "local", sshAlias: null },
        workspaces: [
          {
            id: "workspace",
            path: "/Users/me/project",
            name: "Project",
            sessions: [
              {
                id: "session",
                providerSessionId: "native-session",
                name: null,
                firstMessage: "Hello",
                messageCount: 1,
                createdAt: 1,
                modifiedAt: 1,
                runtimeStatus: "idle",
              },
            ],
          },
        ],
      },
    ];
  }
  const rows = () =>
    [...container.querySelectorAll('[role="menu"] button')].map((row) => [
      row.getAttribute("aria-label"),
      (row as HTMLButtonElement).disabled,
    ]);

  it("lists the session's actions under its title and renames it through a sheet", async () => {
    listSession();
    mocks.snapshot!.state.sessionName = "Polish navigation";
    await render();
    await click("Session actions");
    expect(container.querySelector('[role="menu"]')!.textContent).toContain("Polish navigation");
    expect(rows()).toEqual([
      ["Rename", false],
      ["Compact context", false],
      ["Account usage", false],
      ["Open workspace", false],
      ["Copy session ID", false],
      ["Copy workspace path", false],
    ]);
    await click("Rename");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    const field = container.querySelector('input[aria-label="Session name"]') as HTMLInputElement;
    expect(field.value).toBe("Polish navigation");
    await act(async () => {
      field.value = "Ship navigation";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Save");
    expect(mocks.send).toHaveBeenCalledWith({ type: "set_session_name", name: "Ship navigation" });
    expect(toastSuccess).toHaveBeenCalledWith("Renamed");
  });

  it("confirms compaction, shows account usage, and copies identifiers", async () => {
    listSession();
    await render();
    await click("Session actions");
    await click("Compact context");
    expect(mocks.alert).toHaveBeenCalledWith(
      "Compact context?",
      expect.stringContaining("can't be undone"),
      expect.any(Array),
    );
    const buttons = mocks.alert.mock.lastCall![2] as { text: string; onPress?: () => void }[];
    expect(mocks.send).not.toHaveBeenCalled();
    await act(async () => buttons.find((button) => button.text === "Compact")!.onPress!());
    expect(mocks.send).toHaveBeenCalledWith({ type: "compact" });
    mocks.send.mockResolvedValueOnce({
      usage: { planType: "Pro", windows: [{ id: "5h", label: "5 hours", usedPercent: 40, resetsAt: null }] },
    });
    await click("Session actions");
    await click("Account usage");
    expect(mocks.send).toHaveBeenCalledWith({ type: "show_usage" });
    expect(container.textContent).toContain("5 hours · 40% used");
    await click("Session actions");
    await click("Copy session ID");
    expect(mocks.copy).toHaveBeenCalledWith("native-session");
    expect(toastSuccess).toHaveBeenCalledWith("Session ID copied");
    await click("Session actions");
    await click("Copy workspace path");
    expect(mocks.copy).toHaveBeenCalledWith("/Users/me/project");
    await click("Session actions");
    await click("Open workspace");
    expect(mocks.push).toHaveBeenLastCalledWith({
      pathname: "/agents/workspace",
      params: { workspace: "workspace", name: "Project" },
    });
  });

  it("greys session commands while disconnected, hides renaming where unsupported, and waits for the session to load", async () => {
    listSession();
    mocks.status = "reconnecting";
    await render();
    await click("Session actions");
    expect(rows()).toEqual([
      ["Rename", true],
      ["Compact context", true],
      ["Account usage", true],
      ["Open workspace", false],
      ["Copy session ID", false],
      ["Copy workspace path", false],
    ]);
    await click("Copy session ID");
    mocks.status = "connected";
    mocks.snapshot!.provider = "hermes";
    mocks.snapshot!.capabilities.usage = false;
    await render();
    await click("Session actions");
    expect(rows().map(([label]) => label)).toEqual([
      "Compact context",
      "Open workspace",
      "Copy session ID",
      "Copy workspace path",
    ]);
    await click("Copy session ID");
    mocks.snapshot = undefined;
    mocks.connections = [];
    await render();
    expect(
      (container.querySelector('button[aria-label="Session actions"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("fills the folder in from the connection list when a notification opens a session by id alone", async () => {
    listSession();
    mocks.params = { id: "session" };
    await render();
    expect(container.querySelector("header")!.textContent).toContain("Project");
    await click("Session actions");
    await click("Open workspace");
    expect(mocks.push).toHaveBeenLastCalledWith({
      pathname: "/agents/workspace",
      params: { workspace: "workspace", name: "Project" },
    });
  });
});

describe("agent context usage", () => {
  it("opens details from the composer and updates them from live context, not cumulative tokens", async () => {
    mocks.snapshot!.stats.contextUsage = {
      tokens: 49000,
      contextWindow: 100000,
      percent: 49,
    };
    mocks.snapshot!.stats.tokens.total = 900000;
    await render();
    expect(
      container.querySelector('header [aria-label^="Context"]'),
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Context: 49% used. Show details"]'),
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

describe("agent history actions", () => {
  it("loads older native transcript pages when reaching the top, with loading and retry feedback", async () => {
    mocks.snapshot!.messages = [{ role: "user", id: "latest", content: "Latest" }];
    mocks.snapshot!.history = { beforeCursor: "older" };
    await render();
    await act(async () => mocks.listHandlers.onEndReached?.());
    expect(mocks.history.mutate).toHaveBeenCalledTimes(1);
    mocks.history.isPending = true;
    await render();
    expect(
      container.querySelector('[role="progressbar"][aria-label="Loading older messages"]'),
    ).not.toBeNull();
    // A request in flight is not repeated.
    await act(async () => mocks.listHandlers.onEndReached?.());
    expect(mocks.history.mutate).toHaveBeenCalledTimes(1);
    mocks.history.isPending = false;
    mocks.history.error = new Error("History changed. Try again.");
    await render();
    expect(container.textContent).toContain("History changed. Try again.");
    // Failures wait for an explicit retry instead of looping on scroll.
    await act(async () => mocks.listHandlers.onEndReached?.());
    expect(mocks.history.mutate).toHaveBeenCalledTimes(1);
    await click("Retry");
    expect(mocks.history.mutate).toHaveBeenCalledTimes(2);
    mocks.history.error = null;
    mocks.snapshot!.history.beforeCursor = null;
    await render();
    await act(async () => mocks.listHandlers.onEndReached?.());
    expect(mocks.history.mutate).toHaveBeenCalledTimes(2);
  });

  it("rewinds from a native message and preserves an existing draft", async () => {
    mocks.snapshot!.capabilities.rewindConversation = true;
    mocks.snapshot!.messages = [
      { role: "user", id: "native-user", content: "Original prompt" },
    ];
    mocks.draft.message = "Keep my draft";
    mocks.send.mockResolvedValue({
      sessionId: "session",
      draft: "Original prompt",
    });
    await render();
    await click("Rewind to this message");
    expect(container.textContent).toContain("This action cannot be undone");
    await click("Rewind conversation");
    expect(mocks.send).toHaveBeenCalledWith({
      type: "rewind",
      messageId: "native-user",
      mode: "conversation",
    });
    expect(mocks.draft.message).toBe("Keep my draft");
  });

  it("restores a rewound prompt into an empty composer", async () => {
    mocks.snapshot!.capabilities.rewindBoth = true;
    mocks.snapshot!.messages = [
      { role: "user", id: "native-user", content: "Original" },
    ];
    mocks.send.mockResolvedValue({ sessionId: "session", draft: "Original" });
    await render();
    await click("Rewind to this message");
    await click("Rewind conversation and files");
    expect(mocks.draft.message).toBe("Original");
  });

  it("hides current-turn speech and fork actions through tool calls until completion", async () => {
    mocks.snapshot!.status = "running";
    mocks.snapshot!.messages = [
      { role: "user", id: "old-user", content: "Earlier question" },
      { role: "assistant", id: "old-answer", content: [{ type: "text", text: "Earlier answer" }] },
      { role: "user", id: "current-user", content: "Check the files" },
      { role: "assistant", id: "progress", content: [{ type: "text", text: "Checking the files" }] },
      { role: "assistant", id: "tool", content: [{ type: "toolCall", id: "call", name: "bash", arguments: { command: "ls" } }] },
    ];
    const speechButtons = () => container.querySelectorAll('button[aria-label="Read aloud"]');
    const forkButtons = () => container.querySelectorAll('button[aria-label="Fork conversation"]');
    await render();
    expect(speechButtons()).toHaveLength(1);
    expect(forkButtons()).toHaveLength(1);
    mocks.snapshot!.messages = [
      ...mocks.snapshot!.messages,
      { role: "assistant", id: "final", content: [{ type: "text", text: "Finished checking" }] },
    ];
    await render();
    expect(speechButtons()).toHaveLength(1);
    expect(forkButtons()).toHaveLength(1);
    mocks.snapshot!.status = "idle";
    await render();
    expect(speechButtons()).toHaveLength(2);
    expect(forkButtons()).toHaveLength(2);
    expect(container.textContent).not.toContain("Checking the files");
    expect(container.textContent).toContain("Finished checking");
    await click("Worked");
    expect(speechButtons()).toHaveLength(2);
    expect(forkButtons()).toHaveLength(2);
    expect(container.textContent).toContain("Checking the files");
    await click("Worked");
    expect(container.textContent).not.toContain("Checking the files");
  });

  it("uses one action row for a completed native turn and reads the footer response", async () => {
    mocks.snapshot!.messages = [
      { role: "user", id: "user", content: "Check" },
      { role: "assistant", id: "progress", content: [{ type: "text", text: "Checking" }] },
      { role: "assistant", id: "answer", content: [{ type: "text", text: "Summary" }, { type: "text", text: "Details" }] },
      { role: "turnFooter", messageId: "boundary", content: "Summary\n\nDetails", durationMs: 2000 },
    ];
    await render();
    await click("Worked for 2s");
    expect(container.querySelectorAll('button[aria-label="Read aloud"]')).toHaveLength(1);
    expect(container.querySelectorAll('button[aria-label="Copy response"]')).toHaveLength(1);
    expect(container.querySelectorAll('button[aria-label="Fork conversation"]')).toHaveLength(1);
    await click("Read aloud");
    expect(mocks.playSpeech).toHaveBeenCalledWith(expect.any(String), "Summary\n\nDetails");
    await click("Copy response");
    expect(mocks.copy).toHaveBeenCalledWith("Summary\n\nDetails");
  });

  it("opens a fork draft with attached history without sending a prompt", async () => {
    mocks.snapshot!.messages = [
      {
        role: "assistant",
        id: "answer",
        content: [{ type: "text", text: "An answer" }],
      },
    ];
    const forkContext = {
      text: "Chat history",
      launchConfig: { model: "model-id" },
    };
    mocks.send.mockResolvedValue({ forkContext });
    await render();
    const forkTrigger = container.querySelector('button[aria-label="Fork conversation"]')!;
    expect(forkTrigger.textContent).not.toContain("Fork conversation");
    expect(forkTrigger.querySelector('[data-icon="git-branch-outline"]')).not.toBeNull();
    await click("Fork conversation");
    await click("Fork in new session");
    expect(mocks.send).toHaveBeenCalledWith({
      type: "fork_message",
      messageId: "answer",
    });
    expect(mocks.saveDraftToSession).toHaveBeenCalledWith(
      expect.stringMatching(/^fork:/),
      { message: "", images: [], forkContext },
    );
    expect(mocks.push).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/agents",
        params: expect.objectContaining({ workspace: "workspace", provider: "codex" }),
      }),
    );
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
    const mic = () => container.querySelector('button[aria-label="Start dictation"]');
    // Dictation stays available for a follow-up and alongside typed text.
    expect(mic()).not.toBeNull();
    await input("Then test it");
    expect(mic()).not.toBeNull();
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
      approvalKind: "tool",
      approveValue: "Allow once",
      alwaysValue: "Allow for session",
      alwaysLabel: "Allow for session",
      denyValue: "Deny",
      options: ["Allow once", "Deny"],
    };
    await render();
    await click("Close request");
    expect(mocks.send).not.toHaveBeenCalled();
    await click("Respond");
    await click("Allow once");
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
    await renderNewAgent();
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
    expect(mocks.navigate).toHaveBeenCalledWith({
      pathname: "/agent/[id]",
      params: { id: "created", workspace: "workspace", name: "Project" },
    });
    // Nothing to pop from the Agents stack in this harness.
    expect(mocks.back).not.toHaveBeenCalled();
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
    await renderNewAgent();
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
    await renderNewAgent();
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
    await renderNewAgent();
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
    expect(mocks.navigate.mock.lastCall?.[0].params.id).toBe("created");
  });
  it("preserves attached fork history and retry identity when its first send fails", async () => {
    mocks.draft.forkContext = { text: "Previous history", launchConfig: { model: model.id } };
    mocks.api.mockResolvedValueOnce({ session: { id: "fork-created" } }).mockRejectedValueOnce(new Error("Disconnected"));
    await renderNewAgent();
    await input("Continue here");
    await click("Send message");
    const message = "Previous history\n\nContinue here";
    expect(mocks.api.mock.calls[1][1]).toMatchObject({ type: "prompt", message });
    expect(mocks.saveDraftToSession).toHaveBeenCalledWith("fork-created", expect.objectContaining({
      message, forkContext: undefined,
      pending: { fingerprint: JSON.stringify({ message, images: [] }), command: { type: "prompt", message, clientMessageId: "message-id" } },
    }));
  });

  it("keeps the draft if creation fails and doesn't send or navigate", async () => {
    mocks.api.mockRejectedValueOnce(new Error("Provider unavailable"));
    await renderNewAgent();
    await input("Keep this draft");
    await click("Send message");
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.draft.message).toBe("Keep this draft");
    expect(container.textContent).toContain("Provider unavailable");
  });
  it("allows drafting while defaults are unavailable and prevents creation", async () => {
    mocks.catalog = undefined;
    await renderNewAgent();
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

  it("anchors the transcript at the newest content and keeps the reader's place natively", async () => {
    mocks.snapshot!.messages = [
      { role: "user", id: "first", content: "First" },
      { role: "assistant", id: "answer", content: [{ type: "text", text: "Answer" }] },
      { role: "user", id: "second", content: "Second" },
    ];
    await render();
    expect(mocks.listHandlers.inverted).toBe(true);
    // A constant configuration: iOS applies its last anchor when this turns back on.
    const position = mocks.listHandlers.maintainVisibleContentPosition;
    expect(position).toEqual({ minIndexForVisible: 0 });
    mocks.snapshot!.status = "running";
    await render();
    expect(mocks.listHandlers.maintainVisibleContentPosition).toBe(position);
    // The DOM keeps reading order even though the native list is inverted.
    const text = container.textContent ?? "";
    expect(text.indexOf("First")).toBeLessThan(text.indexOf("Answer"));
    expect(text.indexOf("Answer")).toBeLessThan(text.indexOf("Second"));
  });

  it("keeps following the newest content until the reader scrolls away", async () => {
    mocks.snapshot!.messages = [{ role: "user", id: "first", content: "First" }];
    await render();
    const scroll = (y: number) =>
      act(async () =>
        mocks.listHandlers.onScroll?.({ nativeEvent: { contentOffset: { y } } }),
      );
    // Position keeping moved the list for a new row below the reader.
    await scroll(150);
    expect(mocks.scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
    mocks.scrollToOffset.mockClear();
    // The reader drags away and lets go.
    await act(async () => mocks.listHandlers.onScrollBeginDrag?.());
    await scroll(500);
    await act(async () => {
      mocks.listHandlers.onScrollEndDrag?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    await scroll(700);
    expect(mocks.scrollToOffset).not.toHaveBeenCalled();
    // Momentum that ends back at the newest content resumes following.
    await act(async () => mocks.listHandlers.onMomentumScrollBegin?.());
    await scroll(10);
    await act(async () => mocks.listHandlers.onMomentumScrollEnd?.());
    await scroll(120);
    expect(mocks.scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
  });

  it("leaves screen reader scrolling where the reader put it", async () => {
    mocks.screenReader = true;
    mocks.snapshot!.messages = [{ role: "user", id: "first", content: "First" }];
    await render();
    const scroll = (y: number) =>
      act(async () =>
        mocks.listHandlers.onScroll?.({ nativeEvent: { contentOffset: { y } } }),
      );
    // Screen readers scroll without drag events.
    await scroll(400);
    expect(mocks.scrollToOffset).not.toHaveBeenCalled();
    await scroll(10);
    await scroll(150);
    expect(mocks.scrollToOffset).not.toHaveBeenCalled();
  });

  it("offers a jump to the newest content only after scrolling away from it", async () => {
    mocks.snapshot!.messages = [{ role: "user", id: "first", content: "First" }];
    await render();
    const scroll = (y: number) =>
      act(async () =>
        mocks.listHandlers.onScroll?.({ nativeEvent: { contentOffset: { y } } }),
      );
    const jump = () => container.querySelector('button[aria-label="Jump to latest"]');
    expect(jump()).toBeNull();
    await act(async () => mocks.listHandlers.onScrollBeginDrag?.());
    await scroll(200);
    expect(jump()).toBeNull();
    await scroll(600);
    expect(jump()).not.toBeNull();
    await click("Jump to latest");
    expect(mocks.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
    await scroll(0);
    expect(jump()).toBeNull();
  });

  it("returns to the newest content when sending from further up", async () => {
    mocks.snapshot!.messages = [{ role: "user", id: "first", content: "First" }];
    mocks.draft.message = "Next step";
    await render();
    await act(async () =>
      mocks.listHandlers.onScroll?.({ nativeEvent: { contentOffset: { y: 900 } } }),
    );
    await click("Send message");
    expect(mocks.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it("keeps an opened row's top edge in place while its content opens below it", async () => {
    mocks.snapshot!.messages = [
      { role: "user", id: "user", content: "Check" },
      { role: "assistant", id: "progress", content: [{ type: "text", text: "Checking" }] },
      { role: "assistant", id: "tool", content: [{ type: "toolCall", id: "call", name: "bash", arguments: { command: "ls" } }] },
      { role: "toolResult", toolCallId: "call", content: [{ type: "text", text: "README.md" }] },
      { role: "assistant", id: "answer", content: [{ type: "text", text: "Summary" }] },
      { role: "turnFooter", messageId: "boundary", content: "Summary", durationMs: 2000 },
    ];
    await render();
    const cell = (prefix: string) =>
      container
        .querySelector(`[data-testid^="agent-transcript-cell:${prefix}"]`)
        ?.getAttribute("data-testid") ?? "";
    const layout = (testID: string, y: number, height: number) =>
      act(async () => mocks.layouts.get(testID)?.({ nativeEvent: { layout: { y, height } } }));
    const scroll = (y: number) =>
      act(async () => {
        mocks.listHandlers.onScrollBeginDrag?.();
        mocks.listHandlers.onScroll?.({ nativeEvent: { contentOffset: { y } } });
        mocks.listHandlers.onMomentumScrollEnd?.();
      });

    // Revealed steps are inserted below the summary, which moves its top edge.
    const summary = cell("work:");
    await layout(summary, 500, 40);
    await scroll(300);
    await click("Worked for 2s");
    expect(container.textContent).toContain("Checking");
    await layout(summary, 800, 40);
    expect(mocks.scrollToOffset).toHaveBeenLastCalledWith({ offset: 600, animated: false });
    // Rows measured elsewhere do not move the reader.
    mocks.scrollToOffset.mockClear();
    await layout(cell("assistant"), 2000, 400);
    expect(mocks.scrollToOffset).not.toHaveBeenCalled();
    // A group that grows in place keeps its header still too.
    await scroll(600);
    const activity = cell("activity:");
    await layout(activity, 120, 36);
    await click("Ran 1 command");
    await layout(activity, 120, 200);
    expect(mocks.scrollToOffset).toHaveBeenLastCalledWith({ offset: 764, animated: false });
    // Dragging hands control back to the reader.
    mocks.scrollToOffset.mockClear();
    await click("Ran 1 command");
    await act(async () => mocks.listHandlers.onScrollBeginDrag?.());
    await layout(activity, 120, 36);
    expect(mocks.scrollToOffset).not.toHaveBeenCalled();
  });

  it("times a running turn in its header and shows session errors after the transcript", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
    mocks.snapshot!.status = "running";
    mocks.snapshot!.activeTurn = { startedAt: Date.now() - 65_000 };
    mocks.snapshot!.messages = [{ role: "user", id: "first", content: "Go" }];
    await render();
    const header = () => container.querySelectorAll('[data-testid="agent-run-header"]');
    // Before any reply: the timer, then one live row.
    expect(header()).toHaveLength(1);
    expect(header()[0]!.textContent).toBe("Working for 1m 5s");
    expect(container.querySelectorAll('[role="progressbar"][aria-label="Thinking"]')).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(header()[0]!.textContent).toBe("Working for 1m 7s");
    // Once the turn has rows, the timer leads its first row and stays there.
    mocks.snapshot!.messages = [
      ...mocks.snapshot!.messages,
      { role: "assistant", id: "progress", content: [{ type: "text", text: "Looking first." }] },
      { role: "assistant", id: "tool-1", content: [{ type: "toolCall", id: "call", name: "bash", arguments: { command: "ls" } }] },
    ];
    await render();
    expect(header()).toHaveLength(1);
    expect(header()[0]!.closest('[data-testid^="agent-transcript-cell:"]')?.textContent).toContain(
      "Looking first.",
    );
    // Compaction has its own status line; the timer steps aside.
    mocks.snapshot!.state.isCompacting = true;
    await render();
    expect(header()).toHaveLength(0);
    expect(container.textContent).toContain("Compacting context");
    mocks.snapshot!.state.isCompacting = false;
    mocks.snapshot!.status = "idle";
    mocks.snapshot!.error = "The agent stopped unexpectedly.";
    await render();
    expect(container.textContent).not.toContain("Working");
    expect(container.textContent).toContain("The agent stopped unexpectedly.");
  });

  it("keeps a running turn's reasoning and tool calls in one live group", async () => {
    mocks.snapshot!.status = "running";
    mocks.snapshot!.messages = [
      { role: "user", id: "current-user", content: "Check the files" },
      { role: "assistant", id: "think-1", content: [{ type: "thinking", thinking: "Look first." }] },
      { role: "assistant", id: "tool-1", content: [{ type: "toolCall", id: "call", name: "bash", arguments: { command: "ls" } }] },
      { role: "toolResult", toolCallId: "call", content: [{ type: "text", text: "README.md" }] },
      { role: "assistant", id: "think-2", content: [{ type: "thinking", thinking: "Now read it." }] },
    ];
    await render();
    // The group's own spinner is the turn's one live row; no "Thinking" row joins it.
    const spinners = () =>
      container.querySelectorAll(
        '[role="progressbar"][aria-label="Working"], [role="progressbar"][aria-label="Thinking"]',
      );
    const thought = () => container.querySelector('[data-testid="agent-live-thought"]');
    // The group shows the step it is on under its newest thought, not a count.
    expect(container.querySelector('button[aria-label="Thinking"]')).not.toBeNull();
    expect(thought()?.textContent).toBe("Now read it.");
    expect(container.textContent).not.toContain("Ran 1 command");
    expect(container.textContent).not.toContain("Thoughts");
    expect(spinners()).toHaveLength(1);
    mocks.snapshot!.messages = [
      ...mocks.snapshot!.messages,
      { role: "assistant", id: "tool-2", content: [{ type: "toolCall", id: "call-2", name: "bash", arguments: { command: "cat README.md" } }] },
    ];
    await render();
    expect(container.querySelector('button[aria-label="Running: cat README.md"]')).not.toBeNull();
    expect(thought()?.textContent).toBe("Now read it.");
    expect(spinners()).toHaveLength(1);
    // Between steps the finished one stays as the live row.
    mocks.snapshot!.messages = [
      ...mocks.snapshot!.messages,
      { role: "toolResult", toolCallId: "call-2", content: [{ type: "text", text: "# Demo" }] },
    ];
    await render();
    expect(container.querySelector('button[aria-label="Terminal: cat README.md"]')).not.toBeNull();
    expect(spinners()).toHaveLength(1);
    // Reasoning is a one-line step inside the group until it is opened.
    await click("Terminal: cat README.md");
    expect(thought()).toBeNull();
    expect(container.querySelectorAll('button[aria-label="Thought"]')).toHaveLength(2);
    expect(container.textContent).toContain("Look first.");
    await click("Thought");
    expect(container.textContent?.match(/Look first\./g)).toHaveLength(1);
    // A failed last step is not progress: the count returns, with the turn's own row.
    mocks.snapshot!.messages = [
      ...mocks.snapshot!.messages,
      { role: "assistant", id: "tool-3", content: [{ type: "toolCall", id: "call-3", name: "bash", arguments: { command: "false" } }] },
      { role: "toolResult", toolCallId: "call-3", isError: true, content: [{ type: "text", text: "exit 1" }] },
    ];
    await render();
    expect(container.textContent).toContain("Ran 3 commands, 1 failed");
    expect(container.querySelectorAll('[role="progressbar"][aria-label="Thinking"]')).toHaveLength(1);
  });
});

describe("agents drawer and navigation", () => {
  const completed = { outcome: "completed" as const, startedAt: 10, endedAt: 40 };
  function setupSessions() {
    const done = Array.from({ length: 9 }, (_, i) =>
      chat(`Done ${i}`, { modifiedAt: 100 - i, lastTurn: completed, readTurnEndedAt: 40 }),
    );
    mocks.connections = [
      connection("codex", [
        {
          id: "workspace",
          path: "/project",
          name: "Project",
          sessions: [
            chat("Deploy", {
              runtimeStatus: "running",
              attention: {
                kind: "approval",
                id: "request",
                requestedAt: 500,
                title: "Allow Bash",
                detail: "npm test",
              },
            }),
            chat("Migrate", {
              lastTurn: { ...completed, outcome: "failed", endedAt: 300, error: "Boom" },
            }),
            chat("Refactor", { lastTurn: { ...completed, endedAt: 200 } }),
            chat("Index", { runtimeStatus: "running", turnStartedAt: 400 }),
            ...done,
          ],
        },
        {
          id: "other",
          path: "/other",
          name: "Other project",
          sessions: [
            chat("other-chat", {
              name: "Other chat",
              modifiedAt: 50,
              lastTurn: completed,
              readTurnEndedAt: 40,
            }),
          ],
        },
      ]),
      connection("claude", [
        {
          id: "claude-workspace",
          path: "/project",
          name: "Project",
          sessions: [
            chat("claude-chat", {
              name: "Claude chat",
              modifiedAt: 200,
              lastTurn: completed,
              readTurnEndedAt: 40,
            }),
          ],
        },
      ]),
    ];
  }

  it("lists sessions by what they need, shortens Done, and opens sessions and the home", async () => {
    setupSessions();
    const closeDrawer = vi.fn();
    await renderAgentsDrawer("/agent/other-chat", closeDrawer);
    const text = container.textContent!;
    const order = ["Needs input", "Failed", "Ready to review", "Working", "Done"].map((label) =>
      text.indexOf(label),
    );
    expect(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1]))).toBe(true);
    // The open session stays listed although Done is shortened to seven.
    expect(rowLabels()).toEqual([
      "Needs approval: Deploy, Codex, Project · My computer",
      "Failed: Migrate, Codex, Project · My computer",
      "Finished: Refactor, Codex, Project · My computer",
      "Working: Index, Codex, Project · My computer",
      "Claude chat, Claude Code, Project · My computer",
      ...[0, 1, 2, 3, 4, 5].map((i) => `Done ${i}, Codex, Project · My computer`),
      "Other chat, Codex, Other project · My computer",
    ]);
    expect(text).toContain("Allow Bash · npm test");
    expect(
      container
        .querySelector('button[aria-label="Other chat, Codex, Other project · My computer"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.querySelector('[data-testid="agent-state-working"]')).not.toBeNull();
    await click("Show 3 more sessions");
    expect(rowLabels()).toHaveLength(15);
    expect(container.querySelector('button[aria-label="Show fewer sessions"]')).not.toBeNull();
    await click("Claude chat, Claude Code, Project · My computer");
    expect(closeDrawer).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      pathname: "/agent/[id]",
      params: { id: "claude-chat", workspace: "claude-workspace", name: "Project" },
    });
    await click("New agent");
    expect(mocks.navigate).toHaveBeenLastCalledWith("/agents");
    await click("Search agent sessions");
    expect(mocks.push).toHaveBeenLastCalledWith({
      pathname: "/agents/history",
      params: { focus: "1" },
    });
    expect(closeDrawer).toHaveBeenCalledTimes(3);
  });

  it("keeps the listed sessions when a refresh fails, and offers a retry only before any loaded", async () => {
    setupSessions();
    const failed = {
      ...agentConnections(),
      error: new Error("offline"),
    } as ReturnType<typeof useAgentConnections>;
    await render(<AgentsDrawer connections={failed} pathname="/chat" onNavigate={vi.fn()} />);
    expect(rowLabels().length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("Couldn't load agent sessions");
    await render(<div key="remount" />);
    const unloaded = {
      ...agentConnections(),
      data: undefined,
      error: new Error("offline"),
    } as ReturnType<typeof useAgentConnections>;
    await render(<AgentsDrawer connections={unloaded} pathname="/chat" onNavigate={vi.fn()} />);
    expect(rowLabels()).toEqual([]);
    expect(container.textContent).toContain("Couldn't load agent sessions. Tap to retry.");
  });

  it("writes the most recent setup into the home's route once, and keeps a named one", async () => {
    mocks.params = {};
    await renderNewAgent();
    expect(mocks.setParams).toHaveBeenCalledTimes(1);
    expect(mocks.setParams).toHaveBeenCalledWith({ workspace: "workspace", provider: "codex" });
    await render(<div key="remount" />);
    mocks.params = { workspace: "workspace", provider: "codex" };
    await renderNewAgent();
    expect(mocks.setParams).toHaveBeenCalledTimes(1);
  });

  it("folds a group and remembers it, then groups by workspace on request", async () => {
    setupSessions();
    await renderAgentsDrawer();
    await click("Collapse Done");
    expect(container.textContent).not.toContain("Done 0");
    expect(JSON.parse(mocks.storage.get("overtchat.drawer.agentGroupsCollapsed")!)).toEqual(["done"]);
    await render(<div key="remount" />);
    await renderAgentsDrawer();
    expect(container.textContent).not.toContain("Done 0");
    expect(
      container.querySelector('button[aria-label="Expand Done"]')?.getAttribute("aria-expanded"),
    ).toBe("false");
    await click("Agent list options");
    await click("Group by workspace");
    expect(mocks.storage.get("overtchat.drawer.agentGrouping")).toBe("workspace");
    expect(container.textContent).toContain("Workspaces");
    expect(container.textContent).toContain("My computer · 14 sessions");
    expect(container.textContent).toContain("My computer · 1 session");
    expect(container.textContent).toContain("Done 0");
    await click("New session in Project");
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      pathname: "/agents",
      params: { workspace: "claude-workspace", provider: "claude" },
    });
    await click("Collapse Project");
    expect(container.textContent).not.toContain("Done 0");
    // Folded, the folder shows the most urgent state of its sessions.
    expect(container.querySelector('[data-testid="agent-state-approval"]')).not.toBeNull();
  });

  it("marks finished sessions read from a row and all at once", async () => {
    setupSessions();
    await renderAgentsDrawer();
    await longPress("Finished: Refactor, Codex, Project · My computer");
    await click("Mark as read");
    expect(mocks.setRead).toHaveBeenLastCalledWith({ sessionId: "Refactor", read: true });
    await longPress("Done 0, Codex, Project · My computer");
    await click("Mark as unread");
    expect(mocks.setRead).toHaveBeenLastCalledWith({ sessionId: "Done 0", read: false });
    await longPress("Working: Index, Codex, Project · My computer");
    expect(container.querySelector('[role="menu"] button[aria-label="Mark as read"]')).toBeNull();
    await click("Open workspace");
    expect(mocks.push).toHaveBeenLastCalledWith({
      pathname: "/agents/workspace",
      params: { workspace: "workspace", name: "Project" },
    });
    mocks.setRead.mockClear();
    await click("Agent list options");
    await click("Mark all as read");
    expect(mocks.setRead.mock.calls).toEqual([[{ sessionId: "Refactor", read: true }]]);
    await click("Agent list options");
    await click("Refresh sessions");
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });

  it("explains how to add a workspace when there is none", async () => {
    await renderAgentsDrawer();
    expect(container.textContent).toContain("No sessions yet.");
    mocks.params = {};
    await render(<NewAgentScreen />);
    expect(container.textContent).toContain("Your agents, on your phone");
    await click("Agent connections");
    expect(mocks.push).toHaveBeenLastCalledWith("/settings/connections");
  });

  it("starts the home in the most recent setup and switches folder and agent through the pills", async () => {
    setupSessions();
    mocks.params = {};
    await render(<NewAgentScreen />);
    expect(container.textContent).toContain("New Codex session");
    expect(container.textContent).toContain("Project · My computer");
    expect(container.querySelector('button[aria-label^="Machine:"]')).toBeNull();
    await click("Workspace: Project");
    await click("Other project");
    expect(mocks.setParams).toHaveBeenLastCalledWith({
      workspace: "other",
      provider: "codex",
      chooseWorkspace: "0",
    });
    await click("Agent: Codex");
    expect(
      container.querySelector('[role="dialog"] button[aria-label="Claude Code"]'),
    ).not.toBeNull();
    await click("Claude Code");
    expect(mocks.setParams).toHaveBeenLastCalledWith({
      workspace: "claude-workspace",
      provider: "claude",
      chooseWorkspace: "0",
    });
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("opens the named folder on the home and keeps a fork on its agent", async () => {
    setupSessions();
    mocks.params = { workspace: "other", provider: "codex", fork: "fork-1" };
    mocks.draft.forkContext = { text: "Previous history", launchConfig: {} };
    await render(<NewAgentScreen />);
    expect(container.textContent).toContain("Other project · My computer");
    expect(container.textContent).toContain("Chat history attached · Other project");
    expect(container.querySelector('button[aria-label^="Agent:"]')).toBeNull();
    await click("Change workspace");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Project");
  });

  it("starts a folder's session with its most recent agent and opens its sessions", async () => {
    setupSessions();
    mocks.params = { workspace: "workspace", name: "Project" };
    await render(<AgentWorkspaceScreen />);
    expect(container.textContent).toContain("14 sessions · Most recent first");
    await click("New session");
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      pathname: "/agents",
      params: { workspace: "claude-workspace", provider: "claude" },
    });
    await click("Claude chat, Claude Code, Project · My computer");
    expect(mocks.push.mock.lastCall?.[0].params).toEqual({
      id: "claude-chat",
      workspace: "claude-workspace",
      name: "Project",
    });
    await input("Refactor", "Search sessions in this workspace");
    expect(rowLabels()).toEqual(["Finished: Refactor, Codex, Project · My computer"]);
  });

  it("searches history by every word and narrows it by folder and agent", async () => {
    setupSessions();
    mocks.params = {};
    await render(<AgentHistoryScreen />);
    expect(rowLabels()).toHaveLength(15);
    expect(container.textContent).toContain("Older");
    expect(container.textContent).toContain("Allow Bash · npm test");
    expect(container.textContent).toContain("Boom");
    await input("refactor project", "Search sessions");
    expect(rowLabels()).toEqual(["Finished: Refactor, Codex, Project · My computer"]);
    await click("Clear search");
    await click("Filter by folder");
    await click("Other project");
    expect(rowLabels()).toEqual(["Other chat, Codex, Other project · My computer"]);
    // An agent with no sessions in the folder is not offered.
    await click("Filter by agent");
    expect(
      container.querySelector('[role="dialog"] button[aria-label="Claude Code"]'),
    ).toBeNull();
    await click("Codex");
    await click("Filter by folder");
    await click("All folders");
    expect(rowLabels()).toHaveLength(14);
    await click("Filter by agent");
    await click("Claude Code");
    expect(rowLabels()).toEqual(["Claude chat, Claude Code, Project · My computer"]);
    await click("Claude chat, Claude Code, Project · My computer");
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      pathname: "/agent/[id]",
      params: { id: "claude-chat", workspace: "claude-workspace", name: "Project" },
    });
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
  it("keeps a compaction divider after work finishes and shows imported markers", async () => {
    const marker = { id: "compact", role: "compactionSummary", status: "running", trigger: "manual" };
    mocks.snapshot!.messages = [marker];
    mocks.snapshot!.state.isCompacting = true;
    await render();
    expect(container.textContent).toContain("Compacting context…");
    mocks.snapshot!.messages = [{ ...marker, status: "completed", tokensBefore: 42000 }];
    mocks.snapshot!.state.isCompacting = false;
    await render();
    expect(container.textContent).not.toContain("Compacting context…");
    expect(container.textContent).toContain("Context manually compacted");
    expect(container.textContent).toContain("From 42,000 tokens");
    mocks.snapshot!.messages = [{ role: "compactionSummary", summary: "Native context", tokensBefore: 120000 }];
    await render();
    expect(container.textContent).toContain("Context compacted");
    expect(container.textContent).toContain("From 120,000 tokens");
    expect(container.textContent).not.toContain("Native context");
  });

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
  it("shows a turning mark on working rows and on their folded workspace", async () => {
    mocks.connections = [
      connection("codex", [
        {
          id: "workspace",
          name: "Project",
          path: "/project",
          sessions: [chat("Working chat", { runtimeStatus: "running", turnStartedAt: 1 })],
        },
      ]),
    ];
    mocks.storage.set("overtchat.drawer.agentGrouping", "workspace");
    await renderAgentsDrawer();
    const working = () => container.querySelector('[data-testid="agent-state-working"]');
    expect(working()).not.toBeNull();
    expect(container.textContent).toContain("Working chat");
    await click("Collapse Project");
    expect(container.textContent).not.toContain("Working chat");
    expect(working()).not.toBeNull();
    mocks.connections[0].workspaces[0].sessions[0].runtimeStatus = "idle";
    mocks.connections = [...mocks.connections];
    await render(<div key="remount" />);
    await renderAgentsDrawer();
    expect(working()).toBeNull();
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
      approvalKind: "tool",
      approveValue: "Allow once",
      alwaysValue: "Allow for session",
      alwaysLabel: "Allow for session",
      denyValue: "Deny",
      message: "Requires network",
      toolDetail: { type: "shell", command: "npm install" },
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
          'button[aria-label="Submit"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () => {
      field.value = "-1.25";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Submit");
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
      'button[aria-label="Submit"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await click("No");
    expect(submit.disabled).toBe(false);
    await click("Submit");
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
    mocks.connections = [
      connection("codex", [
        { id: "workspace", path: "/project", name: "Project", sessions: [] },
      ]),
    ];
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

it("starts an empty folder's session with the agent that has its record", async () => {
  mocks.connections = [
    connection("codex", [
      { id: "workspace", name: "Solo", path: "/solo", sessions: [] },
    ]),
  ];
  mocks.params = { workspace: "workspace", name: "Solo" };
  await render(<AgentWorkspaceScreen />);
  expect(container.textContent).toContain("Start your first session");
  await click("New session");
  expect(mocks.navigate).toHaveBeenLastCalledWith({
    pathname: "/agents",
    params: { workspace: "workspace", provider: "codex" },
  });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it("offers every agent the machine has, starting from the folder's record", async () => {
  mocks.connections = [
    connection("codex", [
      { id: "workspace", name: "Solo", path: "/solo", sessions: [] },
    ]),
  ];
  // Detection finds Claude Code on the machine though no chat used it here.
  mocks.providerSnapshot = {
    target: { connectorId: "connector", transport: "local" },
    refreshedAt: 1,
    providers: (["claude", "codex", "hermes", "omp", "opencode", "pi"] as const).map(
      (provider) =>
        provider === "claude" || provider === "codex"
          ? { provider, status: "ready", executable: provider, version: "1", shellMode: "login" }
          : { provider, status: "unavailable" },
    ),
  };
  mocks.params = { workspace: "workspace", provider: "codex" };
  await render(<NewAgentScreen />);
  expect(container.textContent).toContain("New Codex session");
  await click("Agent: Codex");
  const picker = container.querySelector('[role="dialog"]');
  expect(
    [...(picker?.querySelectorAll("button[aria-label]") ?? [])]
      .map((button) => button.getAttribute("aria-label"))
      .filter((label) => label !== "Close Agent"),
  ).toEqual(["Codex", "Claude Code"]);
  await click("Claude Code");
  // The folder's record stands in until Claude Code has its own.
  expect(mocks.setParams).toHaveBeenLastCalledWith({
    workspace: "workspace",
    provider: "claude",
    chooseWorkspace: "0",
  });
});

it("renders file approval previews as diffs while preserving provider decision values", async () => {
  mocks.snapshot!.pendingInteraction = {
    type: "interaction_request",
    id: "codex:edit",
    method: "select",
    title: "Approve file changes?",
      approvalKind: "tool",
      approveValue: "Allow once",
      alwaysValue: "Allow for session",
      alwaysLabel: "Allow for session",
      denyValue: "Deny",
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
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it("keeps questions inline, paginates choices, and submits every answer together", async () => {
  mocks.snapshot!.pendingInteraction = {
    type: "interaction_request",
    id: "questions",
    method: "form",
    fields: [
      {
        id: "framework",
        label: "Framework",
        description: "Which framework?",
        type: "select",
        required: true,
        allowOther: true,
        options: [
          {
            value: "react",
            label: "React",
            description: "Use the existing components",
          },
          { value: "vue", label: "Vue" },
        ],
      },
      {
        id: "features",
        label: "Features",
        description: "Which features?",
        type: "multiselect",
        required: true,
        options: [
          { value: "search", label: "Search" },
          { value: "history", label: "History" },
        ],
      },
    ],
  };
  await render();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain("Use the existing components");
  expect(container.textContent).not.toContain("Which features?");
  await click("React");
  expect(mocks.send).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Which features?");
  await click("Search");
  await click("History");
  await click("Question 1 of 2: Framework");
  expect(container.textContent).toContain("Which framework?");
  await click("Next");
  await click("Submit");
  expect(mocks.send).toHaveBeenCalledWith({
    type: "interaction_response",
    id: "questions",
    values: { framework: "react", features: ["search", "history"] },
  });
});

it("keeps a custom answer after a failed submission and resets for the next request", async () => {
  mocks.snapshot!.pendingInteraction = {
    type: "interaction_request",
    id: "custom",
    method: "form",
    fields: [
      {
        id: "choice",
        label: "Choice",
        type: "select",
        required: true,
        allowOther: true,
        options: [{ value: "A", label: "Option A" }],
      },
    ],
  };
  await render();
  await click("Option A");
  const field = container.querySelector(
    'input[aria-label="Choice"]',
  ) as HTMLInputElement;
  await act(async () => {
    field.value = "Something else";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  mocks.send.mockRejectedValueOnce(new Error("Connection lost"));
  await click("Submit");
  expect(mocks.send.mock.lastCall?.[0]).toEqual({
    type: "interaction_response",
    id: "custom",
    values: { choice: "Something else" },
  });
  expect(field.value).toBe("Something else");
  expect(container.textContent).toContain("Connection lost");
  await click("Submit");
  expect(mocks.send).toHaveBeenCalledTimes(2);
  mocks.snapshot!.pendingInteraction = {
    ...mocks.snapshot!.pendingInteraction,
    id: "next",
  };
  await render();
  expect(
    (container.querySelector('input[aria-label="Choice"]') as HTMLInputElement)
      .value,
  ).toBe("");
  expect(
    (
      container.querySelector(
        'button[aria-label="Submit"]',
      ) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it.each(["input", "editor", "select"])(
  "renders %s questions inline for extension providers",
  async (method) => {
    mocks.snapshot!.pendingInteraction = {
      type: "interaction_request",
      id: "extension",
      method,
      title: "Your answer",
      ...(method === "select"
        ? { options: ["Option"] }
        : { prefill: "Draft answer" }),
    };
    await render();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    if (method === "select") await click("Option");
    await click("Submit");
    expect(mocks.send.mock.lastCall?.[0]).toEqual({
      type: "interaction_response",
      id: "extension",
      value: method === "select" ? "Option" : "Draft answer",
    });
  },
);

it("dismisses required questions but skips optional inputs without cancelling them", async () => {
  mocks.snapshot!.pendingInteraction = {
    type: "interaction_request",
    id: "required",
    method: "input",
    title: "Answer",
  };
  await render();
  await click("Dismiss");
  expect(mocks.send.mock.lastCall?.[0]).toEqual({
    type: "interaction_response",
    id: "required",
    cancelled: true,
  });
  mocks.snapshot!.pendingInteraction = {
    type: "interaction_request",
    id: "optional",
    method: "input",
    title: "Comment",
    optional: true,
    dismissLabel: "Skip",
  };
  await render();
  await click("Skip");
  expect(mocks.send.mock.lastCall?.[0]).toEqual({
    type: "interaction_response",
    id: "optional",
    value: "",
  });
});

it.each(["select", "multiselect"])(
  "keeps a typed %s alternative when it passes through an option label",
  async (type) => {
    mocks.snapshot!.pendingInteraction = {
      type: "interaction_request",
      id: "custom-prefix",
      method: "form",
      fields: [
        {
          id: "framework",
          label: "Framework",
          type,
          required: true,
          allowOther: true,
          options: [{ value: "React", label: "React" }],
        },
      ],
    };
    await render();
    const field = container.querySelector(
      'input[aria-label="Framework"]',
    ) as HTMLInputElement;
    for (const char of "React Native") {
      await act(async () => {
        field.value += char;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    expect(field.value).toBe("React Native");
    await click("Submit");
    expect(mocks.send.mock.lastCall?.[0].values).toEqual({
      framework: type === "multiselect" ? ["React Native"] : "React Native",
    });
    await click("React");
    expect(field.value).toBe("");
    await click("Submit");
    expect(mocks.send.mock.lastCall?.[0].values).toEqual({
      framework: type === "multiselect" ? ["React"] : "React",
    });
  },
);

describe("agent dictation", () => {
  it("keeps Stop dictation available when the agent disconnects", async () => {
    mocks.dictation.status = "recording";
    await render();
    mocks.status = "reconnecting";
    await render();
    const stop = container.querySelector(
      'button[aria-label="Stop dictation"]',
    ) as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
    await click("Stop dictation");
    expect(mocks.dictation.stop).toHaveBeenCalledTimes(1);
  });

  it.each(["recording", "transcribing"] as const)(
    "waits for %s to finish before sending the complete prompt",
    async (status) => {
      mocks.draft.message = "Please";
      mocks.dictation.status = status;
      await render();
      const send = () => container.querySelector(
        'button[aria-label="Send message"]',
      ) as HTMLButtonElement;
      expect(send().disabled).toBe(true);
      expect(mocks.send).not.toHaveBeenCalled();
      await act(async () => mocks.dictation.onResult("fix the spec"));
      mocks.dictation.status = "idle";
      await render();
      expect(send().disabled).toBe(false);
      await click("Send message");
      expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
        type: "prompt",
        message: "Please fix the spec",
      }));
    },
  );

  it("captures through the mic and appends the transcript to the draft", async () => {
    await render();
    await click("Start dictation");
    // Recording must not capture playback, so text-to-speech stops first.
    expect(mocks.stopSpeech).toHaveBeenCalledTimes(1);
    expect(mocks.dictation.start).toHaveBeenCalledTimes(1);
    const field = container.querySelector(
      'input[aria-label="Message agent"]',
    ) as HTMLInputElement;
    await act(async () => mocks.dictation.onResult("fix the failing spec"));
    expect(field.value).toBe("fix the failing spec");
    await act(async () => mocks.dictation.onResult("then rerun it"));
    expect(field.value).toBe("fix the failing spec then rerun it");
  });
  it("surfaces a dictation failure and clears it", async () => {
    mocks.dictation.error = { kind: "stt_unavailable", role: "admin" };
    await render();
    expect(container.textContent).toContain("transcription service is temporarily unavailable");
    expect(container.textContent).not.toContain("overtchat setup");
    expect(toastError).not.toHaveBeenCalled();
    expect(mocks.dictation.clearError).not.toHaveBeenCalled();
    await click("Dismiss error");
    expect(mocks.dictation.clearError).toHaveBeenCalledTimes(1);
  });
});
