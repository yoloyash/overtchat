import { StringDecoder } from "node:string_decoder";

export function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export class JsonlDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";

  push(chunk: Buffer | string): string[] {
    this.buffer +=
      typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    return this.takeLines();
  }

  end(): string[] {
    this.buffer += this.decoder.end();
    const lines = this.takeLines();
    if (this.buffer.length > 0) {
      lines.push(this.stripCarriageReturn(this.buffer));
      this.buffer = "";
    }
    return lines;
  }

  private takeLines(): string[] {
    const lines: string[] = [];
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) return lines;
      lines.push(this.stripCarriageReturn(this.buffer.slice(0, newline)));
      this.buffer = this.buffer.slice(newline + 1);
    }
  }

  private stripCarriageReturn(line: string): string {
    return line.endsWith("\r") ? line.slice(0, -1) : line;
  }
}
