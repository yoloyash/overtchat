import React, { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import type { UIMessage } from "ai";
import type { UsageTotals } from "@overtchat/shared/usage";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  prefs: { contextMeter: true, sessionCost: true },
}));

vi.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => <i data-icon={name} />,
}));
vi.mock("react-native-svg", () => ({
  default: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    colors: {
      border: "#333",
      destructive: "#ef4444",
      mutedForeground: "#888",
      popover: "#111",
      popoverForeground: "#fff",
    },
    radii: { xl: 16 },
    fonts: {
      sansRegular: "System",
      sansSemiBold: "System",
      serifSemiBold: "System",
      mono: "Menlo",
    },
    scheme: "dark",
  }),
}));
vi.mock("@/lib/chatPreferences", () => ({
  useChatPreferences: () => mocks.prefs,
}));
vi.mock("@/lib/queries/settings", () => ({
  settingsRequest: mocks.request,
}));
vi.mock("@gorhom/bottom-sheet", async () => {
  const { useState, useImperativeHandle, forwardRef } = await import("react");
  const { View } = await import("react-native");
  return {
    BottomSheetBackdrop: View,
    BottomSheetView: View,
    BottomSheetModal: forwardRef(
      ({ children }: { children: ReactNode }, ref) => {
        const [open, setOpen] = useState(false);
        useImperativeHandle(ref, () => ({
          present: () => setOpen(true),
          dismiss: () => setOpen(false),
        }));
        return open ? <div role="dialog">{children}</div> : null;
      },
    ),
  };
});
vi.mock("react-native", () => {
  const View = ({
    children,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    accessibilityLabel?: string;
  }) => <div aria-label={accessibilityLabel}>{children}</div>;
  return {
    View,
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    Pressable: ({
      children,
      onPress,
      accessibilityLabel,
    }: {
      children?: ReactNode;
      onPress?: () => void;
      accessibilityLabel?: string;
    }) => (
      <button aria-label={accessibilityLabel} onClick={onPress}>
        {children}
      </button>
    ),
  };
});

import { useChatUsageSummary } from "@/lib/chat/useChatUsageSummary";
import { ChatUsageButton } from "./ChatUsageButton";
import { ChatUsageSheet, type ChatUsageSheetRef } from "./ChatUsageSheet";

type SummaryInput = Parameters<typeof useChatUsageSummary>[0];

function Harness(props: SummaryInput) {
  const usage = useChatUsageSummary(props);
  const ref = useRef<ChatUsageSheetRef>(null);
  return (
    <>
      {usage ? (
        <ChatUsageButton
          usage={usage}
          onPress={() => ref.current?.present()}
        />
      ) : (
        <span>no usage</span>
      )}
      <ChatUsageSheet ref={ref} usage={usage} />
    </>
  );
}

let root: Root;
let container: HTMLElement;
let qc: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prefs = { contextMeter: true, sessionCost: true };
  mocks.request.mockResolvedValue({ usage: totals({ pricedGenerations: 0 }) });
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
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function totals(overrides: Partial<UsageTotals> = {}): UsageTotals {
  return {
    generations: 1,
    pricedGenerations: 1,
    inputTokens: 1200,
    uncachedInputTokens: 1200,
    outputTokens: 300,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 1500,
    inputCostNanoUsd: 0,
    outputCostNanoUsd: 0,
    cacheReadCostNanoUsd: 0,
    cacheWriteCostNanoUsd: 0,
    totalCostNanoUsd: 12_000_000,
    ...overrides,
  };
}

function assistant(stats: Record<string, unknown>): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text: "Hello" }],
    metadata: { stats },
  } as UIMessage;
}

const user: UIMessage = {
  id: "user-1",
  role: "user",
  parts: [{ type: "text", text: "Hi" }],
};

async function render(props: Partial<SummaryInput> = {}) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <Harness
          chatId="chat-1"
          persisted
          messages={[]}
          {...props}
        />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function button() {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Usage:"]',
  );
}

function dialog() {
  return container.querySelector('[role="dialog"]');
}

