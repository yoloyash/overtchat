import { describe, expect, it } from "vitest";
import { ApiError } from "@overtchat/shared";
import { chatErrorMessage } from "./message";

describe("chatErrorMessage", () => {
  it("shows the text the server sent for a failed response", () => {
    expect(chatErrorMessage(new Error("User not found."))).toBe(
      "User not found.",
    );
    expect(chatErrorMessage(new ApiError("Model configuration error", 503))).toBe(
      "Model configuration error",
    );
  });

  it("keeps the generic copy for transport failures and empty messages", () => {
    const fallback = "Couldn't complete the response. Please try again.";
    expect(chatErrorMessage(new TypeError("Failed to fetch"))).toBe(fallback);
    expect(chatErrorMessage(new Error("   "))).toBe(fallback);
  });

  it("truncates very long provider messages", () => {
    const message = chatErrorMessage(new Error("x".repeat(500)));
    expect(message).toHaveLength(300);
    expect(message.endsWith("…")).toBe(true);
  });
});
