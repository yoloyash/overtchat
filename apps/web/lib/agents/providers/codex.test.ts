import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { codexProviderAdapter } from "./codex";

describe("codexProviderAdapter", () => {
  it("normalizes /usage without sending it to the model", () => {
    expect(
      codexProviderAdapter.normalizeCommand(
        { type: "prompt", message: "/usage" },
        {},
      ),
    ).toEqual({ type: "show_usage" });
  });

  it("keeps /usage with arguments as model input", () => {
    expect(
      codexProviderAdapter.normalizeCommand(
        { type: "prompt", message: "/usage extra" },
        {},
      ),
    ).toEqual({ type: "prompt", message: "/usage extra" });
  });

  it("keeps /usage as model input when an image is attached", () => {
    const command = {
      type: "prompt" as const,
      message: "/usage",
      images: [
        {
          uploadId: "11111111-1111-4111-8111-111111111111",
          filename: "screen.png",
          mediaType: "image/png" as const,
        },
      ],
    };

    expect(codexProviderAdapter.normalizeCommand(command, {})).toBe(command);
  });

  it("routes supported /goal invocations out of band", () => {
    expect(
      codexProviderAdapter.normalizeCommand(
        { type: "prompt", message: "/goal Ship parity" },
        { goalsSupported: true },
      ),
    ).toEqual({
      type: "update_goal",
      action: "set",
      objective: "Ship parity",
    });
    expect(
      codexProviderAdapter.normalizeCommand(
        { type: "prompt", message: "/goal pause" },
        { goalsSupported: true },
      ),
    ).toEqual({ type: "update_goal", action: "pause" });
    expect(() =>
      codexProviderAdapter.normalizeCommand(
        { type: "prompt", message: "/goal Ship parity" },
        { goalsSupported: false },
      ),
    ).toThrow("does not support durable goals");
  });
});
