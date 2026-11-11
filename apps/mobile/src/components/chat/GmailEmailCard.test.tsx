import React, { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { replacedGmailEmailIds, type GmailToolPart } from "@overtchat/shared";

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), openURL: vi.fn() }));

vi.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => <i data-icon={name} />,
}));
vi.mock("@shopify/flash-list", () => ({ useLayoutState: useState }));
vi.mock("@/components/GmailLogo", () => ({ GmailLogo: () => <i data-icon="gmail" /> }));
vi.mock("@/lib/api", () => ({
  authFetch: mocks.authFetch,
  getApiBase: () => "https://server.test",
}));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    colors: {
      foreground: "#fff",
      muted: "#181818",
      mutedForeground: "#888",
      destructive: "#ef4444",
      border: "#333",
      primary: "#fff",
      primaryForeground: "#000",
    },
    fonts: { sansRegular: "System", sansMedium: "System" },
    radii: { pill: 999 },
  }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Linking: { openURL: mocks.openURL },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityRole,
  }: {
    children: ReactNode | ((state: { pressed: boolean }) => ReactNode);
    onPress?: () => void;
    disabled?: boolean;
    accessibilityRole?: string;
  }) => (
    <button onClick={onPress} disabled={disabled} data-role={accessibilityRole}>
      {typeof children === "function" ? children({ pressed: false }) : children}
    </button>
  ),
}));

import { GmailEmailCard } from "./GmailEmailCard";

let root: Root;
let container: HTMLElement;
let client: QueryClient;

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
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  mocks.authFetch.mockReset();
  mocks.openURL.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const render = (
  part: GmailToolPart,
  props: { canSend?: boolean; replaced?: ReadonlySet<string> } = {},
) =>
  act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <GmailEmailCard part={part} canSend={props.canSend ?? true} replaced={props.replaced} />
      </QueryClientProvider>,
    );
  });

const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  ) as (HTMLButtonElement & { click(): void }) | undefined;

