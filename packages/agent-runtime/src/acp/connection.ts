import { Readable, Transform, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type InitializeResponse,
} from "@agentclientprotocol/sdk";
import {
  spawnManagedOnHost,
  terminateAgentProcess,
  type AgentProcess,
  type AgentProcessLaunch,
  type HostTarget,
} from "../runtime/process";

const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** SDK request failures may be JSON-RPC error records rather than Errors. */
export function acpError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === "object" && "message" in error) {
    const data = "data" in error ? error.data : undefined;
    const details =
      data && typeof data === "object" && "details" in data
        ? data.details
        : undefined;
    return new Error(
      `${String(error.message)}${typeof details === "string" ? `: ${details}` : ""}`,
    );
  }
  return new Error(String(error));
}

/** SDK owns JSON-RPC framing/validation; this guard bounds its input buffer. */
function boundedOutput(): Transform {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      for (const byte of chunk) {
        bytes = byte === 10 ? 0 : bytes + 1;
        if (bytes > MAX_FRAME_BYTES) {
          callback(new Error("ACP output exceeded the maximum message size."));
          return;
        }
      }
      callback(null, chunk);
    },
  });
}

export class AcpConnection {
  readonly rpc: ClientSideConnection;
  private stderr = "";
  private stopping?: Promise<void>;
  private readonly fail: (error: Error) => void;

  private constructor(
    private readonly process: AgentProcess,
    readonly label: string,
    client: Client,
    onExit: (error: Error) => void,
  ) {
    const output = boundedOutput();
    process.stdout.pipe(output);
    process.stdout.on("error", (error) => output.destroy(error));
    process.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-16_384);
    });
    this.rpc = new ClientSideConnection(
      () => client,
      ndJsonStream(
        Writable.toWeb(process.stdin),
        Readable.toWeb(output) as ReadableStream<Uint8Array>,
      ),
    );
    let exited = false;
    const fail = (this.fail = (error: Error) => {
      if (exited || this.stopping) return;
      exited = true;
      onExit(error);
      void this.stop().catch(() => {});
    });
    output.on("error", fail);
    void process.exit.then((exit) =>
      fail(
        new Error(
          exit.error?.message ||
            this.stderr.trim() ||
            `${label} exited (code ${exit.code ?? "unknown"}).`,
        ),
      ),
    );
    void this.rpc.closed.then(() =>
      fail(new Error(this.stderr.trim() || `${label} ACP connection closed.`)),
    );
  }

  static async start(
    target: HostTarget,
    launch: AgentProcessLaunch,
    label: string,
    client: Client,
    onExit: (error: Error) => void,
  ): Promise<AcpConnection> {
    return new AcpConnection(
      await spawnManagedOnHost(target, launch),
      label,
      client,
      onExit,
    );
  }

  async initialize(): Promise<InitializeResponse> {
    const response = await this.request(
      this.rpc.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: "overtchat", version: "1" },
        // Hermes owns file and terminal execution on the target host.
        clientCapabilities: {},
      }),
      "initialize",
    );
    if (response.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(
        `${this.label} uses unsupported ACP protocol ${response.protocolVersion}.`,
      );
    }
    return response;
  }

  async request<T>(
    operation: Promise<T>,
    name: string,
    timeoutMs = 60_000,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(
              `${this.label} ${name} timed out.${this.stderr.trim() ? ` ${this.stderr.trim()}` : ""}`,
            );
            reject(error);
            this.fail(error);
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      throw acpError(error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  stop(): Promise<void> {
    if (!this.stopping) {
      this.process.stdin.end();
      this.stopping = terminateAgentProcess(this.process);
    }
    return this.stopping;
  }
}
