import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseExplicitSshAliases,
  parseSshConfigExpansion,
} from "./sshConfig";

describe("SSH config discovery", () => {
  it("lists explicit aliases while ignoring wildcard and negated hosts", () => {
    expect(
      parseExplicitSshAliases(`
        Host workstation lab
          HostName 10.0.0.91
        Host *.internal !blocked
        Host production # primary server
      `),
    ).toEqual(["workstation", "lab", "production"]);
  });

  it("parses direct ssh -G expansions", () => {
    expect(
      parseSshConfigExpansion(
        "workstation",
        [
          "host workstation",
          "user developer",
          "hostname 10.0.0.91",
          "port 2222",
          "proxycommand none",
          "identityfile ~/.ssh/id_ed25519",
        ].join("\n"),
      ),
    ).toEqual({
      alias: "workstation",
      hostname: "10.0.0.91",
      port: 2222,
      username: "developer",
    });
  });

  it("omits aliases that require a proxy or custom host-key alias", () => {
    const base = [
      "host private",
      "user developer",
      "hostname 10.0.0.91",
      "port 22",
    ];
    expect(
      parseSshConfigExpansion(
        "private",
        [...base, "proxyjump bastion"].join("\n"),
      ),
    ).toBeNull();
    expect(
      parseSshConfigExpansion(
        "private",
        [...base, "hostkeyalias shared-key"].join("\n"),
      ),
    ).toBeNull();
  });
});
