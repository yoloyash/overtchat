import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatMessageQueue } from "@overtchat/shared";
import type { MobileVoiceController } from "@/lib/voice/useMobileVoice";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  dictationStatus: "idle" as "idle" | "recording" | "transcribing",
}));

vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
vi.mock("./AttachmentChip", () => ({ AttachmentChip: () => null }));
vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light" },
  impactAsync: vi.fn(async () => {}),
  selectionAsync: vi.fn(async () => {}),
}));
vi.mock("expo-paste-input", () => ({
  TextInputWrapper: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("react-native-svg", () => {
  const Svg = ({ children }: { children?: ReactNode }) => <svg>{children}</svg>;
  const Path = ({ d }: { d?: string }) => <path d={d} />;
  const Circle = () => <circle />;
  return { default: Svg, Svg, Path, Circle };
});
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    colors: {
      background: "#000",
      foreground: "#fff",
      card: "#111",
      primary: "#fff",
      primaryForeground: "#000",
      secondary: "#222",
      secondaryForeground: "#fff",
      muted: "#181818",
      mutedForeground: "#888",
      accent: "#333",
      destructive: "#ef4444",
      border: "#333",
    },
    radii: { md: 8, lg: 12, xl: 16, xxl: 24, pill: 999 },
    fonts: {
      sansRegular: "System",
      sansMedium: "System",
      sansSemiBold: "System",
    },
    scheme: "dark",
  }),
}));
vi.mock("@/lib/toast", () => ({ toastError: mocks.toastError }));
vi.mock("@/lib/useDictation", () => ({
  useDictation: () => ({
    status: mocks.dictationStatus,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    clearError: vi.fn(),
  }),
}));
vi.mock("react-native", () => {
  const View = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  class AnimatedValue {
    setValue() {}
    stopAnimation() {}
    interpolate() {
      return "0deg";
    }
  }
  const noopLoop = { start: () => {}, stop: () => {} };
  return {
    View,
    Text: ({ children, numberOfLines }: { children?: ReactNode; numberOfLines?: number }) => (
      <span data-number-of-lines={numberOfLines}>{children}</span>
    ),
    ActivityIndicator: () => <span data-testid="spinner" />,
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => true,
      addEventListener: () => ({ remove: () => {} }),
    },
    Animated: {
      Value: AnimatedValue,
      View,
      timing: () => noopLoop,
      sequence: () => noopLoop,
      loop: () => noopLoop,
    },
    Easing: { linear: () => 0, sin: () => 0, inOut: () => () => 0 },
    TextInput: ({
      value,
      onChangeText,
      editable,
      placeholder,
    }: {
      value: string;
      onChangeText: (value: string) => void;
      editable?: boolean;
      placeholder?: string;
    }) => (
      <textarea
        placeholder={placeholder}
        disabled={editable === false}
        value={value}
        onInput={(event) => onChangeText(event.currentTarget.value)}
      />
    ),
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityState,
    }: {
      children: ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityState?: { disabled?: boolean; busy?: boolean };
    }) => (
      <button
        aria-label={accessibilityLabel}
        aria-disabled={accessibilityState?.disabled}
        aria-busy={accessibilityState?.busy}
        onClick={onPress}
        disabled={disabled}
      >
        {children}
      </button>
    ),
  };
});

import { Composer } from "./Composer";
import { VoiceControls } from "./VoiceControls";

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dictationStatus = "idle";
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
  })) {
    vi.stubGlobal(key, value);
  }
  container = window.document.getElementById("root") as unknown as HTMLElement;
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function baseComposerProps() {
  const queue = new ChatMessageQueue();
  return {
    chatQueue: { queue, ...queue.getSnapshot() },
    voiceInstalled: true,
    voiceEligible: true,
    voiceAvailable: true,
    voiceActive: false,
    voiceUnavailableReason: "Realtime voice is unavailable",
    configured: true,
    streaming: false,
    searchAvailable: true,
    searchRequested: false,
    modelLabel: "DeepSeek V4",
    attachments: [],
    attachmentMeta: {},
    uploading: false,
    uploadError: null,
    isAdmin: true,
    onClearSearch: vi.fn(),
    onOpenModelPicker: vi.fn(),
    onOpenAddSheet: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onDismissUploadError: vi.fn(),
    onPasteImages: vi.fn(),
    onSubmit: vi.fn(() => true),
    onStop: vi.fn(),
    onStartVoice: vi.fn(),
    onEndVoice: vi.fn(),
  };
}

function voiceFixture(
  overrides: Partial<MobileVoiceController> = {},
): MobileVoiceController {
  return {
    status: "listening",
    muted: false,
    error: null,
    warning: null,
    inputLevel: 0,
    outputLevel: 0,
    pendingText: null,
    cleanupPending: false,
    available: true,
    busy: true,
    start: vi.fn(async () => {}),
    end: vi.fn(async () => true),
    toggleMute: vi.fn(),
    interrupt: vi.fn(),
    sendMessage: vi.fn(async () => true),
    dismissError: vi.fn(),
    dismissWarning: vi.fn(),
    ...overrides,
  };
}

