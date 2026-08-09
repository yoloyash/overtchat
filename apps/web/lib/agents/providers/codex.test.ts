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
});
