import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { DocumentToolPart } from "@overtchat/shared";

const mocks = vi.hoisted(() => ({
  setString: vi.fn(async () => true),
  share: vi.fn(async () => ({ action: "sharedAction" })),
  pickDirectory: vi.fn(),
  openURL: vi.fn(async () => true),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  alert: vi.fn(),
  authFetch: vi.fn(),
  webViews: [] as Array<Record<string, unknown>>,
}));

vi.mock("@expo/vector-icons", () => ({
  Feather: ({ name }: { name: string }) => <i data-icon={name} />,
  Ionicons: ({ name }: { name: string }) => <i data-icon={name} />,
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: mocks.setString }));
vi.mock("expo-file-system", () => ({ Directory: { pickDirectoryAsync: mocks.pickDirectory } }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 10, left: 0, right: 0 }),
}));
vi.mock("react-native-webview", () => ({
  WebView: (props: Record<string, unknown>) => {
    mocks.webViews.push(props);
    return <iframe title="web view" />;
  },
}));
vi.mock("@/lib/toast", () => ({ toastSuccess: mocks.toastSuccess, toastError: mocks.toastError }));
vi.mock("@/lib/api", () => ({ authFetch: mocks.authFetch, getApiBase: () => "https://server.test" }));
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ text }: { text: string }) => <article>{text}</article> }));
vi.mock("./CodeBlock", () => ({
  CodeBlock: ({ code, language }: { code: string; language: string }) => (
    <pre data-language={language}>{code}</pre>
  ),
}));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    colors: {
      background: "#000",
      foreground: "#fff",
      card: "#111",
      muted: "#181818",
      mutedForeground: "#888",
      border: "#333",
    },
    fonts: { sansRegular: "System", sansMedium: "System" },
    radii: { md: 8, lg: 12 },
  }),
}));
vi.mock("react-native", () => {
  const View = ({ children, accessibilityLabel }: { children?: ReactNode; accessibilityLabel?: string }) => (
    <div aria-label={accessibilityLabel}>{children}</div>
  );
  return {
    View,
    ScrollView: View,
    Modal: ({ children }: { children?: ReactNode }) => <section role="dialog">{children}</section>,
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    ActivityIndicator: () => <span data-testid="spinner" />,
    Linking: { openURL: mocks.openURL },
    Alert: { alert: mocks.alert },
    Share: { share: mocks.share },
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityState,
    }: {
      children: ReactNode | ((state: { pressed: boolean }) => ReactNode);
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityState?: { selected?: boolean };
    }) => (
      <button
        aria-label={accessibilityLabel}
        aria-pressed={accessibilityState?.selected}
        disabled={disabled}
        onClick={onPress}
      >
        {typeof children === "function" ? children({ pressed: false }) : children}
      </button>
    ),
  };
});

import { DocumentCard } from "./DocumentCard";
import { DocumentViewer } from "./DocumentViewer";
import { DocumentViewerProvider } from "./DocumentViewerContext";

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.webViews.length = 0;
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

const plan = { id: "plan", title: "Launch plan", type: "markdown" as const };

function version(toolCallId: string, n: number, content: string, overrides: Partial<DocumentToolPart> = {}): DocumentToolPart {
  return {
    type: n === 1 ? "tool-create_document" : "tool-update_document",
    toolCallId,
    state: "output-available",
    input: {},
    output: { ...plan, version: n, content },
    ...overrides,
  };
}

function assistant(id: string, parts: DocumentToolPart[]): UIMessage {
  return { id, role: "assistant", parts: parts as UIMessage["parts"] };
}

const messages = [
  assistant("a1", [version("c1", 1, "# Plan\nBeta in June")]),
  assistant("a2", [version("c2", 2, "# Plan\nBeta in July")]),
];

function button(label: string): HTMLButtonElement {
  const found = container.querySelector(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`No button ${label}: ${container.innerHTML}`);
  return found as unknown as HTMLButtonElement;
}

