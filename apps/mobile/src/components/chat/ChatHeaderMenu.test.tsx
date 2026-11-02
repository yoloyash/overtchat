import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const anchor = vi.hoisted(() => ({ visible: false }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null, Ionicons: () => null }));
vi.mock("expo-haptics", () => ({ selectionAsync: async () => {} }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ colors: {}, radii: {}, fonts: {} }),
}));
vi.mock("@/components/ui/useMeasuredPopoverAnchor", () => ({
  useMeasuredPopoverAnchor: () => ({
    anchorRef: { current: null },
    anchorRect: null,
    visible: anchor.visible,
    open: () => {
      anchor.visible = true;
    },
    close: () => {
      anchor.visible = false;
    },
  }),
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
  default: ({ children, isVisible }: { children: ReactNode; isVisible: boolean }) =>
    isVisible ? <div>{children}</div> : null,
  PopoverPlacement: { AUTO: "auto" },
}));

import { ChatHeaderMenu } from "./ChatHeaderMenu";

let root: Root;
let container: HTMLElement;
const onSelect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  anchor.visible = false;
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

async function render(props: Partial<React.ComponentProps<typeof ChatHeaderMenu>> = {}) {
  await act(async () => root.render(
    <ChatHeaderMenu
      title="Weekend plans"
      pinned={false}
      pinPending={false}
      pinningSupported
      disabled={false}
      disabledActions={[]}
      onSelect={onSelect}
      {...props}
    />,
  ));
}

function button(name: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
}

it("stays mounted but inert until the chat is saved", async () => {
  await render({ disabled: true });
  expect(button("Chat actions")!.disabled).toBe(true);
  expect(button("Share")).toBeNull();
});

it("opens the shared chat menu with Share and forwards the choice", async () => {
  await render();
  expect(button("Share")).toBeNull();
  await act(async () => button("Chat actions")!.click());
  await render();
  expect(container.textContent).toContain("Weekend plans");
  await act(async () => button("Share")!.click());
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("share");
});
