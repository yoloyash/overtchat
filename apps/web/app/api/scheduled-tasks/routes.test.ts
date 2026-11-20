import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedRun } from "@/lib/db/scheduledTasks";
import { createTestDatabase } from "@/lib/scheduled-tasks/test-database";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", () => fixture);
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), runScheduledTask: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/scheduled-tasks/runner", () => ({
  runScheduledTask: mocks.runScheduledTask,
}));
const { raw, db, reset } = createTestDatabase();
fixture.db = db;
const store = await import("@/lib/db/scheduledTasks");
const collection = await import("./route");
const item = await import("./[id]/route");
const runNow = await import("./[id]/run/route");
const history = await import("./[id]/runs/route");
const activity = await import("./activity/route");
const seen = await import("./seen/route");

const url = "http://localhost/api/scheduled-tasks";
const json = (method: string, body?: unknown) =>
  new Request(url, {
    method,
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
const of = (id: string) => ({ params: Promise.resolve({ id }) });
const input = {
  name: "Morning news",
  prompt: "Summarize today's news.",
  modelConfigId: "one",
  schedule: { frequency: "daily", hour: 9, minute: 0 },
  timeZone: "Asia/Kolkata",
};
const create = async (body: unknown = input) => {
  const response = await collection.POST(json("POST", body));
  return { response, body: await response.json() };
};

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "a" } });
  mocks.runScheduledTask.mockImplementation(async (claim: ClaimedRun) => {
    store.finishRun(claim.runId, { status: "success" });
  });
});

