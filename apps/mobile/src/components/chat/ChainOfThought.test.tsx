import React, { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CodeExecutionPart, ReadFilePart, SearchFilesPart } from "@overtchat/shared";

vi.mock("@expo/vector-icons", () => ({
  Feather: () => null,
  Ionicons: ({ name }: { name: string }) => <i data-icon={name} />,
  MaterialCommunityIcons: ({ name }: { name: string }) => <i data-icon={name} />,
}));
vi.mock("@shopify/flash-list", () => ({ useLayoutState: useState }));
vi.mock("@/lib/api", () => ({ getApiBase: () => "https://server.test" }));
vi.mock("@/lib/auth/useAuthCookie", () => ({ useAuthCookie: () => null }));
vi.mock("./MarkdownBody", () => ({
  MarkdownBody: ({ text }: { text: string }) => <p>{text}</p>,
}));
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
      muted: "#181818",
      mutedForeground: "#888",
      destructive: "#ef4444",
      border: "#333",
    },
    fonts: { sansRegular: "System", sansMedium: "System", mono: "Menlo" },
  }),
}));
vi.mock("react-native", () => {
  const View = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  class AnimatedValue {
    setValue() {}
  }
  const noopLoop = { start: () => {}, stop: () => {} };
  return {
    View,
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Image: () => null,
    Linking: { openURL: async () => {} },
    ActivityIndicator: () => <span data-testid="spinner" />,
    Animated: {
      Value: AnimatedValue,
      View,
      timing: () => noopLoop,
      sequence: () => noopLoop,
      loop: () => noopLoop,
    },
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    Pressable: ({
      children,
      onPress,
    }: {
      children: ReactNode | ((state: { pressed: boolean }) => ReactNode);
      onPress?: () => void;
    }) => (
      <button onClick={onPress}>
        {typeof children === "function" ? children({ pressed: false }) : children}
      </button>
    ),
  };
});

import { ChainOfThought } from "./ChainOfThought";

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

const search: SearchFilesPart = {
  type: "tool-search_files",
  toolCallId: "search",
  state: "output-available",
  input: { query: "zebra protocol" },
  output: {
    query: "zebra protocol",
    files: ["long-report.txt"],
    totalMatches: 1,
    matches: [
      {
        file: "long-report.txt",
        offset: 118_400,
        snippet: "…The zebra protocol access code is ZX-41.",
      },
    ],
  },
};

const read: ReadFilePart = {
  type: "tool-read_file",
  toolCallId: "read",
  state: "output-available",
  input: { file: "long-report.txt", offset: 118_400 },
  output: {
    file: "long-report.txt",
    uploadId: "upload",
    offset: 118_400,
    end: 122_100,
    totalCharacters: 122_100,
  },
};

it("summarizes and expands file reads and searches", async () => {
  await act(async () => {
    root.render(<ChainOfThought parts={[search, read]} active={false} />);
  });
  expect(container.textContent).toContain("Read long-report.txt");
  expect(container.querySelector('[data-icon="document-text-outline"]')).not.toBeNull();

  await act(async () => {
    (container.querySelector("button") as unknown as { click(): void }).click();
  });
  const text = container.textContent ?? "";
  expect(text).toContain("zebra protocol");
  expect(text).toContain("1 match");
  expect(text).toContain("…The zebra protocol access code is ZX-41.");
  expect(text).toContain("118k–122k of 122k chars");
  expect(container.querySelector('[data-icon="file-search-outline"]')).not.toBeNull();
});

it("shows live labels and failures", async () => {
  await act(async () => {
    root.render(
      <ChainOfThought
        parts={[{ ...search, state: "input-available", output: undefined }]}
        active
      />,
    );
  });
  expect(container.textContent).toContain('Searching files for "zebra protocol"');

  await act(async () => {
    root.render(
      <ChainOfThought
        parts={[
          {
            ...read,
            state: "output-error",
            output: undefined,
            errorText: '"long-report.txt" is no longer available.',
          },
        ]}
        active={false}
      />,
    );
  });
  expect(container.textContent).toContain("File read failed");
  await act(async () => {
    (container.querySelector("button") as unknown as { click(): void }).click();
  });
  expect(container.textContent).toContain('"long-report.txt" is no longer available.');
});

const run: CodeExecutionPart = {
  type: "tool-run_python",
  toolCallId: "run",
  state: "output-available",
  input: { code: "print(df.total.sum())" },
  output: {
    exitCode: 0,
    timedOut: false,
    durationMs: 420,
    stdout: "12\n",
    stderr: "",
    files: [],
  },
};

it("shows code runs with their code, status and output", async () => {
  await act(async () => {
    root.render(<ChainOfThought parts={[run]} active={false} />);
  });
  expect(container.textContent).toContain("Ran code");
  expect(container.querySelector('[data-icon="code-slash-outline"]')).not.toBeNull();

  await act(async () => {
    (container.querySelector("button") as unknown as { click(): void }).click();
  });
  const text = container.textContent ?? "";
  expect(text).toContain("Python");
  expect(text).toContain("Done · 0.4s");
  expect(container.querySelector('pre[data-language="python"]')?.textContent).toBe("print(df.total.sum())");
  expect(text).toContain("OUTPUT");
  expect(text).toContain("12");

  await act(async () => {
    root.render(
      <ChainOfThought
        parts={[
          {
            ...run,
            output: {
              ...run.output!,
              exitCode: 1,
              stdout: "",
              stderr: "ZeroDivisionError: division by zero\n",
              stderrTruncated: true,
            },
          },
        ]}
        active={false}
      />,
    );
  });
  expect(container.textContent).toContain("Code ended with an error");
  expect(container.textContent).toContain("Exit code 1");
  expect(container.textContent).toContain("ERRORS (TRUNCATED)");
  expect(container.textContent).toContain("ZeroDivisionError: division by zero");
});

it("labels running, failed and unfinished code runs", async () => {
  const pending = { ...run, state: "input-available" as const, output: undefined };
  await act(async () => {
    root.render(<ChainOfThought parts={[pending]} active />);
  });
  expect(container.textContent).toContain("Running code…");

  await act(async () => {
    root.render(<ChainOfThought parts={[pending]} active={false} />);
  });
  expect(container.textContent).toContain("Code run did not complete");

  await act(async () => {
    root.render(
      <ChainOfThought
        parts={[{ ...pending, state: "output-error", errorText: "The code sandbox is unreachable." }]}
        active={false}
      />,
    );
  });
  expect(container.textContent).toContain("Code run failed");
  await act(async () => {
    (container.querySelector("button") as unknown as { click(): void }).click();
  });
  expect(container.textContent).toContain("The code sandbox is unreachable.");
});
