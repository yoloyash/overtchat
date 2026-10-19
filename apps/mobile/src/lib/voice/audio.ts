import { AppState, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import type { VoiceAudio, VoiceClientCallbacks } from "@overtchat/voice-client";

type Subscription = { remove(): void };
type NativeAudio = {
  initialize(): Promise<boolean>;
  getMicrophonePermissionsAsync(): Promise<{ granted: boolean }>;
  requestMicrophonePermissionsAsync(): Promise<{ granted: boolean }>;
  toggleRecording(enabled: boolean): boolean;
  playPCMData(data: Uint8Array): void;
  stopPlayback(): void;
  tearDown(): void;
  addListener(event: string, listener: (event: { data: Uint8Array | number | string }) => void): Subscription;
};
const native = requireOptionalNativeModule<NativeAudio>("ExpoTwoWayAudio");
export const nativeVoiceAvailable = native !== null;

/** Permission results may arrive before the activity becomes active again. */
export async function waitForVoiceForeground(permissionRequested = false): Promise<void> {
  const permissionActivity = permissionRequested && Platform.OS === "android";
  if (AppState.currentState === "active") return;
  if (AppState.currentState === "background" && !permissionActivity) throw new Error("Keep OvertChat open to use live voice.");
  await new Promise<void>((resolve, reject) => {
    const finish = (active: boolean) => {
      clearTimeout(timeout);
      subscription.remove();
      if (active) resolve();
      else reject(new Error("Keep OvertChat open to use live voice."));
    };
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active" || (state === "background" && !permissionActivity)) finish(state === "active");
    });
    const timeout = setTimeout(() => finish(false), 5_000);
  });
}

export async function requestVoicePermission(): Promise<boolean> {
  if (!native) throw new Error("Live voice requires an updated mobile app.");
  // Android launches its permission activity even when every permission is granted.
  if ((await native.getMicrophonePermissionsAsync()).granted) return false;
  if (!(await native.requestMicrophonePermissionsAsync()).granted) {
    throw new Error("Allow microphone access in Settings to start live voice.");
  }
  return true;
}

/** The module owns both halves of the audio session so speaker output is echo-cancelled. */
export class NativeVoiceAudio implements VoiceAudio {
  private closed = false;
  private initialized = false;
  private muted = false;
  private subscriptions: Subscription[] = [];
  constructor(private readonly callbacks: VoiceClientCallbacks) {}

  async start(onAudio: (data: ArrayBuffer) => void): Promise<void> {
    if (!native) throw new Error("Live voice requires an updated mobile app.");
    if (this.closed || AppState.currentState !== "active") throw new Error("Keep OvertChat open to use live voice.");
    this.subscriptions = [
      native.addListener("onMicrophoneData", ({ data }) => {
        if (this.closed || this.muted || !(data instanceof Uint8Array)) return;
        onAudio(data.slice().buffer as ArrayBuffer);
      }),
      native.addListener("onInputVolumeLevelData", ({ data }) => {
        if (!this.closed) this.callbacks.onInputLevel(this.muted ? 0 : Number(data));
      }),
      native.addListener("onOutputVolumeLevelData", ({ data }) => {
        if (!this.closed) this.callbacks.onOutputLevel(Number(data));
      }),
      native.addListener("onAudioInterruption", ({ data }) => {
        if (!this.closed && data !== "ended") {
          this.callbacks.onError(new Error("Voice ended because audio was interrupted. Start voice again when ready."));
        }
      }),
    ];
    if (!(await native.initialize())) throw new Error("Could not initialize voice audio.");
    this.initialized = true;
    if (this.closed || AppState.currentState !== "active") {
      await this.close();
      throw new Error("Keep OvertChat open to use live voice.");
    }
    if (!native.toggleRecording(true)) throw new Error("The microphone is in use. Try again when other audio has finished.");
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.initialized && !this.closed) native?.toggleRecording(!muted);
    if (muted) this.callbacks.onInputLevel(0);
  }
  play(data: ArrayBuffer) {
    if (!this.closed && this.initialized) native?.playPCMData(new Uint8Array(data));
  }
  clear() {
    if (this.initialized) native?.stopPlayback();
  }
  async close() {
    this.closed = true;
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
    if (this.initialized) {
      native?.tearDown();
      this.initialized = false;
    }
  }
}
