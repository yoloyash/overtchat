import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getCodeExecutionCapability,
  getSandboxStatus,
  invalidateSandboxStatus,
  resetSandboxStatusForTests,
  runInSandbox,
  SandboxError,
} from "./client";

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const health = {
  status: "ok",
  tier: "full",
  version: "0.1.0",
  packages: { pandas: "2.2.3" },
  tools: ["pandoc", 7],
  skills: [
    { name: "spreadsheets", description: "Read and write Excel files.", path: "/opt/skills/spreadsheets/SKILL.md" },
    { name: "broken" },
  ],
  limits: { timeout_seconds: 30 },
};

const result = {
  exit_code: 0,
  signal: null,
  timed_out: false,
  duration_ms: 12,
  stdout: "2\n",
  stdout_truncated: false,
  stderr: "",
  stderr_truncated: false,
  files: [],
  skipped_files: [],
};

describe("sandbox client", () => {
  beforeEach(() => {
    resetSandboxStatusForTests();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SANDBOX_URL", "http://sandbox:8080/");
    vi.stubEnv("SANDBOX_TOKEN", "secret");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is not installed without a sandbox URL and never probes", async () => {
    vi.stubEnv("SANDBOX_URL", " ");
    expect(await getSandboxStatus()).toEqual({ state: "not-installed" });
    expect(await getCodeExecutionCapability()).toEqual({
      installed: false,
      available: false,
      unavailableReason: "not-installed",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(runInSandbox({ code: "1", files: [] })).rejects.toThrow(
      "Code execution is not configured.",
    );
  });

  it("reads the sandbox description with defaults and drops malformed entries", async () => {
    fetchMock.mockResolvedValueOnce(json(health));
    const status = await getSandboxStatus();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://sandbox:8080/healthz",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(status).toEqual({
      state: "available",
      info: {
        tier: "full",
        version: "0.1.0",
        packages: { pandas: "2.2.3" },
        tools: ["pandoc"],
        skills: [health.skills[0]],
        limits: {
          timeout_seconds: 30,
          max_timeout_seconds: 300,
          max_input_bytes: 100 * 1024 * 1024,
          max_output_files: 20,
          max_output_bytes: 50 * 1024 * 1024,
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Reported capabilities probe again and refresh what chat requests see.
    fetchMock.mockResolvedValueOnce(json({ status: "error", error: "stopping" }, 503));
    expect(await getCodeExecutionCapability()).toEqual({
      installed: true,
      available: false,
      unavailableReason: "unreachable",
    });
    expect((await getSandboxStatus()).state).toBe("unreachable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one probe between concurrent callers and caches by outcome", async () => {
    vi.useFakeTimers();
    let respond!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)));
    const first = getSandboxStatus();
    const second = getSandboxStatus();
    respond(json({ status: "error", error: "Missing capabilities: SETUID" }, 503));
    expect(await first).toEqual({ state: "unreachable", error: "Missing capabilities: SETUID" });
    expect(await second).toBe(await first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // An unavailable sandbox is probed again after 10 seconds.
    fetchMock.mockResolvedValue(json(health));
    vi.advanceTimersByTime(9_999);
    expect((await getSandboxStatus()).state).toBe("unreachable");
    vi.advanceTimersByTime(2);
    expect((await getSandboxStatus()).state).toBe("available");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // An available one is trusted for a minute, unless a failure invalidates it.
    vi.advanceTimersByTime(59_000);
    await getSandboxStatus();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    invalidateSandboxStatus();
    await getSandboxStatus();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports an unreachable sandbox", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await getSandboxStatus()).toEqual({ state: "unreachable", error: "fetch failed" });
    expect(await getCodeExecutionCapability()).toEqual({
      installed: true,
      available: false,
      unavailableReason: "unreachable",
    });
  });

  it("posts runs with the shared token", async () => {
    fetchMock.mockResolvedValueOnce(json(result));
    const files = [{ name: "a.csv", data: "eA==" }];
    expect(await runInSandbox({ code: "print(1 + 1)", files, timeoutSeconds: 90 })).toEqual(result);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://sandbox:8080/run");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
    expect(JSON.parse(String(init?.body))).toEqual({
      code: "print(1 + 1)",
      language: "python",
      files,
      timeout_seconds: 90,
    });
  });

  it("turns failures into sandbox errors and re-probes after server errors", async () => {
    fetchMock.mockResolvedValueOnce(json(health));
    await getSandboxStatus();

    fetchMock.mockResolvedValueOnce(json({ error: "Input files are too large." }, 413));
    await expect(runInSandbox({ code: "1", files: [] })).rejects.toThrow(
      new SandboxError("Input files are too large."),
    );
    await getSandboxStatus();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(new Response("upstream down", { status: 502 }));
    await expect(runInSandbox({ code: "1", files: [] })).rejects.toThrow(
      "The code sandbox returned HTTP 502.",
    );
    fetchMock.mockResolvedValueOnce(json(health));
    await getSandboxStatus();
    expect(fetchMock).toHaveBeenCalledTimes(4);

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(runInSandbox({ code: "1", files: [] })).rejects.toThrow(
      "The code sandbox is unreachable: fetch failed",
    );
  });

  it("propagates cancellation instead of reporting the sandbox as down", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      controller.abort(new DOMException("stopped", "AbortError"));
      throw controller.signal.reason;
    });
    await expect(
      runInSandbox({ code: "1", files: [] }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
