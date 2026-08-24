import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ startPi: vi.fn() }));
vi.mock("@overtchat/agent-runtime/pi/client", () => ({ startPi: mocks.startPi }));

import { piProviderAdapter } from "./pi";

describe("Pi provider adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("launches and resumes with the canonical compound model", () => {
    const client = {};
    mocks.startPi.mockReturnValue(client);
    const target = { transport: "local" as const };
    expect(
      piProviderAdapter.startSession(target, {
        executable: "pi",
        cwd: "/workspace",
        model: "anthropic/claude-sonnet",
        thinkingOptionId: "high",
        resume: {
          providerSessionId: "native",
          providerSessionPath: "/sessions/native.jsonl",
        },
      }),
    ).toBe(client);
    expect(mocks.startPi).toHaveBeenCalledWith(target, {
      executable: "pi",
      cwd: "/workspace",
      model: "anthropic/claude-sonnet",
      thinkingOptionId: "high",
      sessionPath: "/sessions/native.jsonl",
    });
  });

  it("owns Pi session identity validation", () => {
    expect(
      piProviderAdapter.sessionIdentity({
        sessionId: "native",
        sessionFile: "/sessions/native.jsonl",
      }),
    ).toMatchObject({
      providerSessionId: "native",
      providerSessionPath: "/sessions/native.jsonl",
    });
    expect(() => piProviderAdapter.sessionIdentity({ sessionId: "native" })).toThrow(
      "Pi did not create a persistent session file",
    );
  });
});
