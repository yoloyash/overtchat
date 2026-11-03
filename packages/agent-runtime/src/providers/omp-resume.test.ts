import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ probeOmpSessionLease: vi.fn() }));

vi.mock("@overtchat/agent-runtime/omp/lease", () => ({
  probeOmpSessionLease: mocks.probeOmpSessionLease,
}));

import { ompProviderAdapter } from "./omp";

const launch = {
  executable: "omp",
  cwd: "/workspace",
  resume: { providerSessionId: "abc", providerSessionPath: "/sessions/abc.jsonl" },
};
const target = { transport: "local" } as const;

describe("OMP resume checks", () => {
  beforeEach(() => vi.resetAllMocks());

  it("refuses a session another OMP process owns before spawning", async () => {
    mocks.probeOmpSessionLease.mockResolvedValueOnce("held");
    await expect(ompProviderAdapter.checkResume!(target, launch)).rejects.toThrow(
      "This session is still open in another Oh My Pi process, such as its terminal UI. Close it there, then open it here.",
    );
    expect(mocks.probeOmpSessionLease).toHaveBeenCalledWith(target, "omp", "/workspace", "abc");
  });

  it.each(["free", "unknown"] as const)("lets a %s lease resume", async (lease) => {
    mocks.probeOmpSessionLease.mockResolvedValueOnce(lease);
    await expect(ompProviderAdapter.checkResume!(target, launch)).resolves.toBeUndefined();
  });

  it("names the owner when OMP moved to a sibling file during startup", () => {
    expect(() =>
      ompProviderAdapter.sessionIdentity({
        sessionId: "sibling",
        sessionFile: "/sessions/sibling.jsonl",
        persistenceNotice:
          "Session ~/s/abc.jsonl is open for writing in another omp process, so this session now saves to ~/s/sibling.jsonl instead of mixing its entries into that file.",
      }),
    ).toThrow("still open in another Oh My Pi process");
  });

  it("reports other persistence moves with OMP's own explanation", () => {
    expect(() =>
      ompProviderAdapter.sessionIdentity({
        sessionId: "sibling",
        sessionFile: "/sessions/sibling.jsonl",
        persistenceNotice: "Session ~/s/abc.jsonl changed on disk and no longer reads as this session; it is left untouched and this session now saves to ~/s/sibling.jsonl.",
      }),
    ).toThrow("Oh My Pi could not keep writing the requested session file. Session ~/s/abc.jsonl changed on disk");
  });

  it("keeps the plain identity when nothing moved", () => {
    expect(
      ompProviderAdapter.sessionIdentity({ sessionId: "abc", sessionFile: "/sessions/abc.jsonl", sessionName: " Title " }),
    ).toEqual({ providerSessionId: "abc", providerSessionPath: "/sessions/abc.jsonl", sessionName: "Title" });
  });
});
