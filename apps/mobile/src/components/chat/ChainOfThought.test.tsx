import React, { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  groupMessageParts,
  type CalendarToolPart,
  type CodeExecutionPart,
  type GmailToolPart,
  type ReadFilePart,
  type SearchFilesPart,
} from "@overtchat/shared";

vi.mock("@expo/vector-icons", () => ({
  Feather: () => null,
  Ionicons: ({ name }: { name: string }) => <i data-icon={name} />,
  MaterialCommunityIcons: ({ name }: { name: string }) => <i data-icon={name} />,
}));
vi.mock("@shopify/flash-list", () => ({ useLayoutState: useState }));
vi.mock("../GmailLogo", () => ({ GmailLogo: () => <i data-icon="gmail" /> }));
vi.mock("../CalendarLogo", () => ({
  CalendarLogo: () => <i data-icon="calendar" />,
}));
vi.mock("@/lib/api", () => ({ getApiBase: () => "https://server.test" }));
vi.mock("@/lib/auth/useAuthCookie", () => ({ useAuthCookie: () => null }));
vi.mock("./MarkdownBody", () => ({
  MarkdownBody: ({ text }: { text: string }) => <p>{text}</p>,
}));
vi.mock("./CodeExecutionFiles", () => ({
  CodeExecutionFiles: ({ files, large }: { files: Array<{ name: string }>; large?: boolean }) => (
    <ul data-run-files="" data-large={String(Boolean(large))}>
      {files.map((file) => (
        <li key={file.name}>{file.name}</li>
      ))}
    </ul>
  ),
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
  expect(container.textContent).not.toContain("file");
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

it("keeps the files runs returned inside their steps", async () => {
  const file = (name: string) => {
    const id = name.replace(".", "-");
    return { id, url: `/api/uploads/${id}`, name, mediaType: "image/png", size: 1 };
  };
  const parts: CodeExecutionPart[] = [
    { ...run, toolCallId: "one", output: { ...run.output!, files: [file("crop.png")] } },
    { ...run, toolCallId: "two", output: { ...run.output!, files: [file("final.png"), file("check.png")] } },
  ];
  await act(async () => {
    root.render(<ChainOfThought parts={parts} active={false} />);
  });
  expect(container.textContent).toContain("Ran code · 3 files");

  await act(async () => {
    (container.querySelector("button") as unknown as { click(): void }).click();
  });
  const lists = [...container.querySelectorAll("[data-run-files]")];
  expect(lists.map((list) => [list.textContent, list.getAttribute("data-large")])).toEqual([
    ["crop.png", "false"],
    ["final.pngcheck.png", "false"],
  ]);
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

it("shows calendar steps by time, title and guests, never descriptions", async () => {
  const event = {
    id: "e1",
    title: "Lunch with Grace",
    start: "2026-11-06T12:00:00-05:00",
    end: "2026-11-06T13:00:00-05:00",
    allDay: false,
    description: "private words",
    guests: [{ email: "grace@example.test", response: "accepted" }],
    link: "https://www.google.com/calendar/event?eid=abc",
  };
  const listed: CalendarToolPart = {
    type: "tool-calendar_list_events",
    toolCallId: "calendar-list",
    state: "output-available",
    input: {},
    output: {
      account: "ada@example.test",
      calendarId: "primary",
      timeZone: "America/New_York",
      now: "2026-11-06T09:00:00-05:00",
      hasMore: false,
      events: [event],
    },
  };
  const deleted: CalendarToolPart = {
    type: "tool-calendar_delete_event",
    toolCallId: "calendar-delete",
    state: "output-available",
    input: { eventId: "e1" },
    output: { account: "ada@example.test", calendarId: "primary", event },
  };

  await act(async () => {
    root.render(<ChainOfThought parts={[listed]} active />);
  });
  expect(container.textContent).toContain("Checking calendar…");

  await act(async () => {
    root.render(<ChainOfThought parts={[listed, deleted]} active={false} />);
  });
  expect(container.textContent).toContain("Deleted event");
  await act(async () => {
    (container.querySelector("button") as unknown as { click(): void }).click();
  });
  const text = (container.textContent ?? "").replace(/\s/g, " ");
  expect(text).toContain("Checked calendar");
  expect(text).toContain("1 event");
  expect(text).toContain("Lunch with Grace");
  expect(text).toContain("12:00 PM – 1:00 PM");
  expect(text).not.toContain("private words");
  expect(container.querySelector('[data-icon="calendar"]')).not.toBeNull();
});

it("shows Gmail steps by sender and subject, never message text", async () => {
  const gmailSearch: GmailToolPart = {
    type: "tool-gmail_search",
    toolCallId: "gmail-search",
    state: "output-available",
    input: { query: "from:grace is:unread" },
    output: {
      hasMore: false,
      messages: [
        {
          from: "Grace Hopper <grace@example.test>",
          subject: "Quarterly numbers",
          date: "2026-11-04T10:00:00.000Z",
          snippet: "private words",
          unread: true,
        },
      ],
    },
  };
  const draft: GmailToolPart = {
    type: "tool-gmail_create_draft",
    toolCallId: "gmail-draft",
    state: "output-available",
    input: { subject: "Re: Quarterly numbers", body: "Thanks, the numbers look right." },
    output: {
      draftId: "r-42",
      threadId: "t1",
      account: "ada@example.test",
      to: "grace@example.test",
      subject: "Re: Quarterly numbers",
    },
  };

  await act(async () => {
    root.render(<ChainOfThought parts={[gmailSearch]} active />);
  });
  expect(container.textContent).toContain('Searching Gmail for "from:grace is:unread"');

  await act(async () => {
    root.render(<ChainOfThought parts={[gmailSearch]} active={false} />);
  });
  expect(container.textContent).toContain("Searched Gmail");
  await act(async () => {
    (container.querySelector("button") as unknown as { click(): void }).click();
  });
  const text = container.textContent ?? "";
  expect(text).toContain("from:grace is:unread");
  expect(text).toContain("1 result");
  expect(text).toContain("Quarterly numbers");
  expect(text).toContain("Grace Hopper");
  expect(text).not.toContain("private words");
  expect(container.querySelector('[data-icon="gmail"]')).not.toBeNull();

  // A saved draft is a card of its own, outside the timeline.
  expect(
    groupMessageParts([gmailSearch, draft] as never).map((segment) => segment.kind),
  ).toEqual(["activity", "gmail-email"]);

  await act(async () => {
    root.render(
      <ChainOfThought
        parts={[
          {
            ...gmailSearch,
            state: "output-error",
            output: undefined,
            errorText: "This account needs to be reconnected in Settings.",
          },
        ]}
        active={false}
      />,
    );
  });
  expect(container.textContent).toContain("Gmail request failed");
});

it("shows what sorting mail changed and which attachment was read", async () => {
  const attachment: GmailToolPart = {
    type: "tool-gmail_read_attachment",
    toolCallId: "gmail-attachment",
    state: "output-available",
    input: { messageId: "m1", attachmentId: "1" },
    output: { filename: "invoice-42.pdf", text: "private words", offset: 0, pageCount: 2 },
  };
  const sorted: GmailToolPart = {
    type: "tool-gmail_modify_labels",
    toolCallId: "gmail-sort",
    state: "output-available",
    input: { threadIds: ["t1", "t2"], add: ["Receipts"], remove: ["INBOX"] },
    output: {
      account: "ada@example.test",
      threads: 2,
      added: ["Receipts"],
      removed: ["INBOX"],
    },
  };

  await act(async () => {
    root.render(<ChainOfThought parts={[attachment, sorted]} active={false} />);
  });
  expect(container.textContent).toContain("2 conversations updated");
  await act(async () => {
    (container.querySelector("button") as unknown as { click(): void }).click();
  });
  const text = container.textContent ?? "";
  expect(text).toContain("invoice-42.pdf");
  expect(text).toContain("2 pages");
  expect(text).toContain("Archived, labeled Receipts");
  expect(text).not.toContain("private words");
});
