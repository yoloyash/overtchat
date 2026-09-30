import { describe, expect, it } from "vitest";
import { apiError, getErrorMessage } from "@overtchat/shared";

describe("public error messages", () => {
  it("extracts legacy and nested JSON messages without displaying the envelope", () => {
    expect(
      getErrorMessage(
        new Error('{"error":{"message":"Choose a model first."}}'),
      ),
    ).toBe("Choose a model first.");
    expect(getErrorMessage({ message: "Image exceeds 10MB" })).toBe(
      "Image exceeds 10MB",
    );
  });

  it.each([
    "<!DOCTYPE html><html>Bad gateway</html>",
    '{"invalid":true}',
    "{broken",
    "stt_unavailable",
    "Error: failure\n    at foo (server.js:1)",
    "connect ECONNREFUSED 127.0.0.1:9999",
    "x".repeat(501),
  ])("uses a useful fallback for diagnostic output: %s", (message) => {
    expect(getErrorMessage(message, "Couldn't save changes.")).toBe(
      "Couldn't save changes.",
    );
  });

  it("does not diagnose arbitrary TypeErrors as a network outage", () => {
    expect(
      getErrorMessage(
        new TypeError("Cannot read properties of undefined"),
        "Couldn't finish.",
      ),
    ).toBe("Couldn't finish.");
    expect(getErrorMessage(new TypeError("Failed to fetch"))).toContain(
      "Check your connection",
    );
  });

  it("does not blame the user's connection for a provider fetch error", () => {
    expect(apiError(502, { error: "fetch failed" }, "The provider could not complete the request.").message)
      .toBe("The provider could not complete the request.");
  });

  it.each([401, 403, 429])(
    "gives actionable feedback for HTTP %s",
    (status) => {
      const error = apiError(status, "<html>proxy error</html>", "Failed");
      expect(error.status).toBe(status);
      expect(error.message).not.toBe("Failed");
      expect(error.message).not.toContain("<html>");
    },
  );

  it("does not infer missing setup from legacy speech 503s", () => {
    for (const body of [
      { error: "stt_unavailable", role: "admin" },
      "Service unavailable",
      "<html>503</html>",
    ]) {
      const error = apiError(503, body, "Failed", "stt");
      expect(error.message).toContain("temporarily unavailable");
      expect(error.message).not.toMatch(/configured|set up|setup|turned off/);
    }
  });

  it("uses explicit speech reasons and distinguishes upstream credentials from viewer authentication", () => {
    expect(
      apiError(503, { code: "speech_disabled" }, "Failed", "stt").message,
    ).toContain("turned off");
    expect(
      apiError(503, { code: "speech_not_configured" }, "Failed", "stt").message,
    ).toContain("hasn't been set up");
    expect(
      apiError(502, { code: "speech_provider_auth" }, "Failed", "tts").message,
    ).toContain("server's credentials");
    expect(apiError(401, "Unauthorized", "Failed", "tts").message).toContain(
      "Sign in again",
    );
  });
});
