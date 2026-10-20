import React, { act, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatMessageQueue } from "@overtchat/shared";

vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ colors: {}, radii: {}, fonts: {} }),
}));
vi.mock("react-native", () => {
  const View = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    View,
    Text: View,
    ScrollView: View,
    TextInput: ({
      value,
      onChangeText,
      accessibilityLabel,
    }: {
      value: string;
      onChangeText: (value: string) => void;
      accessibilityLabel: string;
    }) => (
      <textarea
        aria-label={accessibilityLabel}
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
    }: {
      children: ReactNode;
      onPress: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) => (
      <button
        aria-label={accessibilityLabel}
        onClick={onPress}
        disabled={disabled}
      >
        {children}
      </button>
    ),
  };
});
import { MessageQueue } from "./MessageQueue";
let root: Root;
let container: HTMLElement;
beforeEach(() => {
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
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
function Surface({ queue }: { queue: ChatMessageQueue }) {
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  return <MessageQueue queue={queue} {...snapshot} />;
}
function button(label: string) {
  return container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )!;
}
it("edits and deletes pending messages and invokes cancellation before sending on native controls", async () => {
  const queue = new ChatMessageQueue();
  const calls: string[] = [];
  queue.attach({
    prepare: async () => {},
    cancel: async () => {
      calls.push("cancel");
    },
    send: async (message) => {
      calls.push(message.text);
    },
  });
  queue.enqueue({ id: "one", text: "Original", files: [], body: {} });
  queue.enqueue({ id: "two", text: "Delete", files: [], body: {} });
  await act(async () => root.render(<Surface queue={queue} />));
  await act(async () => button("Edit queued message").click());
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    textarea.value = "Edited";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((item) => item.textContent === "Save queued message")!
      .click(),
  );
  expect(queue.getSnapshot().messages[0].text).toBe("Edited");
  await act(async () =>
    container
      .querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Delete queued message"]',
      )[1]
      .click(),
  );
  expect(queue.getSnapshot().messages).toHaveLength(1);
  await act(async () => button("Send now").click());
  expect(calls).toEqual(["cancel", "Edited"]);
});
