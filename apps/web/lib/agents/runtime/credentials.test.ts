import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  decryptAgentCredential,
  encryptAgentCredential,
} from "./credentials";

describe("agent credential encryption", () => {
  afterEach(() => {
    delete process.env.AGENT_CONNECTIONS_SECRET;
  });

  it("round trips credentials without storing plaintext", () => {
    process.env.AGENT_CONNECTIONS_SECRET = "test-secret";
    const plaintext = "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----";
    const encrypted = encryptAgentCredential(plaintext);

    expect(encrypted).not.toContain("PRIVATE KEY");
    expect(decryptAgentCredential(encrypted)).toBe(plaintext);
  });

  it("fails closed when no server secret is configured", () => {
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => encryptAgentCredential("secret")).toThrow(
      "AGENT_CONNECTIONS_SECRET or BETTER_AUTH_SECRET",
    );
  });

  it("rejects ciphertext encrypted with another secret", () => {
    process.env.AGENT_CONNECTIONS_SECRET = "first";
    const encrypted = encryptAgentCredential("secret");
    process.env.AGENT_CONNECTIONS_SECRET = "second";

    expect(() => decryptAgentCredential(encrypted)).toThrow();
  });
});
