import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Dictation } from "@/lib/useDictation";
import { AgentComposer } from "@/components/agents/AgentComposer";

// React selects its input-event implementation when the renderer loads.
// Install the DOM first so keyboard events use the browser path.
await vi.hoisted(async () => {
  const { parseHTML } = await import("linkedom");
  const { window } = parseHTML("<html><body></body></html>");
  Object.defineProperty(window.document, "oninput", { value: null });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
});

const mocks = vi.hoisted(() => ({
  status: "idle" as Dictation["status"],
  onResult: (() => {}) as (text: string) => void,
  start: vi.fn(),
  stop: vi.fn(),
  onSubmit: vi.fn(async () => true),
  beforeStart: vi.fn(),
}));
vi.mock("@/lib/useDictation", () => ({
  useDictation: (onResult: (text: string) => void) => {
    mocks.onResult = onResult;
    return { status: mocks.status, error: null, start: mocks.start, stop: mocks.stop };
  },
}));
vi.mock("@/components/agents/AgentComposerControls", () => ({
  AgentComposerControls: () => null,
}));
vi.mock("@/components/chat/UsageIndicator", () => ({ UsageIndicator: () => null }));
vi.mock("@/components/ui/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/chat/useChatAttachments", () => ({
  useChatAttachments: () => ({
    attachments: [], readyParts: [], uploading: false,
    addFiles: vi.fn(), addReadyParts: vi.fn(), removeAttachment: vi.fn(), clearAttachments: vi.fn(),
  }),
}));

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.status = "idle";
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  for (const [key, value] of Object.entries({
    window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Element: window.Element,
    Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    cancelAnimationFrame: clearTimeout,
  })) vi.stubGlobal(key, value);
  container = window.document.getElementById("root") as unknown as HTMLElement;
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
async function render(overrides: Partial<ComponentProps<typeof AgentComposer>> = {}) {
  await act(async () => root.render(<AgentComposer
    providerLabel="Codex" commands={[]} queuedMessages={[]}
    supportsSteer={false} supportsImages={false} running={false}
    pending={false} stopping={false} disabled={false} isAdmin={false}
    onBeforeDictate={mocks.beforeStart} onSubmit={mocks.onSubmit}
    onStop={vi.fn()} onEditQueued={vi.fn()} onDeleteQueued={vi.fn()} onSteerQueued={vi.fn()}
    controls={{
      providerLabel: "Codex", models: [], currentModel: null, thinkingLevel: null,
      thinkingOptions: [], collaborationMode: "default", collaborationModes: [],
      fastModeEnabled: false, fastModeAvailable: false, modeId: "", modes: [], disabled: false,
      onSelectModel: vi.fn(), onSelectThinking: vi.fn(), onSelectCollaborationMode: vi.fn(),
      onToggleFastMode: vi.fn(), onSelectMode: vi.fn(),
    }}
    {...overrides}
  />));
}
function button(label: string) {
  return container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
}

it("stops playback before starting the microphone", async () => {
  await render();
  await act(async () => button("Dictate").click());
  expect(mocks.beforeStart).toHaveBeenCalledTimes(1);
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(mocks.beforeStart.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0]);
});

it("keeps the recording stop control available when agent input becomes disabled", async () => {
  mocks.status = "recording";
  await render();
  await render({ disabled: true });
  expect(button("Stop dictation").disabled).toBe(false);
  await act(async () => button("Stop dictation").click());
  expect(mocks.stop).toHaveBeenCalledTimes(1);
});

it.each(["recording", "transcribing"] as const)(
  "prevents clicks and Enter from sending during %s", async (status) => {
    await render();
    await act(async () => mocks.onResult("Please"));
    mocks.status = status;
    await render();
    expect(button("Send message").disabled).toBe(true);
    const enter = new Event("keydown", { bubbles: true });
    Object.defineProperty(enter, "key", { value: "Enter" });
    await act(async () => container.querySelector("textarea")!.dispatchEvent(enter));
    expect(mocks.onSubmit).not.toHaveBeenCalled();
    await act(async () => mocks.onResult("fix the spec"));
    mocks.status = "idle";
    await render();
    expect(button("Send message").disabled).toBe(false);
    await act(async () => button("Send message").click());
    expect(mocks.onSubmit).toHaveBeenCalledWith("Please fix the spec", []);
  },
);
