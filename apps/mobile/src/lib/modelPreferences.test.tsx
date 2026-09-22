import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSelectedModel } from "./modelPreferences";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
}));

let root: Root;
let current: ReturnType<typeof useSelectedModel>;
function Probe() {
  current = useSelectedModel();
  return null;
}

beforeEach(() => {
  storage.clear();
  const { window } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(
    window.document.getElementById("root") as unknown as HTMLElement,
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("persists a model selection and restores it when switching chats", async () => {
  await act(async () => root.render(<Probe key="first-chat" />));
  expect(current[0]).toBeNull();

  await act(async () => current[1]("model-b"));
  expect(current[0]).toBe("model-b");
  expect(storage.get("overtchat.selectedModel")).toBe("model-b");

  await act(async () => root.render(<Probe key="next-chat" />));
  expect(current[0]).toBe("model-b");
});

it("restores a previously stored selection on a fresh mount", async () => {
  storage.set("overtchat.selectedModel", "model-c");
  await act(async () => root.render(<Probe />));
  expect(current[0]).toBe("model-c");
});