async function press(label: string) {
  await act(async () => button(label).click());
}

it("opens a saved version from its card and pages through versions", async () => {
  const open = vi.fn();
  await act(async () => {
    root.render(
      <DocumentViewerProvider value={{ activeToolCallId: "c2", open }}>
        <DocumentCard part={version("c2", 2, "x")} streaming={false} />
        <DocumentCard part={version("c3", 1, "x", { state: "input-streaming", output: undefined, input: { title: "Draft" } })} streaming={false} />
        <DocumentCard part={version("c4", 1, "x", { state: "output-error", output: undefined, errorText: "bad" })} streaming />
      </DocumentViewerProvider>,
    );
  });
  const card = button("Launch plan, Document · Updated · Version 2");
  expect(card.getAttribute("aria-pressed")).toBe("true");
  await act(async () => card.click());
  expect(open).toHaveBeenCalledWith("c2");
  expect(button("Draft, Stopped before it was saved").disabled).toBe(true);
  expect(container.textContent).toContain("Could not create Untitled document");

  const select = vi.fn();
  await act(async () => {
    root.render(
      <DocumentViewer messages={messages} toolCallId="c2" streaming={false} onSelect={select} onClose={vi.fn()} />,
    );
  });
  expect(container.textContent).toContain("Document · Version 2 of 2");
  expect(container.querySelector("article")?.textContent).toBe("# Plan\nBeta in July");
  expect(button("Next version").disabled).toBe(true);
  await press("Previous version");
  expect(select).toHaveBeenCalledWith("c1");

  await press("Show source");
  expect(container.querySelector("pre")?.getAttribute("data-language")).toBe("markdown");
  await press("Show preview");
  expect(container.querySelector("article")).not.toBeNull();
});

it("copies, shares and saves the shown version", async () => {
  const write = vi.fn();
  const createFile = vi.fn(() => ({ write }));
  mocks.pickDirectory.mockResolvedValue({ createFile });
  await act(async () => {
    root.render(
      <DocumentViewer messages={messages} toolCallId="c1" streaming={false} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
  });
  await press("Copy document");
  expect(mocks.setString).toHaveBeenCalledWith("# Plan\nBeta in June");
  await press("Share document");
  expect(mocks.share).toHaveBeenCalledWith({ title: "Launch plan", message: "# Plan\nBeta in June" });
  type Choice = { text: string; onPress?: () => void };
  const choose = async (text: string) => {
    await press("Save document");
    const buttons = mocks.alert.mock.calls.at(-1)![2] as Choice[];
    expect(buttons.map((choice) => choice.text)).toEqual(["Markdown (.md)", "Word (.docx)", "Cancel"]);
    await act(async () => {
      buttons.find((choice) => choice.text === text)!.onPress!();
    });
  };
  await choose("Markdown (.md)");
  expect(createFile).toHaveBeenCalledWith("Launch plan.md", "text/markdown");
  expect(write).toHaveBeenCalledWith("# Plan\nBeta in June");
  expect(mocks.toastSuccess).toHaveBeenCalledWith("Document saved");

  mocks.authFetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([0x50, 0x4b]).buffer });
  await choose("Word (.docx)");
  expect(mocks.authFetch).toHaveBeenCalledWith("https://server.test/api/documents/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Launch plan", type: "markdown", content: "# Plan\nBeta in June", format: "docx" }),
  });
  expect(createFile).toHaveBeenLastCalledWith(
    "Launch plan.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  expect(write).toHaveBeenLastCalledWith(new Uint8Array([0x50, 0x4b]));

  // A failed export reports an error before asking for a folder.
  mocks.pickDirectory.mockClear();
  mocks.authFetch.mockResolvedValue({ ok: false, status: 500 });
  await choose("Word (.docx)");
  expect(mocks.pickDirectory).not.toHaveBeenCalled();
  expect(mocks.toastError).toHaveBeenCalledWith("Could not save document", expect.any(Error));

  mocks.toastError.mockClear();
  mocks.pickDirectory.mockRejectedValue(new Error("User cancelled"));
  await choose("Markdown (.md)");
  expect(mocks.toastError).not.toHaveBeenCalled();
});

