import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import { AgentApprovalCard } from "@/components/agents/AgentApprovalCard";
import { approvalDetails } from "@overtchat/shared/agent-tool-details";
import type { AgentQuestionRequest } from "@overtchat/shared/agent-interaction";

const command = "curl -s http://10.0.0.100:8080/api/status";
const warning =
  "Security scan — [MEDIUM] URL uses a raw IP address; [HIGH] Plain HTTP URL. ".repeat(
    20,
  );
const request: AgentQuestionRequest = {
  type: "interaction_request",
  id: "approval-fixture",
  method: "select",
  approvalKind: "tool",
  title: `${warning}: ${command}`,
  toolDetail: { type: "json", value: { command, description: warning } },
  approvalChoices: [
    { value: "once:opaque", label: "Allow once", kind: "allow" },
    { value: "session:opaque", label: "Allow for session", kind: "always" },
    { value: "deny:opaque", label: "Deny", kind: "deny" },
    { value: "never:opaque", label: "Deny always", kind: "deny" },
  ],
};

afterEach(() => vi.unstubAllGlobals());

it("separates a long provider warning from the command without duplicating either", () => {
  const result = approvalDetails(request);
  expect(result.title).toBe("Run command?");
  expect(result.message).toBe(warning);
  expect(result.sections).toEqual([
    { label: "Command", value: command, kind: "code" },
  ]);
  expect(result.choices.map((c) => c.value)).toEqual([
    "once:opaque",
    "session:opaque",
    "deny:opaque",
    "never:opaque",
  ]);
});

it("preserves edit previews, unknown tool arguments, and other providers' choices", () => {
  const edit = approvalDetails({
    ...request,
    title: "Approve edit: /repo/a.txt",
    toolDetail: {
      type: "json",
      value: {
        tool: "write_file",
        arguments: { path: "/repo/a.txt", content: "new" },
        path: "/repo/a.txt",
        oldText: "old",
        newText: "new",
      },
    },
  });
  expect(edit.title).toBe("Allow file changes?");
  expect(edit.message).toBe("");
  expect(edit.sections).toEqual([
    { label: "Path", value: "/repo/a.txt", kind: "code" },
    { label: "Before", value: "old", kind: "code" },
    { label: "After", value: "new", kind: "code" },
  ]);
  const other = approvalDetails({
    approvalKind: "tool",
    title: "Grant network access",
    toolDetail: { type: "json", value: { network: { enabled: true } } },
    approveValue: "yes",
    alwaysValue: "persist",
    denyValue: "no",
  });
  expect(other.title).toBe("Grant network access");
  expect(other.sections).toContainEqual({
    label: "Network · Enabled",
    value: "true",
    kind: "code",
  });
  expect(other.choices.map((c) => c.value)).toEqual(["yes", "persist", "no"]);
});

it("keeps the card inline, bounds its details, submits exact choices and disables actions while pending", async () => {
  const { window } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Event: window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
  }))
    vi.stubGlobal(key, value);
  const container = window.document.getElementById(
    "root",
  ) as unknown as HTMLElement;
  const root = createRoot(container);
  const respond = vi.fn();
  try {
    await act(async () =>
      root.render(
        <AgentApprovalCard
          request={request}
          pending={false}
          onRespond={respond}
        />,
      ),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector("h3")?.textContent).toBe("Run command?");
    expect(
      container.querySelector('[aria-label="Requested action"]')?.className,
    ).toContain("max-h-[200px]");
    expect(container.querySelectorAll("button")).toHaveLength(4);
    for (const [index, button] of Array.from(
      container.querySelectorAll("button"),
    ).entries()) {
      await act(async () => button.click());
      expect(respond).toHaveBeenLastCalledWith({
        value: ["once:opaque", "session:opaque", "deny:opaque", "never:opaque"][
          index
        ],
      });
    }
    await act(async () =>
      root.render(
        <AgentApprovalCard
          request={request}
          pending
          error="Try again"
          onRespond={respond}
        />,
      ),
    );
    expect(
      Array.from(container.querySelectorAll("button")).every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Try again",
    );
  } finally {
    await act(async () => root.unmount());
  }
});
