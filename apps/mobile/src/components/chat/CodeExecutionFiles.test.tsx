import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CodeExecutionFile } from "@overtchat/shared";

const mocks = vi.hoisted(() => ({
  pickDirectory: vi.fn(),
  authFetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("expo-file-system", () => ({ Directory: { pickDirectoryAsync: mocks.pickDirectory } }));
vi.mock("@/lib/toast", () => ({ toastSuccess: mocks.toastSuccess, toastError: mocks.toastError }));
vi.mock("@/lib/api", () => ({ authFetch: mocks.authFetch, getApiBase: () => "https://server.test" }));
vi.mock("@/lib/theme", () => ({ useTheme: () => ({ colors: { primary: "#6366f1" } }) }));
vi.mock("./AttachmentChip", () => ({
  AttachmentChip: ({
    attachment,
    meta,
    large,
  }: {
    attachment: { url: string; filename: string; mediaType: string };
    meta: { category: string; size: number };
    large?: boolean;
  }) => (
    <figure data-url={attachment.url} data-category={meta.category} data-large={String(Boolean(large))}>
      {attachment.filename}
    </figure>
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children: ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));

import { CodeExecutionFiles } from "./CodeExecutionFiles";

let root: Root;
let container: HTMLElement;

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

const files: CodeExecutionFile[] = [
  { id: "chart", url: "/api/uploads/chart", name: "totals.png", mediaType: "image/png", size: 2_048 },
  { id: "table", url: "/api/uploads/table", name: "totals.csv", mediaType: "text/csv", size: 29 },
  {
    id: "report",
    url: "/api/uploads/report",
    name: "report.docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 9_000,
  },
];

async function press(label: string) {
  const button = container.querySelector(`button[aria-label="${label}"]`) as unknown as { click(): void };
  await act(async () => button.click());
}

it("previews images large and shows other files as cards", async () => {
  await act(async () => root.render(<CodeExecutionFiles files={files} />));
  const chips = [...container.querySelectorAll("figure")].map((chip) => [
    chip.textContent,
    chip.getAttribute("data-category"),
    chip.getAttribute("data-large"),
  ]);
  expect(chips).toEqual([
    ["totals.png", "image", "true"],
    ["totals.csv", "spreadsheet", "false"],
    ["report.docx", "document", "false"],
  ]);
});

it("saves a returned file to a chosen folder under its own name", async () => {
  const write = vi.fn();
  const createFile = vi.fn(() => ({ write }));
  mocks.pickDirectory.mockResolvedValue({ createFile });
  mocks.authFetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode("a,b\n").buffer });
  await act(async () => root.render(<CodeExecutionFiles files={files} />));

  await press("Save totals.csv");
  expect(mocks.authFetch).toHaveBeenCalledWith("https://server.test/api/uploads/table");
  expect(createFile).toHaveBeenCalledWith("totals.csv", "text/csv");
  expect(write).toHaveBeenCalledWith(new TextEncoder().encode("a,b\n"));
  expect(mocks.toastSuccess).toHaveBeenCalledWith("File saved");

  // A failed download reports an error before asking for a folder.
  mocks.pickDirectory.mockClear();
  mocks.authFetch.mockResolvedValue({ ok: false, status: 404 });
  await press("Save report.docx");
  expect(mocks.pickDirectory).not.toHaveBeenCalled();
  expect(mocks.toastError).toHaveBeenCalledWith("Could not save file", expect.any(Error));

  // Cancelling the folder picker is not an error.
  mocks.toastError.mockClear();
  mocks.authFetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  mocks.pickDirectory.mockRejectedValue(new Error("User cancelled"));
  await press("Save totals.png");
  expect(mocks.toastError).not.toHaveBeenCalled();
});