it("saves other document types directly", async () => {
  const write = vi.fn();
  mocks.pickDirectory.mockResolvedValue({ createFile: vi.fn(() => ({ write })) });
  const code = [
    assistant("a", [
      { ...version("k", 1, "print(1)"), output: { id: "s", title: "Script", type: "code", language: "python", version: 1, content: "print(1)" } },
    ]),
  ];
  await act(async () => {
    root.render(<DocumentViewer messages={code} toolCallId="k" streaming={false} onSelect={vi.fn()} onClose={vi.fn()} />);
  });
  await press("Save document");
  expect(mocks.alert).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledWith("print(1)");
});

it("previews HTML and SVG in a locked-down web view", async () => {
  const html = '<h1>Hi</h1><a href="https://example.com">x</a>';
  const pages = [
    assistant("a", [
      { ...version("h", 1, html), output: { id: "page", title: "Page", type: "html", version: 1, content: html } },
      {
        ...version("s", 1, "<svg/>"),
        toolCallId: "s",
        output: { id: "logo", title: "Logo", type: "svg", version: 1, content: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      },
    ]),
  ];
  await act(async () => {
    root.render(<DocumentViewer messages={pages} toolCallId="h" streaming={false} onSelect={vi.fn()} onClose={vi.fn()} />);
  });
  const page = mocks.webViews.at(-1)!;
  expect((page.source as { html: string }).html).toContain("Content-Security-Policy");
  expect((page.source as { html: string }).html.endsWith(html)).toBe(true);
  expect(page).toMatchObject({
    incognito: true,
    sharedCookiesEnabled: false,
    allowFileAccess: false,
    javaScriptCanOpenWindowsAutomatically: false,
  });
  expect(page).not.toHaveProperty("onMessage");
  const guard = page.onShouldStartLoadWithRequest as (request: { url: string }) => boolean;
  expect(guard({ url: "about:blank" })).toBe(true);
  expect(guard({ url: "https://example.com/" })).toBe(false);
  expect(mocks.openURL).toHaveBeenCalledWith("https://example.com/");
  expect(guard({ url: "file:///etc/hosts" })).toBe(false);
  expect(mocks.openURL).toHaveBeenCalledTimes(1);

  await act(async () => {
    root.render(<DocumentViewer messages={pages} toolCallId="s" streaming={false} onSelect={vi.fn()} onClose={vi.fn()} />);
  });
  expect((mocks.webViews.at(-1)!.source as { html: string }).html).toContain(
    'src="data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E"',
  );
});

it("shows a document while it is written and diagrams as source", async () => {
  const writing = [
    assistant("a", [
      version("d", 1, "", {
        state: "input-streaming",
        output: undefined,
        input: { title: "Timeline", type: "mermaid", content: "graph TD; A-->B" },
      }),
    ]),
  ];
  await act(async () => {
    root.render(<DocumentViewer messages={writing} toolCallId="d" streaming onSelect={vi.fn()} onClose={vi.fn()} />);
  });
  expect(container.textContent).toContain("Diagram · Writing…");
  expect(container.querySelector("pre")?.textContent).toBe("graph TD; A-->B");
  expect(button("Copy document").disabled).toBe(true);
  expect(container.textContent).toContain("Open this chat on the web to view the diagram.");
});

it("closes when its tool call leaves the history", async () => {
  const close = vi.fn();
  await act(async () => {
    root.render(<DocumentViewer messages={[]} toolCallId="gone" streaming={false} onSelect={vi.fn()} onClose={close} />);
  });
  expect(close).toHaveBeenCalled();
});