it("places the AudioLines voice action in the send slot when empty and swaps to Send when typing", async () => {
  const props = baseComposerProps();
  await act(async () => root.render(<Composer {...props} />));

  const voiceBtn = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Start voice conversation"]',
  );
  expect(voiceBtn).not.toBeNull();
  expect(
    container.querySelector('button[aria-label="Send message"]'),
  ).toBeNull();
  expect(voiceBtn?.querySelectorAll("path")).toHaveLength(6);

  await act(async () => voiceBtn!.click());
  expect(props.onStartVoice).toHaveBeenCalledOnce();

  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    textarea.value = "Hello there";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(
    container.querySelector('button[aria-label="Start voice conversation"]'),
  ).toBeNull();
  expect(
    container.querySelector('button[aria-label="Send message"]'),
  ).not.toBeNull();
});

it("explains why voice is unavailable when the dimmed voice button is tapped", async () => {
  const props = {
    ...baseComposerProps(),
    voiceAvailable: false,
    voiceUnavailableReason: "Speech-to-text is disabled",
  };
  await act(async () => root.render(<Composer {...props} />));

  const voiceBtn = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Start voice conversation"]',
  )!;
  expect(voiceBtn.getAttribute("aria-disabled")).toBe("true");
  await act(async () => voiceBtn.click());
  expect(props.onStartVoice).not.toHaveBeenCalled();
  expect(mocks.toastError).toHaveBeenCalledWith("Speech-to-text is disabled");
});

it("separates assistant interruption from session ending and reflects pending text and ending states", async () => {
  const voice = voiceFixture({
    status: "assistant-speaking",
    pendingText: "Switch to a shorter summary",
  });
  const composerProps = {
    ...baseComposerProps(),
    voiceActive: true,
  };

  await act(async () =>
    root.render(
      <div>
        <VoiceControls voice={voice} modelLabel="DeepSeek V4" />
        <Composer {...composerProps} />
      </div>,
    ),
  );

  expect(container.textContent).toContain("Speaking");
  expect(container.textContent).toContain("DeepSeek V4 · Realtime voice");
  expect(container.textContent).toContain("Switch to a shorter summary");
  expect(container.textContent).toContain("Sending…");

  const stopAssistant = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Stop assistant"]',
  )!;
  const endVoice = container.querySelector<HTMLButtonElement>(
    'button[aria-label="End voice session"]',
  )!;
  expect(stopAssistant).not.toBeNull();
  expect(endVoice).not.toBeNull();

  await act(async () => stopAssistant.click());
  expect(voice.interrupt).toHaveBeenCalledOnce();
  expect(composerProps.onEndVoice).not.toHaveBeenCalled();

  await act(async () => endVoice.click());
  expect(composerProps.onEndVoice).toHaveBeenCalledOnce();

  // While ending is in flight, both text input and End are disabled; if ending fails, End re-enables for retry.
  const endingFailedVoice = voiceFixture({
    status: "ending",
    error:
      "Could not finish ending voice. Check your connection and tap End again.",
  });
  await act(async () =>
    root.render(
      <div>
        <VoiceControls voice={endingFailedVoice} modelLabel="DeepSeek V4" />
        <Composer
          {...composerProps}
          textInputDisabled
          endVoiceDisabled={false}
        />
      </div>,
    ),
  );
  expect(container.textContent).toContain("End the session and try again");
  expect(
    container.querySelector("textarea")?.getAttribute("placeholder"),
  ).toBe("Resume voice to continue");
  expect(
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="End voice session"]',
    )?.disabled,
  ).toBe(false);
});

it("bounds pending text and disables End only while cleanup is actually pending", async () => {
  const pendingText = "A long pending message. ".repeat(200);
  const props = { ...baseComposerProps(), voiceActive: true, textInputDisabled: true };
  const render = (cleanupPending: boolean) => root.render(<div>
    <VoiceControls voice={voiceFixture({ status: "ending", cleanupPending, pendingText })} />
    <Composer {...props} endVoiceDisabled={cleanupPending} />
  </div>);
  await act(async () => render(true));
  expect(container.querySelector('[data-number-of-lines="2"]')?.textContent).toBe(pendingText);
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="End voice session"]')?.disabled).toBe(true);
  await act(async () => render(false));
  const end = container.querySelector<HTMLButtonElement>('button[aria-label="End voice session"]')!;
  expect(end.disabled).toBe(false);
  await act(async () => end.click());
  expect(props.onEndVoice).toHaveBeenCalledOnce();
});
