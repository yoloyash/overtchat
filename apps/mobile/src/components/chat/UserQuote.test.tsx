import React, { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@shopify/flash-list", () => ({ useLayoutState: useState }));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    colors: { border: "#333", mutedForeground: "#888" },
    fonts: { sansRegular: "System", sansMedium: "System" },
  }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({
    children,
    numberOfLines,
  }: {
    children?: ReactNode;
    numberOfLines?: number;
  }) => <span data-lines={numberOfLines}>{children}</span>,
  Pressable: ({
    children,
    onPress,
  }: {
    children: ReactNode;
    onPress?: () => void;
  }) => <button onClick={onPress}>{children}</button>,
  StyleSheet: { create: (value: unknown) => value },
}));

import { UserQuote } from "./UserQuote";

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
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

it("shows a short quote in full with nothing to open", async () => {
  await act(async () => root.render(<UserQuote text="Skip the pumice stone." />));

  expect(container.textContent).toBe("Skip the pumice stone.");
  expect(container.querySelector("span")?.getAttribute("data-lines")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
});

it("collapses a long quote to four lines until it is opened", async () => {
  const text = "one\ntwo\nthree\nfour\nfive";
  await act(async () => root.render(<UserQuote text={text} />));

  const passage = container.querySelector("span")!;
  const toggle = container.querySelector("button")!;
  expect(passage.textContent).toBe(text);
  expect(passage.getAttribute("data-lines")).toBe("4");
  expect(toggle.textContent).toBe("Show more");

  await act(async () => toggle.click());
  expect(passage.getAttribute("data-lines")).toBeNull();
  expect(toggle.textContent).toBe("Show less");
});
