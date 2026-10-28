import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessions: [] as { id: string; name: string | null; firstMessage: string | null }[],
  applied: [] as [string, string | null, string][],
  generateTitle: vi.fn(),
  taskModel: { providerId: "openai", model: "small" } as object | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/modelConfigs", () => ({
  getTaskModelConfig: () => mocks.taskModel,
}));
vi.mock("@/lib/db/modelPreferences", () => ({
  getModelPreferences: () => ({ defaultModelId: null }),
}));
vi.mock("@/lib/db/agentConnections", () => ({
  listAgentSessionsAwaitingTitles: () =>
    mocks.sessions.filter(
      (session) => !mocks.applied.some(([id]) => id === session.id),
    ),
  applyGeneratedAgentSessionTitle: (id: string, name: string | null, title: string) => {
    mocks.applied.push([id, name, title]);
    return true;
  },
}));
vi.mock("@/lib/title", () => ({
  buildTitlePromptFromText: (text: string) => (text.trim() ? `Title: ${text}` : null),
  generateTitle: mocks.generateTitle,
}));

async function settle() {
  await vi.waitFor(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(mocks.generateTitle.mock.calls.length).toBeGreaterThan(0);
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
}

let scheduleAgentSessionTitles: typeof import("./sessionTitles").scheduleAgentSessionTitles;

beforeEach(async () => {
  vi.resetModules();
  ({ scheduleAgentSessionTitles } = await import("./sessionTitles"));
  mocks.sessions = [];
  mocks.applied = [];
  mocks.taskModel = { providerId: "openai", model: "small" };
  mocks.generateTitle.mockReset();
});

describe("agent session titles", () => {
  it("titles sessions that still show their first line, in list order", async () => {
    mocks.sessions = [
      { id: "new", name: "fix the flaky test", firstMessage: "fix the flaky test" },
      { id: "renamed", name: "Release prep", firstMessage: "ship it" },
      { id: "old", name: null, firstMessage: "can u check issue 486" },
    ];
    mocks.generateTitle.mockImplementation(async ({ prompt }: { prompt: string }) =>
      prompt.includes("flaky") ? "Flaky Test Fix" : "Check Issue 486",
    );

    scheduleAgentSessionTitles("alice");
    // A second request while titles are generated does not start another run.
    scheduleAgentSessionTitles("alice");
    await settle();

    expect(mocks.applied).toEqual([
      ["new", "fix the flaky test", "Flaky Test Fix"],
      ["old", null, "Check Issue 486"],
    ]);
    expect(mocks.generateTitle).toHaveBeenCalledTimes(2);
    expect(mocks.generateTitle.mock.calls[0]![0]).toMatchObject({ userId: "alice" });
  });

  it("waits before retrying a session whose title could not be generated", async () => {
    mocks.sessions = [{ id: "s", name: null, firstMessage: "fix the build" }];
    mocks.generateTitle.mockRejectedValue(new Error("model offline"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    scheduleAgentSessionTitles("alice");
    await settle();
    scheduleAgentSessionTitles("alice");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mocks.generateTitle).toHaveBeenCalledTimes(1);
    expect(mocks.applied).toEqual([]);
    error.mockRestore();
  });

  it("does nothing without a model to write titles", async () => {
    mocks.taskModel = null;
    mocks.sessions = [{ id: "s", name: null, firstMessage: "fix the build" }];
    const { db } = await import("@/lib/db/client");
    Object.assign(db, {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => ({ get: () => undefined }) }),
          }),
        }),
      }),
    });

    scheduleAgentSessionTitles("alice");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mocks.generateTitle).not.toHaveBeenCalled();
  });
});
