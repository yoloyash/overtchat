import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startOpenCodeRuntime: vi.fn(),
  fetchOpenCodeCatalog: vi.fn(),
  listOpenCodeSessions: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/opencode/client", () => mocks);

import { openCodeProviderAdapter } from "./opencode";

describe("OpenCode provider adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("launches and resumes with model, variant, and agent selection", () => {
    const client = {};
    mocks.startOpenCodeRuntime.mockReturnValue(client);
    const target = { transport: "local" as const };
    expect(
      openCodeProviderAdapter.startSession(target, {
        executable: "opencode",
        cwd: "/workspace",
        model: "openai/gpt-test",
        thinkingOptionId: "high",
        modeId: "build",
        resume: {
          providerSessionId: "ses-1",
          providerSessionPath: "ses-1",
        },
      }),
    ).toBe(client);
    expect(mocks.startOpenCodeRuntime).toHaveBeenCalledWith(target, {
      executable: "opencode",
      cwd: "/workspace",
      model: "openai/gpt-test",
      thinkingOptionId: "high",
      modeId: "build",
      resumeSessionId: "ses-1",
    });
  });

  it("classifies turns and compaction", () => {
    const classifier = openCodeProviderAdapter.createEventClassifier();
    expect(classifier.classify({ type: "turn_start" })).toEqual({
      started: true,
      terminal: false,
    });
    expect(classifier.classify({ type: "turn_end" })).toEqual({
      started: false,
      terminal: true,
    });
    expect(classifier.classify({ type: "compaction_start" })).toEqual({
      started: true,
      terminal: false,
    });
  });

  it("owns OpenCode session identity and generic slash normalization", () => {
    expect(
      openCodeProviderAdapter.sessionIdentity({
        sessionId: "ses-1",
        sessionFile: "ses-1",
        sessionName: "Repair",
      }),
    ).toEqual({
      providerSessionId: "ses-1",
      providerSessionPath: "ses-1",
      sessionName: "Repair",
    });
    expect(
      openCodeProviderAdapter.normalizeCommand(
        { type: "prompt", message: "/compact" },
        {},
      ),
    ).toEqual({ type: "compact" });
  });
});
