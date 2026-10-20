import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentDraft } from "./drafts";

const native = vi.hoisted(() => ({
  server: "https://a.example",
  user: "alice",
  disk: "",
  write: vi.fn(),
}));
vi.mock("expo-file-system", () => ({
  Paths: { document: "/documents" },
  Directory: class {
    create() {}
  },
  File: class {
    get exists() {
      return !!native.disk;
    }
    textSync() {
      return native.disk;
    }
    write(value: string) {
      native.disk = value;
      native.write(value);
    }
  },
}));
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock("@/lib/api", () => ({ getApiBase: () => native.server }));
vi.mock("@/lib/auth/client", () => ({
  getAuthClient: () => ({
    useSession: () => ({ data: { user: { id: native.user } } }),
  }),
}));

let root: Root;
let current: ReturnType<typeof useAgentDraft>;
function Probe({ id }: { id: string }) {
  current = useAgentDraft(id);
  return <div>{current.draft.message}</div>;
}
beforeEach(() => {
  const { window } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(
    window.document.getElementById("root") as unknown as HTMLElement,
  );
  native.server = "https://a.example";
  native.user = "alice";
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("isolates delayed draft moves by their original server and account", async () => {
  await act(async () => root.render(<Probe id="new:scope-test" />));
  const old = current;
  native.server = "https://b.example";
  native.user = "bob";
  await act(async () => root.render(<Probe key="b" id="created:scope-test" />));
  await act(async () =>
    current.setDraft({ message: "Bob's draft", images: [] }, true),
  );
  await act(async () =>
    old.saveDraftToSession("created:scope-test", {
      message: "Alice's prompt",
      images: [],
    }),
  );
  expect(current.draft.message).toBe("Bob's draft");
  const stored = JSON.parse(native.disk);
  expect(
    stored[JSON.stringify(["https://a.example", "alice", "created:scope-test"])]
      .message,
  ).toBe("Alice's prompt");
  expect(
    stored[JSON.stringify(["https://b.example", "bob", "created:scope-test"])]
      .message,
  ).toBe("Bob's draft");
});

it("keeps newer drafts when an earlier submission finishes, in memory and on disk", async () => {
  await act(async () => root.render(<Probe id="new:revision-test" />));
  await act(async () =>
    current.setDraft({ message: "Original", images: [] }, true),
  );
  const submitted = current.draft;
  const old = current;
  await act(async () =>
    current.setDraft({ message: "Newer", images: [] }, true),
  );
  await act(async () =>
    old.setDraft(
      (value) => (value === submitted ? { message: "", images: [] } : value),
      true,
    ),
  );
  expect(current.draft.message).toBe("Newer");
  expect(
    JSON.parse(native.disk)[
      JSON.stringify([native.server, native.user, "new:revision-test"])
    ].message,
  ).toBe("Newer");
  await act(async () =>
    old.saveDraftToSession("created:revision-test", submitted),
  );
  await act(async () =>
    root.render(<Probe key="created" id="created:revision-test" />),
  );
  await act(async () =>
    current.setDraft({ message: "Follow-up", images: [] }, true),
  );
  await act(async () =>
    old.saveDraftToSession("created:revision-test", (value) =>
      value === submitted ? { message: "", images: [] } : value,
    ),
  );
  expect(current.draft.message).toBe("Follow-up");
});