const press = (label: string) =>
  act(async () => {
    button(label)!.click();
    // Let the request and its recorded result settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** A fresh ID per test: what a card did is remembered for the app's lifetime. */
let next = 0;
const composed = (overrides: Record<string, unknown> = {}): GmailToolPart => ({
  type: "tool-gmail_compose",
  toolCallId: `call-${++next}`,
  state: "output-available",
  input: {
    to: ["grace@example.test"],
    subject: "Lunch",
    body: "Thursday at noon?",
    ...overrides,
  },
  output: {
    emailId: `e-${next}`,
    threadId: null,
    account: "ada@example.test",
    to: "grace@example.test",
    subject: "Lunch",
    status: "not_sent",
  },
});

it("sends an email only the chat holds with what it says, once", async () => {
  const email = composed();
  const id = (email.output as { emailId: string }).emailId;
  mocks.authFetch.mockResolvedValue(
    answer({ sent: { at: "2026-11-05T12:00:00.000Z", threadId: "t9" } }),
  );

  await render(email);
  expect(container.textContent).toContain("Lunch");
  expect(container.textContent).toContain("Not sent · To grace@example.test");
  expect(container.textContent).toContain("Thursday at noon?");
  // Nothing is in Gmail yet, so there is nothing to open.
  expect(container.querySelector('[data-icon="open-outline"]')).toBeNull();
  expect(button("Save to Gmail")).toBeDefined();

  await press("Send");
  expect(mocks.authFetch).toHaveBeenCalledTimes(1);
  const [url, init] = mocks.authFetch.mock.calls[0];
  expect(url).toBe(`https://server.test/api/integrations/gmail/emails/${id}/send`);
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({
    to: ["grace@example.test"],
    cc: [],
    bcc: [],
    subject: "Lunch",
    body: "Thursday at noon?",
  });
  expect(container.textContent).toContain("Sent · To grace@example.test");
  expect(button("Send")).toBeUndefined();
  expect(button("Save to Gmail")).toBeUndefined();

  // The list recycles cards: a new one for the same email still says sent,
  // and opens the sent message.
  await render({ ...email });
  expect(container.textContent).toContain("Sent · To grace@example.test");
  await act(async () => {
    (container.querySelector('button[data-role="link"]') as unknown as { click(): void }).click();
  });
  expect(mocks.openURL).toHaveBeenCalledWith(
    "https://mail.google.com/mail/?authuser=ada%40example.test#all/t9",
  );
});

it("saves an email in Gmail, then sends that draft", async () => {
  const email = composed();
  const id = (email.output as { emailId: string }).emailId;
  mocks.authFetch.mockResolvedValueOnce(answer({ saved: { draftId: "r-7" } }));

  await render(email);
  await press("Save to Gmail");
  expect(mocks.authFetch.mock.calls[0][0]).toBe(
    `https://server.test/api/integrations/gmail/emails/${id}/draft`,
  );
  expect(container.textContent).toContain("Draft in Gmail, not sent · To grace@example.test");
  expect(button("Save to Gmail")).toBeUndefined();
  expect(container.querySelector('[data-icon="open-outline"]')).not.toBeNull();

  mocks.authFetch.mockResolvedValueOnce(
    answer({ sent: { at: "2026-11-05T12:00:00.000Z", threadId: "t9" } }),
  );
  await press("Send");
  // The server sends the draft as it stands in Gmail for this email.
  expect(mocks.authFetch.mock.calls[1][0]).toBe(
    `https://server.test/api/integrations/gmail/emails/${id}/send`,
  );
  expect(container.textContent).toContain("Sent · To grace@example.test");
});

it("says why a send failed and leaves the email to be sent again", async () => {
  const email = composed();
  mocks.authFetch.mockResolvedValueOnce(
    answer({ error: "This account needs to be reconnected in Settings." }, 409),
  );

  await render(email);
  await press("Send");
  expect(container.textContent).toContain("This account needs to be reconnected in Settings.");
  expect(container.textContent).toContain("Not sent · To grace@example.test");
  expect(button("Send")).toBeDefined();
});

it("sends a draft a model saved in Gmail by its own ID", async () => {
  const draft: GmailToolPart = {
    type: "tool-gmail_create_draft",
    toolCallId: "call-draft",
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
  mocks.authFetch.mockResolvedValue(
    answer({ sent: { at: "2026-11-05T12:00:00.000Z", threadId: "t1" } }),
  );

  await render(draft);
  expect(container.textContent).toContain("Draft in Gmail, not sent · To grace@example.test");
  expect(container.textContent).toContain("Thanks, the numbers look right.");
  // It is in Gmail already, so it opens there and has nothing to save.
  expect(container.querySelector('[data-icon="open-outline"]')).not.toBeNull();
  expect(button("Save to Gmail")).toBeUndefined();

  await press("Send");
  const [url, init] = mocks.authFetch.mock.calls[0];
  expect(url).toBe("https://server.test/api/integrations/gmail/drafts/r-42/send");
  expect(init.body).toBeUndefined();
  expect(container.textContent).toContain("Sent · To grace@example.test");
});

it("offers nothing to press on a replaced email, a sent one, or a chat that is read only", async () => {
  const earlier = composed();
  const later = composed({
    replaces: (earlier.output as { emailId: string }).emailId,
  });
  const replaced = replacedGmailEmailIds([{ parts: [earlier] }, { parts: [later] }]);

  await render(earlier, { replaced });
  expect(container.textContent).toContain("Replaced by a newer version · To grace@example.test");
  expect(container.textContent).toContain("Thursday at noon?");
  expect(button("Send")).toBeUndefined();
  expect(button("Save to Gmail")).toBeUndefined();

  await render(later, { replaced });
  expect(button("Send")).toBeDefined();

  await render(later, { replaced, canSend: false });
  expect(button("Send")).toBeUndefined();

  // One a model sent itself, where the user allowed that.
  await render({
    type: "tool-gmail_send",
    toolCallId: "call-sent",
    state: "output-available",
    input: { to: ["grace@example.test"], subject: "Payment", body: "I will pay today." },
    output: {
      threadId: "t3",
      account: "ada@example.test",
      to: "grace@example.test",
      subject: "Payment",
      status: "sent",
      sentAt: "2026-11-05T12:00:00.000Z",
    },
  });
  expect(container.textContent).toContain("Sent · To grace@example.test");
  expect(container.textContent).toContain("I will pay today.");
  expect(button("Send")).toBeUndefined();
  expect(mocks.authFetch).not.toHaveBeenCalled();
});
