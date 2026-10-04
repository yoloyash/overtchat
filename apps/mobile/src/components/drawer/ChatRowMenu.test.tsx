import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@expo/vector-icons", () => ({ Feather: () => null, Ionicons: () => null }));
vi.mock("expo-haptics", () => ({ selectionAsync: async () => {} }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ colors: {}, radii: {}, fonts: {} }),
}));
vi.mock("react-native", () => {
  const View = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    View,
    Text: View,
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    Pressable: ({ children, onPress, disabled, accessibilityLabel }: {
      children: ReactNode;
      onPress: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) => <button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>{children}</button>,
  };
});
vi.mock("react-native-popover-view", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverPlacement: { AUTO: "auto" },
}));

import { ChatRowMenu } from "./ChatRowMenu";

let root: Root;
let container: HTMLElement;
const onSelect = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) vi.stubGlobal(key, value);
  container = window.document.getElementById("root") as unknown as HTMLElement;
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function render(pinningSupported: boolean, pinned = false, pinPending = false) {
  await act(async () => root.render(
    <ChatRowMenu from={null} visible pinned={pinned} pinningSupported={pinningSupported}
      pinPending={pinPending} onSelect={onSelect} onClose={onClose} />,
  ));
}

function button(name: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
}

it("keeps existing actions and omits pinning for an older server", async () => {
  await render(false);
  expect(button("Pin")).toBeNull();
  expect(button("Unpin")).toBeNull();
  expect(Array.from(container.querySelectorAll("button")).map((item) => item.getAttribute("aria-label")))
    .toEqual(["Rename", "Move to project", "Delete"]);
  await act(async () => button("Rename")!.click());
  expect(onSelect).toHaveBeenCalledWith("rename");
});

it.each([false, true])("dispatches the correct action for pinned=%s and closes the menu", async (pinned) => {
  await render(true, pinned);
  const action = pinned ? "unpin" : "pin";
  await act(async () => button(pinned ? "Unpin" : "Pin")!.click());
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(action);
});

it("prevents repeat pin writes while leaving other actions available", async () => {
  await render(true, false, true);
  expect(button("Pin")!.disabled).toBe(true);
  await act(async () => button("Pin")!.click());
  expect(onSelect).not.toHaveBeenCalled();
  expect(button("Rename")!.disabled).toBe(false);
});
