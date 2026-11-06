import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** As much of an audio context as the chime touches. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  /** Whether asking for audio gets it, as after a gesture. */
  static allowed = true;
  state: "suspended" | "running" | "closed" = FakeAudioContext.allowed
    ? "running"
    : "suspended";
  currentTime = 0;
  destination = {};
  tones = 0;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume() {
    if (!FakeAudioContext.allowed) return new Promise<void>(() => undefined);
    this.state = "running";
    return Promise.resolve();
  }
  createOscillator() {
    this.tones += 1;
    return { frequency: {}, connect() {}, start() {}, stop() {} };
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    };
  }
}

async function load() {
  vi.resetModules();
  return import("./sound");
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeAudioContext.instances = [];
  FakeAudioContext.allowed = true;
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("agent alert sound", () => {
  it("plays two notes and says so, once for a burst", async () => {
    const { playAgentAlertSound } = await load();
    expect(await playAgentAlertSound("done")).toBe(true);
    expect(await playAgentAlertSound("done")).toBe(true);
    const [audio] = FakeAudioContext.instances;
    expect(audio.tones).toBe(2);
    // The other sound has a slot of its own.
    expect(await playAgentAlertSound("input")).toBe(true);
    expect(audio.tones).toBe(4);
    audio.currentTime = 1;
    expect(await playAgentAlertSound("done")).toBe(true);
    expect(audio.tones).toBe(6);
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("gives up, and says so, where the page may not start audio", async () => {
    FakeAudioContext.allowed = false;
    const { playAgentAlertSound, unlockAgentAlertSound } = await load();
    const played = playAgentAlertSound("done");
    await vi.advanceTimersByTimeAsync(300);
    expect(await played).toBe(false);
    const [audio] = FakeAudioContext.instances;
    expect(audio.tones).toBe(0);

    // A gesture starts the audio; the next alert is heard.
    FakeAudioContext.allowed = true;
    unlockAgentAlertSound();
    expect(await playAgentAlertSound("done")).toBe(true);
    expect(audio.tones).toBe(2);
  });

  it("asks for audio back after it was stopped", async () => {
    const { playAgentAlertSound } = await load();
    await playAgentAlertSound("done");
    const [audio] = FakeAudioContext.instances;
    // Its clock stops with it, so the last chime still looks recent.
    audio.state = "suspended";
    expect(await playAgentAlertSound("done")).toBe(true);
    expect(audio.tones).toBe(4);
  });

  it("starts over when the context was closed", async () => {
    const { playAgentAlertSound } = await load();
    await playAgentAlertSound("done");
    FakeAudioContext.instances[0].state = "closed";
    expect(await playAgentAlertSound("done")).toBe(true);
    expect(FakeAudioContext.instances).toHaveLength(2);
    expect(FakeAudioContext.instances[1].tones).toBe(2);
  });

  it("is silent where there is no audio at all", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const { playAgentAlertSound } = await load();
    expect(await playAgentAlertSound("done")).toBe(false);
  });
});
