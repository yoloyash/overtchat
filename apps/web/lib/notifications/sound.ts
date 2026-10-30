"use client";

let context: AudioContext | undefined;
/** When each sound's current playback ends, on the audio clock. */
const playingUntil = new Map<string, number>();

/** Browsers only play sound after a gesture; call this from one. */
export function unlockAgentAlertSound(): void {
  if (typeof AudioContext === "undefined") return;
  context ??= new AudioContext();
  if (context.state !== "running") {
    void context.resume().catch(() => undefined);
  }
}

/** Two soft notes: rising when an agent needs you, falling when it is done. */
export function playAgentAlertSound(kind: "input" | "done"): void {
  if (!context || context.state !== "running") return;
  const at = context.currentTime;
  // A burst of alerts plays once.
  if (at < (playingUntil.get(kind) ?? 0)) return;
  const notes = kind === "input" ? [784, 1175] : [659, 494];
  notes.forEach((frequency, index) =>
    tone(context!, frequency, at + index * 0.16),
  );
  playingUntil.set(kind, at + 0.6);
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
