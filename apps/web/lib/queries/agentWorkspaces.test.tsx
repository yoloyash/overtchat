import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentWorkspaceGitStatus } from "./agentWorkspaces";

function Probe({ enabled }: { enabled: boolean }) {
  const query = useAgentWorkspaceGitStatus("workspace", { enabled });
  return <div>{query.data?.branch ?? "idle"}</div>;
}

describe("agent workspace queries", () => {
  let container: HTMLElement;
  let root: Root;
  let queryClient: QueryClient;
  const originalGlobals = new Map<
    PropertyKey,
    PropertyDescriptor | undefined
  >();

  beforeEach(() => {
    const { window } = parseHTML(
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    for (const [key, value] of Object.entries({
      window,
      document: window.document,
      navigator: window.navigator,
      HTMLElement: window.HTMLElement,
      Event: window.Event,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originalGlobals.set(
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      );
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
    container = window.document.getElementById("root") as HTMLElement;
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          status: {
            isGit: true,
            repositoryRoot: "/workspace",
            branch: "main",
            upstream: null,
            ahead: null,
            behind: null,
            dirty: false,
            changedFiles: 0,
            additions: 0,
            deletions: 0,
            lineStatsComplete: true,
          },
        }),
      ),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    vi.restoreAllMocks();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originalGlobals.clear();
  });

  it("defers Git work until the workspace is visible", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe enabled={false} />
        </QueryClientProvider>,
      );
    });
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe enabled />
        </QueryClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toBe("main"));
    });
  });
});
