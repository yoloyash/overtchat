import { describe, expect, it } from "vitest";
import { agentProviderCreationDefaults } from "./catalog";

describe("agentProviderCreationDefaults", () => {
  it("exposes OMP approval modes without runtime discovery", () => {
    expect(agentProviderCreationDefaults("omp")).toEqual({
      modes: [
        expect.objectContaining({ id: "full", dangerous: true }),
        expect.objectContaining({ id: "write" }),
        expect.objectContaining({ id: "ask" }),
      ],
      defaultModeId: "full",
    });
  });

  it("does not invent static modes for dynamically discovered providers", () => {
    expect(agentProviderCreationDefaults("codex")).toEqual({
      modes: [],
      defaultModeId: null,
    });
  });
});
