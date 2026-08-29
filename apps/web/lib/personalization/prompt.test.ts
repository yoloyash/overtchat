import { describe, expect, it } from "vitest";
import {
  memorySystemPrompt,
  personalizationContextUsage,
  personalizationSystemPrompt,
  userProfileSystemPrompt,
} from "./prompt";

describe("personalization prompt", () => {
  it("omits empty profile and memory sections", () => {
    expect(
      userProfileSystemPrompt({
        preferredName: null,
        occupation: null,
        about: null,
      }),
    ).toBeNull();
    expect(memorySystemPrompt([])).toBeNull();
  });

  it("renders only populated profile fields", () => {
    expect(
      userProfileSystemPrompt({
        preferredName: "Boomer",
        occupation: null,
        about: "Likes simple systems.",
      }),
    ).toBe(
      [
        "# User profile",
        "Preferred name: Boomer",
        "More about the user: Likes simple systems.",
      ].join("\n"),
    );
  });

  it("renders keyed memories without additional policy text", () => {
    expect(
      memorySystemPrompt([
        { key: "response_style", value: "Prefer concise answers." },
        { key: "timezone", value: "Uses America/Los_Angeles." },
      ]),
    ).toBe(
      [
        "# Existing memory about the user",
        "- `response_style`: Prefer concise answers.",
        "- `timezone`: Uses America/Los_Angeles.",
      ].join("\n"),
    );
  });

  it("measures the complete personalization context in UTF-8 bytes", () => {
    const personalization = {
      preferredName: "Boomer",
      occupation: null,
      about: "你好",
    };
    const memories = [{ key: "style", value: "Concise." }];
    const context = personalizationSystemPrompt(personalization, memories);

    expect(context).toBe(
      [
        "# User profile\nPreferred name: Boomer\nMore about the user: 你好",
        "# Existing memory about the user\n- `style`: Concise.",
      ].join("\n\n"),
    );
    expect(personalizationContextUsage(personalization, memories).bytes).toBe(
      new TextEncoder().encode(context ?? "").byteLength,
    );
  });
});
