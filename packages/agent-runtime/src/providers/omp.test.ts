import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ startOmp: vi.fn() }));
vi.mock("@overtchat/agent-runtime/omp/client", () => ({ startOmp: mocks.startOmp }));

import { ompProviderAdapter } from "./omp";

describe("OMP provider adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("launches rpc-ui with an explicit Paseo approval mode", () => {
    const client = {};
    mocks.startOmp.mockReturnValue(client);
    const target = { transport: "ssh" as const, alias: "workstation" };
    expect(
      ompProviderAdapter.startSession(target, {
        executable: "omp",
        cwd: "/workspace",
        model: "vllm/qwen",
        thinkingOptionId: "high",
        modeId: "ask",
        resume: {
          providerSessionId: "native",
          providerSessionPath: "/sessions/native.jsonl",
        },
      }),
    ).toBe(client);
    expect(mocks.startOmp).toHaveBeenCalledWith(target, {
      executable: "omp",
      cwd: "/workspace",
      model: "vllm/qwen",
      thinkingOptionId: "high",
      modeId: "ask",
      sessionPath: "/sessions/native.jsonl",
    });
  });

  it("defaults new OMP sessions to Paseo full access", () => {
    mocks.startOmp.mockReturnValue({});
    ompProviderAdapter.startSession(
      { transport: "local" },
      { executable: "omp", cwd: "/workspace" },
    );
    expect(mocks.startOmp).toHaveBeenCalledWith(
      { transport: "local" },
      expect.objectContaining({ modeId: "full" }),
    );
  });
});
