import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  setTaskModelConfig: vi.fn(),
  toAdminModelConfig: vi.fn((row) => row),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/modelConfigs", () => ({
  setTaskModelConfig: mocks.setTaskModelConfig,
  toAdminModelConfig: mocks.toAdminModelConfig,
}));

import { PUT } from "./route";

function request(modelConfigId: unknown = "task-model"): Request {
  return new Request("http://server.test/api/model-configs/task-model", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelConfigId }),
  });
}

describe("task model selection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
    mocks.setTaskModelConfig.mockReturnValue({
      status: "updated",
      modelConfig: {
        id: "task-model",
        label: "Fast model",
        enabled: false,
        taskModel: true,
      },
    });
  });

  it("allows an administrator to select a model hidden from chat", async () => {
    const response = await PUT(request());

    expect(response.status).toBe(200);
    expect(mocks.setTaskModelConfig).toHaveBeenCalledWith("task-model");
    await expect(response.json()).resolves.toMatchObject({
      taskModel: {
        id: "task-model",
        enabled: false,
        taskModel: true,
      },
    });
  });

  it("clears the dedicated task model", async () => {
    mocks.setTaskModelConfig.mockReturnValue({
      status: "updated",
      modelConfig: null,
    });

    const response = await PUT(request(null));

    expect(response.status).toBe(200);
    expect(mocks.setTaskModelConfig).toHaveBeenCalledWith(null);
    await expect(response.json()).resolves.toEqual({ taskModel: null });
  });

  it("rejects an unknown model", async () => {
    mocks.setTaskModelConfig.mockReturnValue({ status: "not_found" });

    const response = await PUT(request("missing"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Model config not found",
    });
  });

  it("requires an administrator", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "user", role: "user" },
    });

    const response = await PUT(request());

    expect(response.status).toBe(403);
    expect(mocks.setTaskModelConfig).not.toHaveBeenCalled();
  });

  it("validates the request body", async () => {
    const response = await PUT(request(42));

    expect(response.status).toBe(400);
    expect(mocks.setTaskModelConfig).not.toHaveBeenCalled();
  });
});
