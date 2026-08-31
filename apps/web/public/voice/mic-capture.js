// Derived from Hugging Face speech-to-speech (Apache-2.0); emits 24 kHz mono PCM16.
const TARGET_RATE = 24000;

class OvertChatMicCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const chunkMs = options?.processorOptions?.chunkMs ?? 40;
    this.ratio = sampleRate / TARGET_RATE;
    this.chunkSamples = Math.round((TARGET_RATE * chunkMs) / 1000);
    this.scratch = new Float32Array(0);
    this.enabled = true;
    this.port.onmessage = (event) => {
      if (event.data?.kind === "enable") this.enabled = Boolean(event.data.value);
    };
  }

  process(inputs) {
    const incoming = inputs[0]?.[0];
    if (!incoming?.length) return true;
    const combined = new Float32Array(this.scratch.length + incoming.length);
    combined.set(this.scratch);
    combined.set(incoming, this.scratch.length);
    this.scratch = combined;

    const needed = Math.ceil(this.chunkSamples * this.ratio);
    while (this.scratch.length >= needed) {
      const output = new Int16Array(this.chunkSamples);
      let sumSquares = 0;
      for (let index = 0; index < output.length; index += 1) {
        const position = index * this.ratio;
        const left = Math.floor(position);
        const fraction = position - left;
        const a = this.scratch[left] ?? 0;
        const b = this.scratch[left + 1] ?? a;
        const sample = a + (b - a) * fraction;
        sumSquares += sample * sample;
        const clamped = Math.max(-1, Math.min(1, sample));
        output[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
      const consumed = Math.floor(this.chunkSamples * this.ratio);
      this.scratch = this.scratch.slice(consumed);
      this.port.postMessage({ level: Math.sqrt(sumSquares / output.length) });
      if (this.enabled) this.port.postMessage(output.buffer, [output.buffer]);
    }
    return true;
  }
}

registerProcessor("overtchat-mic-capture", OvertChatMicCapture);
