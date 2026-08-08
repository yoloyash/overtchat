import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  connectionAccessError,
  connectionErrorMessage,
  storedConnectionAccessError,
} from "./access";

describe("Agent Connection access", () => {
  it("allows administrators", () => {
    expect(connectionAccessError("admin")).toBeNull();
    expect(storedConnectionAccessError("admin")).toBeNull();
  });

  it("blocks every non-administrator transport and credential type", () => {
    expect(connectionAccessError("user")).toBe(
      "Only administrators can use Agent Connections.",
    );
    expect(storedConnectionAccessError(null)).toBe(
      "Only administrators can use Agent Connections.",
    );
  });

  it("reports missing shebang runtimes without blaming the executable path", () => {
    expect(
      connectionErrorMessage(
        new Error("env: bun: No such file or directory"),
        "omp",
      ),
    ).toBe(
      "Oh My Pi was found, but bun is not available in the selected shell environment.",
    );
  });
});
