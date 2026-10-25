import { expect, it } from "vitest";
import { OvertChatVoiceClient } from "./client";
import { OvertChatVoiceClient as SharedVoiceClient } from "@overtchat/voice-client";

it("uses the shared interruption and transport controller", () => {
  expect(OvertChatVoiceClient.prototype).toBeInstanceOf(SharedVoiceClient);
});
