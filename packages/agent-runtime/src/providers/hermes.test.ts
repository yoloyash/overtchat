import { describe, expect, it } from "vitest";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import { hermesProviderAdapter } from "./hermes";

describe("Hermes provider contract", () => {
  it("only advertises supported controls and keeps provider commands", () => {
    expect(agentProviderMetadata("hermes").capabilities).toEqual({
      steer: true,
      renameSession: false,
    });
    expect(hermesProviderAdapter.steering).toBe("restart");
    const commands = hermesProviderAdapter.mergeCommands([
      { name: "compress", source: "custom" },
    ]);
    expect(commands.map((command) => command.name)).toEqual([
      "new",
      "compact",
      "compress",
    ]);
    expect(
      hermesProviderAdapter.normalizeCommand(
        { type: "prompt", message: "/compact" },
        {},
      ),
    ).toEqual({ type: "compact" });
    expect(
      hermesProviderAdapter.sessionIdentity({ sessionId: "acp-1" }),
    ).toEqual({
      providerSessionId: "acp-1",
      providerSessionPath: "acp-1",
      sessionName: null,
    });
  });
});
