// Derived from Hugging Face speech-to-speech (Apache-2.0); input is 24 kHz PCM.
const FADE_FRAMES = 32;

class OvertChatAudioPlayback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inputRate = 24000;
    this.step = this.inputRate / sampleRate;
    this.queue = [];
    this.items = new Map();
    this.index = 0;
    this.fraction = 0;
    this.playing = false;
    this.fade = 0;
    this.last = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data?.kind === "config" && data.inputRate > 0) {
        this.inputRate = data.inputRate;
        this.step = this.inputRate / sampleRate;
      } else if (data?.kind === "audio" && data.samples instanceof Float32Array) {
        const key = `${data.item.itemId}:${data.item.contentIndex}`;
        let item = this.items.get(key);
        if (!item) {
          item = { ...data.item, receivedSamples: 0, playedSamples: 0, done: false };
          this.items.set(key, item);
        }
        item.receivedSamples += data.samples.length;
        this.queue.push({ samples: data.samples, item });
        if (!this.playing) {
          this.playing = true;
          this.fade = FADE_FRAMES;
        }
      } else if (data?.kind === "done") {
        const item = this.items.get(`${data.item.itemId}:${data.item.contentIndex}`);
        if (item) item.done = true;
        this.notifyDrained();
      } else if (data?.kind === "clear" || data?.kind === "interrupt") {
        if (data.kind === "interrupt") {
          this.port.postMessage({ kind: "interrupted", items: [...this.items.values()] });
        }
        this.items.clear();
        this.queue.length = 0;
        this.index = 0;
        this.fraction = 0;
        this.playing = false;
        this.last = 0;
      }
    };
  }

  read() {
    if (!this.queue.length) return null;
    const head = this.queue[0].samples;
    const a = head[this.index];
    const b = head[this.index + 1] ?? this.queue[1]?.samples[0] ?? a;
    return a + (b - a) * this.fraction;
  }

  advance() {
    const item = this.queue[0].item;
    item.playedSamples = Math.min(item.receivedSamples, item.playedSamples + this.step);
    this.fraction += this.step;
    while (this.fraction >= 1) {
      this.fraction -= 1;
      this.index += 1;
    }
    while (this.queue.length && this.index >= this.queue[0].samples.length) {
      this.index -= this.queue[0].samples.length;
      this.queue.shift();
    }
  }

  notifyDrained() {
    for (const [key, item] of this.items) {
      if (item.done && item.playedSamples >= item.receivedSamples - 0.001) {
        this.items.delete(key);
        this.port.postMessage({ kind: "drained", item });
      }
    }
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    const output = channels?.[0];
    if (!output) return true;
    for (let frame = 0; frame < output.length; frame += 1) {
      let sample = 0;
      if (this.playing) {
        const next = this.read();
        if (next === null) {
          sample = this.last * (1 - 1 / FADE_FRAMES);
          this.last = sample;
          if (Math.abs(sample) < 0.0001) {
            this.playing = false;
            this.last = 0;
          }
        } else {
          sample = next;
          this.last = next;
          this.advance();
        }
        if (this.fade > 0) {
          sample *= 1 - this.fade / FADE_FRAMES;
          this.fade -= 1;
        }
      }
      output[frame] = sample;
      for (let channel = 1; channel < channels.length; channel += 1) {
        channels[channel][frame] = sample;
      }
    }
    this.notifyDrained();
    return true;
  }
}

registerProcessor("overtchat-audio-playback", OvertChatAudioPlayback);
