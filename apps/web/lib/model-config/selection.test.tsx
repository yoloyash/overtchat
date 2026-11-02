import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSelectedModel } from "./client";

const preferences = vi.hoisted(() => ({
  data: { defaultModelId: "model-b" as string | null },
  isPending: false,
  isFetching: false,
}));
vi.mock("@/lib/queries/modelPreferences", () => ({
  useModelPreferences: () => preferences,
}));
const project = vi.hoisted(() => ({
  data: undefined as { defaultModelId: string | null } | undefined,
  isPending: true,
}));
vi.mock("@/lib/queries/projects", () => ({
  useOptionalProject: (id: string | null | undefined) =>
    id ? project : { data: undefined, isPending: true },
}));
let root: Root;
let current: ReturnType<typeof useSelectedModel>;
function Probe({
  initialModelId,
  projectId,
}: {
  initialModelId?: string;
  projectId?: string;
}) {
  const selection = useSelectedModel(
    [{ id: "model-a" }, { id: "model-b" }, { id: "model-c" }],
    initialModelId,
    projectId,
  );
  useEffect(() => {
    current = selection;
  }, [selection]);
  return null;
}
beforeEach(() => {
  preferences.data = { defaultModelId: "model-b" };
  preferences.isPending = preferences.isFetching = false;
  project.data = undefined;
  project.isPending = true;
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
it("starts each new chat with the default even after manually selecting another model", async () => {
  await act(async () => root.render(<Probe key="first" />));
  expect(current[0]).toBe("model-b");
  await act(async () => current[1]("model-c"));
  expect(current[0]).toBe("model-c");
  await act(async () => root.render(<Probe key="new" />));
  expect(current[0]).toBe("model-b");
});
it("preserves the existing chat and current selection when the default changes", async () => {
  await act(async () =>
    root.render(<Probe key="saved" initialModelId="model-a" />),
  );
  expect(current[0]).toBe("model-a");
  preferences.data.defaultModelId = "model-c";
  await act(async () =>
    root.render(<Probe key="saved" initialModelId="model-a" />),
  );
  expect(current[0]).toBe("model-a");
  await act(async () => root.render(<Probe key="new" />));
  expect(current[0]).toBe("model-c");
});
it("waits for a fresh default before initializing a new chat", async () => {
  preferences.isFetching = true;
  await act(async () => root.render(<Probe />));
  expect(current[0]).toBe("");
  preferences.isFetching = false;
  preferences.data.defaultModelId = "model-c";
  await act(async () => root.render(<Probe />));
  expect(current[0]).toBe("model-c");
});
it("waits for the default when the saved chat's model is unavailable", async () => {
  preferences.isPending = true;
  await act(async () => root.render(<Probe initialModelId="deleted" />));
  expect(current[0]).toBe("");
  preferences.isPending = false;
  await act(async () => root.render(<Probe initialModelId="deleted" />));
  expect(current[0]).toBe("model-b");
});
it.each([null, "deleted"])(
  "uses configured order when the default is %s",
  async (defaultModelId) => {
    preferences.data.defaultModelId = defaultModelId;
    await act(async () => root.render(<Probe />));
    expect(current[0]).toBe("model-a");
  },
);
it("starts new project chats with the project's default model", async () => {
  await act(async () => root.render(<Probe projectId="p" />));
  expect(current[0]).toBe("");
  project.data = { defaultModelId: "model-c" };
  project.isPending = false;
  await act(async () => root.render(<Probe projectId="p" />));
  expect(current[0]).toBe("model-c");
  await act(async () =>
    root.render(<Probe key="saved" projectId="p" initialModelId="model-a" />),
  );
  expect(current[0]).toBe("model-a");
});
it.each([null, "deleted"])(
  "falls back to the account default when the project default is %s",
  async (defaultModelId) => {
    project.data = { defaultModelId };
    project.isPending = false;
    await act(async () => root.render(<Probe projectId="p" />));
    expect(current[0]).toBe("model-b");
  },
);
