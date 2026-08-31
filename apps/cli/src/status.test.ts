import { describe, expect, it } from "vitest";
import { providerStatus } from "./status.js";

describe("provider status", () => {
  it("describes deferred setup without exposing the internal provider value", () => {
    expect(providerStatus("disabled")).toBe("not configured");
  });

  it("preserves configured provider names", () => {
    expect(providerStatus("bundled")).toBe("bundled");
    expect(providerStatus("openai-compatible")).toBe("openai-compatible");
  });
});
