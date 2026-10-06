import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { VoicePlaybackTransport } from "./playback-transport";

function worklet(rate = 48_000) {
  const events: Record<string, unknown>[] = [];
  let Processor: new () => {
    port: { onmessage: (event: { data: unknown }) => void };
    process: (inputs: unknown[], outputs: Float32Array[][]) => void;
  };
  runInNewContext(readFileSync(new URL("../../public/voice/audio-playback.js", import.meta.url), "utf8"), {
    sampleRate: rate,
    Float32Array,
    AudioWorkletProcessor: class {
      port = { postMessage: (event: Record<string, unknown>) => events.push(event) };
    },
    registerProcessor: (_name: string, ctor: typeof Processor) => { Processor = ctor; },
  });
  const processor = new Processor!();
  return {
    events,
    send: (data: unknown) => processor.port.onmessage({ data }),
    play: (frames: number) => processor.process([], [[new Float32Array(frames)]]),
  };
}

const item = { itemId: "audio-1", contentIndex: 0, responseId: "response-1" };

describe("voice playback timing", () => {
  it.each([24_000, 44_100, 48_000])("reports rendered samples, not received audio at %i Hz", (rate) => {
    const player = worklet(rate);
    player.send({ kind: "audio", item, samples: new Float32Array(240_000).fill(0.5) });
    player.send({ kind: "done", item });
    expect(player.events).toEqual([]);
    player.play(rate / 10);
    player.send({ kind: "interrupt" });
    const event = player.events[0] as { items: { playedSamples: number }[] };
    expect(event.items[0].playedSamples).toBeCloseTo(2400, 5);
    player.play(rate);
    expect(player.events).toHaveLength(1);
  });

  it("does not count an underrun as playback or completion", () => {
    const player = worklet();
    player.send({ kind: "audio", item, samples: new Float32Array(2400) });
    player.play(48_000);
    expect(player.events).toEqual([]);
    player.send({ kind: "audio", item, samples: new Float32Array(2400) });
    player.send({ kind: "done", item });
    player.play(4800);
    expect(player.events).toEqual([{ kind: "drained", item: expect.objectContaining({
      itemId: item.itemId, playedSamples: 4800,
    }) }]);
  });

  it("includes unplayed later items when clearing a buffered response", () => {
    const player = worklet();
    player.send({ kind: "audio", item, samples: new Float32Array(2400) });
    player.send({ kind: "audio", item: { ...item, itemId: "audio-2" }, samples: new Float32Array(2400) });
    player.play(2400);
    player.send({ kind: "interrupt" });
    expect(player.events[0]).toEqual({ kind: "interrupted", items: [
      expect.objectContaining({ itemId: "audio-1", playedSamples: 1200 }),
      expect.objectContaining({ itemId: "audio-2", playedSamples: 0 }),
    ] });
  });

  it("uses playback-owned interruption even after the real SDK receives audio.done", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const sent: Record<string, unknown>[] = [];
    const socket = {
      addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
      send: (raw: string) => sent.push(JSON.parse(raw)),
      close() {},
    };
    const player = worklet();
    const transport = new VoicePlaybackTransport(() => player.send({ kind: "interrupt" }), {
      createWebSocket: async () => socket as never, skipOpenEventListeners: true,
    });
    await transport.connect({ apiKey: "test", model: "test", url: "ws://test.invalid" });
    const deliver = (event: unknown) => listeners.get("message")!({ data: JSON.stringify(event) });
    transport.on("audio", (event) => player.send({ kind: "audio", item,
      samples: new Float32Array(event.data.byteLength / 2) }));
    deliver({ type: "response.output_audio.delta", event_id: "e1", response_id: item.responseId,
      item_id: item.itemId, output_index: 0, content_index: 0,
      delta: Buffer.alloc(480_000).toString("base64") });
    deliver({ type: "response.output_audio.done", event_id: "e2", response_id: item.responseId,
      item_id: item.itemId, output_index: 0, content_index: 0 });
    player.play(4800);
    transport.interrupt();
    expect(player.events[0]).toEqual({ kind: "interrupted", items: [
      expect.objectContaining({ itemId: item.itemId, playedSamples: 2400 }),
    ] });
    // No SDK wall-clock truncation competes with the worklet's snapshot.
    expect(sent.filter((event) => event.type === "conversation.item.truncate")).toEqual([]);
    transport.close();
  });
});
