import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ScheduledTaskActivityRun } from "@overtchat/shared";
import {
  useReadScheduledResults,
  useScheduledRunRefresh,
  useScheduledTaskActivity,
} from "./scheduledTasks";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  getApiBase: () => "https://chat.example",
  authFetch: request,
}));

/** What the stand-in server holds. */
let server: {
  scheduledTasks: boolean | undefined;
  tasks: { id: string }[];
  runs: ScheduledTaskActivityRun[];
};
const calls = () =>
  request.mock.calls.map(
    ([url, init]) =>
      `${(init as { method?: string } | undefined)?.method ?? "GET"} ${String(url).replace("https://chat.example", "")}`,
  );
const run = (
  status: ScheduledTaskActivityRun["status"],
  chatId: string,
): ScheduledTaskActivityRun => ({
  runId: `run-${chatId}`,
  taskId: "task",
  taskName: "Morning news",
  chatId,
  status,
  finishedAt: status === "running" ? null : 1,
});

let root: Root;
let client: QueryClient;
let activity: ReturnType<typeof useScheduledTaskActivity>;
function Probe({ chatId, watching }: { chatId: string; watching: boolean }) {
  activity = useScheduledTaskActivity();
  useScheduledRunRefresh();
  useReadScheduledResults(chatId, watching);
  return null;
}
async function render(chatId: string, watching: boolean) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe chatId={chatId} watching={watching} />
      </QueryClientProvider>,
    ),
  );
  // Let the capability, list and activity requests settle in turn.
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  server = { scheduledTasks: true, tasks: [{ id: "task" }], runs: [] };
  request.mockReset();
  request.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    const path = url.replace("https://chat.example", "");
    const json = (body: unknown) => new Response(JSON.stringify(body));
    if (path === "/api/capabilities") {
      return json({ capabilities: { scheduledTasks: server.scheduledTasks } });
    }
    if (path === "/api/scheduled-tasks") return json({ tasks: server.tasks, activeLimit: 10 });
    if (path === "/api/scheduled-tasks/activity") return json({ runs: server.runs });
    if (path === "/api/scheduled-tasks/seen" && init?.method === "POST") {
      const { chatId } = JSON.parse(init.body ?? "{}") as { chatId: string };
      server.runs = server.runs.filter((item) => item.chatId !== chatId);
      return new Response(null, { status: 204 });
    }
    return new Response("Not found", { status: 404 });
  });
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(window.document.getElementById("root") as unknown as HTMLElement);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

it("asks nothing of a server from before scheduled tasks", async () => {
  server.scheduledTasks = undefined;
  await render("chat", true);
  expect(calls()).toEqual(["GET /api/capabilities"]);
  expect(activity.data).toBeUndefined();
});

it("does not ask about runs until the person has a task", async () => {
  server.tasks = [];
  await render("chat", true);
  expect(calls()).toEqual(["GET /api/capabilities", "GET /api/scheduled-tasks"]);
});

it("marks a finished run read only while its chat is on screen", async () => {
  server.runs = [run("success", "chat"), run("success", "other")];
  await render("chat", false);
  expect(activity.data?.map((item) => item.chatId)).toEqual(["chat", "other"]);
  expect(calls()).not.toContain("POST /api/scheduled-tasks/seen");

  await render("chat", true);
  expect(calls().filter((call) => call === "POST /api/scheduled-tasks/seen")).toHaveLength(1);
  expect(JSON.parse(request.mock.calls.find(([, init]) => init?.method === "POST")?.[1].body)).toEqual({
    chatId: "chat",
  });
  // The list is asked for again, and the other chat is still new.
  expect(activity.data?.map((item) => item.chatId)).toEqual(["other"]);
});

it("leaves a run that is still going unread", async () => {
  server.runs = [run("running", "chat")];
  await render("chat", true);
  expect(activity.data).toHaveLength(1);
  expect(calls()).not.toContain("POST /api/scheduled-tasks/seen");
});

it("asks for the tasks again when a run ends", async () => {
  server.runs = [run("running", "chat")];
  await render("chat", false);
  const lists = () => calls().filter((call) => call === "GET /api/scheduled-tasks").length;
  expect(lists()).toBe(1);

  // Nothing changed: the tasks are left alone.
  await act(async () => {
    await activity.refetch();
  });
  expect(lists()).toBe(1);

  server.runs = [run("success", "chat")];
  await act(async () => {
    await activity.refetch();
  });
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  expect(lists()).toBe(2);
});
