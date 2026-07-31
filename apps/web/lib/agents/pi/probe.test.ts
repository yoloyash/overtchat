import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
  resolveConfiguredSshHost: vi.fn(),
  scanSshHostKey: vi.fn(),
  startPiRpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agents/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));
vi.mock("@/lib/agents/runtime/ssh", () => ({
  scanSshHostKey: mocks.scanSshHostKey,
}));
vi.mock("@/lib/agents/runtime/sshConfig", () => ({
  resolveConfiguredSshHost: mocks.resolveConfiguredSshHost,
}));
vi.mock("@/lib/agents/pi/client", () => ({
  startPiRpc: mocks.startPiRpc,
}));

import { probePiConnection } from "./probe";

describe("Pi connection probing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConfiguredSshHost.mockResolvedValue(null);
    mocks.scanSshHostKey.mockResolvedValue({
      hostKey: "[workstation.local]:22 ssh-ed25519 AAAATEST",
      fingerprint: "SHA256:test",
    });
  });

  it("returns the SSH fingerprint before authenticating or running Pi", async () => {
    const probe = await probePiConnection({
      provider: "pi",
      transport: "ssh",
      name: "Workstation",
      executable: "pi",
      hostname: "workstation.local",
      port: 22,
      username: "developer",
      sshAuth: "private_key",
      privateKey: "PRIVATE KEY",
    });

    expect(probe).toEqual({
      status: "host_key",
      hostKey: "[workstation.local]:22 ssh-ed25519 AAAATEST",
      hostKeyFingerprint: "SHA256:test",
    });
    expect(mocks.executeOnHost).not.toHaveBeenCalled();
    expect(mocks.startPiRpc).not.toHaveBeenCalled();
  });

  it("scans a configured alias at its resolved hostname", async () => {
    mocks.resolveConfiguredSshHost.mockResolvedValue({
      alias: "workstation",
      hostname: "10.0.0.91",
      port: 22,
      username: "developer",
    });

    await probePiConnection({
      provider: "pi",
      transport: "ssh",
      name: "Workstation",
      executable: "pi",
      hostname: "workstation",
      port: 22,
      username: "developer",
      sshAuth: "agent",
    });

    expect(mocks.scanSshHostKey).toHaveBeenCalledWith(
      "10.0.0.91",
      22,
      ["workstation"],
    );
  });

});