it("shows a context ring in the composer and opens a sheet with context and cost sections", async () => {
  mocks.request.mockResolvedValue({
    usage: totals({
      generations: 3,
      pricedGenerations: 2,
      cacheReadTokens: 400,
    }),
    images: totals({ totalCostNanoUsd: 5_000_000 }),
  });
  await render({
    messages: [user, assistant({ contextTokens: 3687, contextWindow: 100000 })],
  });
  expect(mocks.request).toHaveBeenCalledWith("/chat/chat-1/usage");
  const trigger = button();
  expect(trigger?.getAttribute("aria-label")).toBe(
    "Usage: 4% context used; known session cost $0.017. Show details",
  );
  expect(trigger?.querySelector("svg")).not.toBeNull();
  expect(container.textContent).not.toContain("Context 4%");
  expect(dialog()).toBeNull();

  await act(async () => trigger!.click());
  const text = dialog()?.textContent ?? "";
  expect(text).toContain("Usage");
  expect(text).toContain("4% used");
  expect(text).toContain("Measured at the last response.");
  expect(text).toContain("Used3,687 tokens");
  expect(text).toContain("Remaining96,313 tokens");
  expect(text).toContain("Context window100,000 tokens");
  expect(text).toContain("Session");
  expect(text).toContain("1,500 tokens");
  expect(text).toContain("$0.012+");
  expect(text).toContain("Known cost");
  expect(text).toContain("Cache read400");
  expect(text).not.toContain("Cache write");
  expect(text).toContain("2 of 3 generations have pricing");
  expect(text).toContain("Images");
  expect(text).toContain("1 image");
  expect(text).toContain("$0.005");
});

it("prefers the selected model's context window over the one recorded on the message", async () => {
  mocks.prefs = { contextMeter: true, sessionCost: false };
  await render({
    messages: [user, assistant({ contextTokens: 50000, contextWindow: 100000 })],
    contextWindow: 200000,
  });
  expect(button()?.getAttribute("aria-label")).toBe(
    "Usage: 25% context used. Show details",
  );
  expect(mocks.request).not.toHaveBeenCalled();
});

it("keeps the limit unknown when neither the model nor the message reports a context window", async () => {
  mocks.prefs = { contextMeter: true, sessionCost: false };
  await render({ messages: [user, assistant({ contextTokens: 3687 })] });
  const trigger = button();
  expect(trigger?.getAttribute("aria-label")).toBe(
    "Usage: context limit unknown. Show details",
  );
  await act(async () => trigger!.click());
  const text = dialog()?.textContent ?? "";
  expect(text).toContain("Limit unknown");
  expect(text).toContain("hasn't reported a context window");
  expect(text).toContain("Used3,687 tokens");
  expect(text).not.toContain("Remaining");
  expect(text).not.toContain("Session");
});

it("shows a cost glyph when the context meter is off but the chat has a recorded cost", async () => {
  mocks.prefs = { contextMeter: false, sessionCost: true };
  mocks.request.mockResolvedValue({ usage: totals() });
  await render({
    messages: [user, assistant({ contextTokens: 3687, contextWindow: 100000 })],
  });
  const trigger = button();
  expect(trigger?.getAttribute("aria-label")).toBe(
    "Usage: session cost $0.012. Show details",
  );
  expect(trigger?.querySelector("svg")).toBeNull();
  expect(trigger?.querySelector('[data-icon="cash-outline"]')).not.toBeNull();
  await act(async () => trigger!.click());
  const text = dialog()?.textContent ?? "";
  expect(text).toContain("Cost");
  expect(text).not.toContain("Known cost");
  expect(text).not.toContain("% used");
});

it("renders nothing when both preferences are off, and never requests cost for an unsaved chat", async () => {
  mocks.prefs = { contextMeter: false, sessionCost: false };
  await render({
    messages: [user, assistant({ contextTokens: 3687, contextWindow: 100000 })],
  });
  expect(button()).toBeNull();
  expect(container.textContent).toContain("no usage");
  expect(mocks.request).not.toHaveBeenCalled();

  mocks.prefs = { contextMeter: true, sessionCost: true };
  await render({ persisted: false, messages: [user] });
  expect(button()).toBeNull();
  expect(mocks.request).not.toHaveBeenCalled();
});
