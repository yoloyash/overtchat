import "server-only";
import type {
  VoiceCapability,
  VoiceUnavailableReason,
} from "@overtchat/shared";
import {
  getServerCapability,
  isServerCapabilityInstalled,
} from "@/lib/db/serverCapabilities";

export function getVoiceCapability(): VoiceCapability {
  const installed = isServerCapabilityInstalled("voice");
  let unavailableReason: VoiceUnavailableReason | null = null;
  if (!installed) unavailableReason = "not-installed";
  else if (!process.env.VOICE_SHARED_SECRET?.trim()) {
    unavailableReason = "not-configured";
  } else if (getServerCapability("stt").provider === "disabled") {
    unavailableReason = "stt-unavailable";
  } else if (getServerCapability("tts").provider === "disabled") {
    unavailableReason = "tts-unavailable";
  }
  const available = unavailableReason === null;
  return {
    available,
    installed,
    unavailableReason,
  };
}