describe("scheduled tasks API", () => {
  it("requires a session everywhere", async () => {
    mocks.getSession.mockResolvedValue(null);
    const responses = await Promise.all([
      collection.GET(json("GET")),
      collection.POST(json("POST", input)),
      item.GET(json("GET"), of("x")),
      item.PATCH(json("PATCH", { enabled: false }), of("x")),
      item.DELETE(json("DELETE"), of("x")),
      runNow.POST(json("POST"), of("x")),
      history.GET(json("GET"), of("x")),
      activity.GET(json("GET")),
      seen.POST(json("POST", { chatId: "c" })),
    ]);
    expect(responses.map((response) => response.status)).toEqual(Array(9).fill(401));
    expect(raw.prepare("SELECT count(*) AS n FROM scheduled_tasks").get()).toEqual({ n: 0 });
  });

  it("creates a task for the session's owner and lists it with the limit", async () => {
    const { response, body } = await create({ ...input, name: "  Morning news  " });
    expect(response.status).toBe(201);
    expect(body.task).toMatchObject({
      name: "Morning news",
      enabled: true,
      timeZone: "Asia/Kolkata",
      schedule: { frequency: "daily", hour: 9, minute: 0 },
    });
    expect(typeof body.task.nextRunAt).toBe("number");

    const list = await (await collection.GET(json("GET"))).json();
    expect(list).toMatchObject({ activeLimit: 10, tasks: [{ id: body.task.id }] });

    mocks.getSession.mockResolvedValue({ user: { id: "b" } });
    expect(await (await collection.GET(json("GET"))).json()).toMatchObject({ tasks: [] });
    expect((await item.GET(json("GET"), of(body.task.id))).status).toBe(404);
    expect((await item.PATCH(json("PATCH", { name: "Mine" }), of(body.task.id))).status).toBe(404);
    expect((await item.DELETE(json("DELETE"), of(body.task.id))).status).toBe(404);
    expect((await runNow.POST(json("POST"), of(body.task.id))).status).toBe(404);
    expect((await history.GET(json("GET"), of(body.task.id))).status).toBe(404);
  });

  it.each([
    ["not json", "Invalid JSON body"],
    [{ ...input, name: " " }, "Give the task a name."],
    [{ ...input, prompt: "" }, "Say what the task should do."],
    [{ ...input, modelConfigId: "" }, "Choose a model."],
    [{ ...input, modelConfigId: "hidden" }, "Choose a model that is available for chat."],
    [{ ...input, timeZone: "Mars/Olympus" }, "Use an IANA time zone, such as Europe/Berlin."],
    [
      { ...input, schedule: { frequency: "daily", hour: 25, minute: 0 } },
      "Give the schedule a frequency (once, hourly, daily, weekdays, weekly or monthly) and the time fields it needs.",
    ],
    [{ ...input, schedule: "0 9 * * *" }, expect.stringContaining("Give the schedule a frequency")],
    [
      { ...input, schedule: { frequency: "once", date: "2020-01-01", hour: 9, minute: 0 } },
      "That time has already passed. Choose a later one.",
    ],
  ])("refuses %j", async (body, error) => {
    const result = await create(body);
    expect(result.response.status).toBe(400);
    expect(result.body).toEqual({ error });
    expect(raw.prepare("SELECT count(*) AS n FROM scheduled_tasks").get()).toEqual({ n: 0 });
  });

  it("answers 409 at the limit of tasks switched on", async () => {
    for (let index = 0; index < 10; index += 1) {
      expect((await create()).response.status).toBe(201);
    }
    const { response, body } = await create();
    expect(response.status).toBe(409);
    expect(body.error).toContain("10 scheduled tasks switched on");
  });

  it("edits, pauses and deletes", async () => {
    const { body } = await create();
    const id = body.task.id;
    const patch = async (change: unknown) => {
      const response = await item.PATCH(json("PATCH", change), of(id));
      return { status: response.status, body: await response.json() };
    };
    expect(await patch({ enabled: false })).toMatchObject({
      status: 200,
      body: { task: { enabled: false, nextRunAt: null } },
    });
    expect(
      await patch({ enabled: true, schedule: { frequency: "hourly", minute: 5 } }),
    ).toMatchObject({
      status: 200,
      body: { task: { enabled: true, schedule: { frequency: "hourly", minute: 5 } } },
    });
    expect(await patch({ schedule: { frequency: "weekly", hour: 9, minute: 0 } })).toMatchObject({
      status: 400,
    });
    expect(await patch({ name: "" })).toEqual({
      status: 400,
      body: { error: "Give the task a name." },
    });
    expect((await (await item.GET(json("GET"), of(id))).json()).task.name).toBe("Morning news");

    expect((await item.DELETE(json("DELETE"), of(id))).status).toBe(204);
    expect((await item.DELETE(json("DELETE"), of(id))).status).toBe(404);
  });

  it("starts a run now, shows it in the history, and clears it once its chat is opened", async () => {
    const { body } = await create();
    const id = body.task.id;
    let finish = () => {};
    mocks.runScheduledTask.mockImplementation(
      (claim: ClaimedRun) =>
        new Promise<void>((resolve) => {
          raw.exec("INSERT INTO chats (id, user_id, title) VALUES ('c', 'a', 'Morning news')");
          store.setRunChat(claim.runId, "c");
          finish = () => {
            store.finishRun(claim.runId, { status: "success" });
            resolve();
          };
        }),
    );

    const started = await runNow.POST(json("POST"), of(id));
    expect(started.status).toBe(202);
    const { run } = await started.json();
    expect(run).toMatchObject({ taskId: id, trigger: "manual", status: "running" });
    expect((await runNow.POST(json("POST"), of(id))).status).toBe(409);
    // The reply does not wait for the run, which begins just after it.
    await vi.waitFor(() => expect(mocks.runScheduledTask).toHaveBeenCalledOnce());

    const during = await activity.GET(json("GET"));
    expect(during.headers.get("Cache-Control")).toBe("no-store");
    expect(await during.json()).toMatchObject({
      runs: [{ runId: run.id, status: "running", chatId: "c", taskName: "Morning news" }],
    });

    finish();
    expect(await (await activity.GET(json("GET"))).json()).toMatchObject({
      runs: [{ runId: run.id, status: "success" }],
    });
    expect((await seen.POST(json("POST", {}))).status).toBe(400);
    expect((await seen.POST(json("POST", { chatId: "c" }))).status).toBe(204);
    expect(await (await activity.GET(json("GET"))).json()).toEqual({ runs: [] });

    const runs = await history.GET(json("GET"), of(id));
    expect(runs.headers.get("Cache-Control")).toBe("no-store");
    expect(await runs.json()).toMatchObject({
      runs: [{ id: run.id, status: "success", chatId: "c", seen: true }],
    });
  });
});
