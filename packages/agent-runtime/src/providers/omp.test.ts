import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ startOmp: vi.fn() }));
vi.mock("@overtchat/agent-runtime/omp/client", () => ({ startOmp: mocks.startOmp }));

import { ompProviderAdapter } from "./omp";

describe("OMP provider adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("launches rpc-ui with an explicit approval mode", () => {
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

  it("defaults new OMP sessions to full access", () => {
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

  it("uses OMP's resolved model and thinking defaults in its catalog", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    mocks.startOmp.mockReturnValue({
      getState: vi.fn().mockResolvedValue({
        model: { provider: "omp", id: "vllm/configured" },
        thinkingLevel: "high",
      }),
      getAvailableModels: vi.fn().mockResolvedValue([
        {
          provider: "omp",
          id: "vllm/first",
          label: "First",
          thinkingOptions: [{ id: "low", label: "Low", isDefault: true }],
        },
        {
          provider: "omp",
          id: "vllm/configured",
          label: "Configured",
          defaultThinkingOptionId: "low",
          thinkingOptions: [
            { id: "low", label: "Low", isDefault: true },
            { id: "high", label: "High" },
          ],
        },
      ]),
      stop,
    });

    const catalog = await ompProviderAdapter.fetchCatalog(
      { transport: "local" },
      { executable: "omp", cwd: "/workspace" },
    );

    expect(catalog.models[0]).not.toHaveProperty("isDefault");
    expect(catalog.models[1]).toMatchObject({
      id: "vllm/configured",
      isDefault: true,
      defaultThinkingOptionId: "high",
      thinkingOptions: [
        expect.objectContaining({ id: "low" }),
        expect.objectContaining({ id: "high", isDefault: true }),
      ],
    });
    expect(catalog.models[1]?.thinkingOptions?.[0]).not.toHaveProperty(
      "isDefault",
    );
    expect(stop).toHaveBeenCalledOnce();
  });

  it("waits for OMP's terminal agent end across async continuations", () => {
    const classifier = ompProviderAdapter.createEventClassifier();

    expect(classifier.classify({ type: "agent_start" })).toMatchObject({
      started: true,
      terminal: false,
    });
    classifier.classify({
      type: "message_end",
      message: { role: "assistant", content: "First pass" },
    });

    expect(
      classifier.classify({
        type: "agent_end",
        isTerminal: false,
        messages: [{ role: "assistant", content: "First pass" }],
      }),
    ).toMatchObject({ terminal: false });
    expect(
      classifier.classify({
        type: "agent_end",
        isTerminal: true,
        messages: [{ role: "assistant", content: "Final pass" }],
      }),
    ).toMatchObject({ terminal: true });
  });
});
