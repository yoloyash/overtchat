"use client";

let context: AudioContext | undefined;
/** When each sound's current playback ends, on the audio clock. */
const playingUntil = new Map<string, number>();
/** How long a page gets to start its audio before an alert goes without. */
const START_WAIT_MS = 300;

function audioContext(): AudioContext | undefined {
  if (typeof AudioContext === "undefined") return undefined;
  if (!context || context.state === "closed") {
    try {
      context = new AudioContext();
    } catch {
      return undefined;
    }
    // A new context's clock starts over.
    playingUntil.clear();
  }
  return context;
}

/** Browsers only start sound after a gesture; call this from one. */
export function unlockAgentAlertSound(): void {
  const audio = audioContext();
  if (audio && audio.state !== "running") {
    void audio.resume().catch(() => undefined);
  }
}

/**
 * Two soft notes: rising when an agent needs you, falling when it is done.
 * Resolves to whether they could play. They cannot in a browser page nobody
 * has clicked or typed in since it loaded.
 */
export async function playAgentAlertSound(
  kind: "input" | "done",
): Promise<boolean> {
  const audio = audioContext();
  if (!audio) return false;
  // Read afresh each time: the state changes while this waits.
  const running = () => audio.state === "running";
  if (!running()) {
    // Sleep or a changed output device can stop the audio; ask for it back.
    // A browser still waiting for a gesture leaves this pending.
    await Promise.race([
      audio.resume().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, START_WAIT_MS)),
    ]);
    if (!running()) return false;
    // The clock stood still meanwhile; nothing from before is still playing.
    playingUntil.clear();
  }
  const at = audio.currentTime;
  // A burst of alerts plays once.
  if (at < (playingUntil.get(kind) ?? 0)) return true;
  const notes = kind === "input" ? [784, 1175] : [659, 494];
  notes.forEach((frequency, index) => tone(audio, frequency, at + index * 0.16));
  playingUntil.set(kind, at + 0.6);
  return true;
}

function tone(context: AudioContext, frequency: number, at: number): void {
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.1, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + 0.42);
}
