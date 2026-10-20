import { describe, expect, it } from "vitest";
import type { VoiceCapability, VoiceUnavailableReason } from "@overtchat/shared";
import { voiceServicePresentation } from "./ServicesPanel";

function unavailable(reason: VoiceUnavailableReason): VoiceCapability {
  return {
    available: false,
    installed: reason !== "not-installed",
    unavailableReason: reason,
  };
}

describe("realtime voice service presentation", () => {
  it("shows a configured service without claiming a health check", () => {
    expect(
      voiceServicePresentation({
        available: true,
        installed: true,
        unavailableReason: null,
      }),
    ).toMatchObject({ label: "Configured", configured: true });
  });

  it.each([
    ["not-installed", "Not installed", "overtchat setup"],
    ["stt-unavailable", "Needs speech-to-text", "speech-to-text provider"],
    ["tts-unavailable", "Needs text-to-speech", "text-to-speech provider"],
    ["not-configured", "Incomplete setup", "overtchat setup"],
  ] as const)("explains %s", (reason, label, guidance) => {
    expect(voiceServicePresentation(unavailable(reason))).toMatchObject({
      label,
      description: expect.stringContaining(guidance),
      configured: false,
    });
  });
});
