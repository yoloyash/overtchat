import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (event: { data: unknown }) => void>();
  return {
    appState: { currentState: "active", addEventListener: vi.fn() }, listeners,
    native: {
      initialize: vi.fn(async () => true),
      getMicrophonePermissionsAsync: vi.fn(async () => ({ granted: true })),
      requestMicrophonePermissionsAsync: vi.fn(async () => ({ granted: true })),
      toggleRecording: vi.fn((enabled: boolean) => enabled),
      playPCMData: vi.fn(), stopPlayback: vi.fn(), tearDown: vi.fn(),
      addListener: vi.fn((event: string, listener: (event: { data: unknown }) => void) => {
        listeners.set(event, listener);
        return { remove: () => listeners.delete(event) };
      }),
    },
  };
});
vi.mock("react-native", () => ({ AppState: mocks.appState, Platform: { OS: "android" } }));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => mocks.native }));
import { NativeVoiceAudio, requestVoicePermission, waitForVoiceForeground } from "./audio";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.appState.currentState = "active";
});
function harness() {
  const callbacks = { onStatus: vi.fn(), onInputLevel: vi.fn(), onOutputLevel: vi.fn(), onError: vi.fn() };
  return { audio: new NativeVoiceAudio(callbacks), callbacks, onAudio: vi.fn() };
}

describe("native foreground audio", () => {
  it("does not launch Android's permission activity when already granted", async () => {
    await expect(requestVoicePermission()).resolves.toBe(false);
    expect(mocks.native.requestMicrophonePermissionsAsync).not.toHaveBeenCalled();
  });
  it("requests missing permission and waits for the Android permission activity to close", async () => {
    mocks.native.getMicrophonePermissionsAsync.mockResolvedValueOnce({ granted: false });
    await expect(requestVoicePermission()).resolves.toBe(true);
    mocks.appState.currentState = "background";
    let change!: (state: string) => void;
    const remove = vi.fn();
    mocks.appState.addEventListener.mockImplementation((_event, listener) => {
      change = listener;
      return { remove };
    });
    const ready = waitForVoiceForeground(true);
    change("active");
    await ready;
    expect(remove).toHaveBeenCalledOnce();
  });
  it("does not start if the app stays backgrounded after granting permission", async () => {
    vi.useFakeTimers();
    try {
      mocks.appState.currentState = "background";
      const remove = vi.fn();
      mocks.appState.addEventListener.mockReturnValue({ remove });
      const ready = expect(waitForVoiceForeground(true)).rejects.toThrow("Keep OvertChat open");
      await vi.advanceTimersByTimeAsync(5_000);
      await ready;
      expect(remove).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("waits for permission dismissal but refuses a real background transition", async () => {
    mocks.appState.currentState = "inactive";
    let change!: (state: string) => void;
    const remove = vi.fn();
    mocks.appState.addEventListener.mockImplementation((_event, listener) => {
      change = listener;
      return { remove };
    });
    const ready = waitForVoiceForeground();
    change("active");
    await ready;
    expect(remove).toHaveBeenCalledOnce();
    const backgrounded = waitForVoiceForeground();
    change("background");
    await expect(backgrounded).rejects.toThrow("Keep OvertChat open");
  });
  it("forwards a bounded copy of mic bytes, with mute and close fences", async () => {
    const h = harness();
    await h.audio.start(h.onAudio);
    const mic = mocks.listeners.get("onMicrophoneData")!;
    mic({ data: new Uint8Array([1, 2, 3, 4]).subarray(1, 3) });
    expect(new Uint8Array(h.onAudio.mock.calls[0][0])).toEqual(new Uint8Array([2, 3]));
    h.audio.setMuted(true);
    mic({ data: new Uint8Array([5, 6]) });
    expect(h.onAudio).toHaveBeenCalledOnce();
    await h.audio.close();
    mic({ data: new Uint8Array([7, 8]) });
    h.audio.play(new ArrayBuffer(2));
    expect(h.onAudio).toHaveBeenCalledOnce();
    expect(mocks.native.playPCMData).not.toHaveBeenCalled();
    expect(mocks.native.tearDown).toHaveBeenCalledOnce();
    expect(mocks.listeners.size).toBe(0);
  });
  it("tears down initialization that completes after End without enabling capture", async () => {
    let resolve!: (value: boolean) => void;
    mocks.native.initialize.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const h = harness();
    const starting = h.audio.start(h.onAudio);
    await h.audio.close();
    resolve(true);
    await expect(starting).rejects.toThrow("Keep OvertChat open");
    expect(mocks.native.toggleRecording).not.toHaveBeenCalled();
    expect(mocks.native.tearDown).toHaveBeenCalledOnce();
  });
  it("rejects background startup and denied microphone permission", async () => {
    mocks.appState.currentState = "background";
    await expect(harness().audio.start(vi.fn())).rejects.toThrow("Keep OvertChat open");
    expect(mocks.native.initialize).not.toHaveBeenCalled();
    mocks.native.getMicrophonePermissionsAsync.mockResolvedValueOnce({ granted: false });
    mocks.native.requestMicrophonePermissionsAsync.mockResolvedValueOnce({ granted: false });
    await expect(requestVoicePermission()).rejects.toThrow("Allow microphone access");
  });
  it("reports interruption without automatically restarting when it ends", async () => {
    const h = harness();
    await h.audio.start(h.onAudio);
    const interrupt = mocks.listeners.get("onAudioInterruption")!;
    interrupt({ data: "began" });
    interrupt({ data: "ended" });
    expect(h.callbacks.onError).toHaveBeenCalledOnce();
    expect(mocks.native.toggleRecording).toHaveBeenCalledOnce();
    await h.audio.close();
  });
});
