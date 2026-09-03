import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatGenerationRecovery } from "./useChatGenerationRecovery";

function Probe({
  stopLocalStream,
  resumeStream,
  clearError,
  setMessages,
  onSettled,
}: {
  stopLocalStream: () => void;
  resumeStream: () => Promise<void>;
  clearError: () => void;
  setMessages: (
    messages: UIMessage[] | ((current: UIMessage[]) => UIMessage[]),
  ) => void;
  onSettled: () => void;
}) {
  useChatGenerationRecovery({
    chatId: "chat",
    enabled: true,
    recoverOnMount: false,
    stopLocalStream,
    resumeStream,
    clearError,
    setMessages,
    onSettled,
  });
  return null;
}

describe("web chat generation recovery", () => {
  let root: Root;
  let container: HTMLElement;
  const originalGlobals = new Map<
    PropertyKey,
    PropertyDescriptor | undefined
  >();

  beforeEach(() => {
    vi.useFakeTimers();
    const { window } = parseHTML(
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    Object.defineProperty(window.document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    for (const [key, value] of Object.entries({
      window,
      document: window.document,
      navigator: window.navigator,
      HTMLElement: window.HTMLElement,
      Event: window.Event,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
    container = window.document.getElementById("root") as HTMLElement;
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originalGlobals.clear();
  });

  it("reattaches the same run on foreground and applies its terminal message", async () => {
    const responseMessage = {
      id: "assistant",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Completed" }],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          active: true,
          streamId: "stream",
          status: "running",
          startedAt: 1,
          completedAt: null,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          active: false,
          streamId: "stream",
          status: "complete",
          startedAt: 1,
          completedAt: 2,
          responseMessage,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const stopLocalStream = vi.fn();
    const resumeStream = vi.fn().mockResolvedValue(undefined);
    const clearError = vi.fn();
    let messages: UIMessage[] = [];
    const setMessages = vi.fn(
      (update: UIMessage[] | ((current: UIMessage[]) => UIMessage[])) => {
        messages = typeof update === "function" ? update(messages) : update;
      },
    );
    const onSettled = vi.fn();

    await act(async () => {
      root.render(
        <Probe
          stopLocalStream={stopLocalStream}
          resumeStream={resumeStream}
          clearError={clearError}
          setMessages={setMessages}
          onSettled={onSettled}
        />,
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(stopLocalStream).toHaveBeenCalledOnce();
    expect(resumeStream).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(messages).toEqual([responseMessage]);
    expect(clearError).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
