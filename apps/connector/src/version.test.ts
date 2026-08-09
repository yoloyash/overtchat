import { HOST_CONNECTOR_RELEASE_VERSION } from "@overtchat/agent-bridge";
import { describe, expect, it } from "vitest";
import packageMetadata from "../package.json" with { type: "json" };
import { CONNECTOR_VERSION } from "./version.js";

describe("connector version", () => {
  it("matches the package and shared server contract", () => {
    expect(CONNECTOR_VERSION).toBe(packageMetadata.version);
    expect(CONNECTOR_VERSION).toBe(HOST_CONNECTOR_RELEASE_VERSION);
  });
});
