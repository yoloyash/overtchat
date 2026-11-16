import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createContext: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.waitUntil }));
vi.mock("resumable-stream", () => ({
  createResumableStreamContext: mocks.createContext,
}));

describe("resumable stream context", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps ordinary streaming available without Redis", async () => {
    vi.stubEnv("REDIS_URL", "");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getStreamContext } = await import("./context");

    expect(getStreamContext()).toBeNull();
    expect(getStreamContext()).toBeNull();
    expect(mocks.createContext).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "[resumable-stream] REDIS_URL is not set; stream resumption is disabled.",
    );
    warning.mockRestore();
  });

  it("creates one shared resumption context when Redis is configured", async () => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
    const context = { resumeExistingStream: vi.fn() };
    mocks.createContext.mockReturnValue(context);
    const { getStreamContext } = await import("./context");

    expect(getStreamContext()).toBe(context);
    expect(getStreamContext()).toBe(context);
    expect(mocks.createContext).toHaveBeenCalledOnce();
    const { waitUntil } = mocks.createContext.mock.calls[0][0];
    const work = Promise.resolve();
    waitUntil(work);
    expect(mocks.waitUntil).toHaveBeenCalledWith(work);
  });

  it("keeps buffering a generation that no request started", async () => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
    mocks.createContext.mockReturnValue({});
    mocks.waitUntil.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });
    const { getStreamContext } = await import("./context");
    getStreamContext();

    const { waitUntil } = mocks.createContext.mock.calls[0][0];
    expect(() => waitUntil(Promise.resolve())).not.toThrow();
    // A failure in that work is the generation's to report, not a crash.
    expect(() => waitUntil(Promise.reject(new Error("Redis went away.")))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
