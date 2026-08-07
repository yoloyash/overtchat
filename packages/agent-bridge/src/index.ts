export const HOST_CONNECTOR_PROTOCOL_VERSION = 1;

export type ConnectorTarget =
  | { transport: "local" }
  | { transport: "ssh"; alias: string };

export type ConnectorProcessLaunch = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export type ConnectorSshHost = {
  alias: string;
  hostname: string;
  port: number;
  username: string;
};

export type HostConnectorCommand =
  | {
      type: "sync";
      processIds: string[];
    }
  | {
      type: "spawn";
      processId: string;
      target: ConnectorTarget;
      launch: ConnectorProcessLaunch;
    }
  | {
      type: "stdin";
      processId: string;
      data: string;
    }
  | {
      type: "stdin_end";
      processId: string;
    }
  | {
      type: "kill";
      processId: string;
      signal: NodeJS.Signals;
    }
  | {
      type: "request";
      requestId: string;
      request: { type: "list_ssh_hosts" };
    };

export type HostConnectorEvent =
  | {
      type: "response";
      requestId: string;
      success: true;
      data: unknown;
    }
  | {
      type: "response";
      requestId: string;
      success: false;
      error: string;
    }
  | {
      type: "stdout" | "stderr";
      processId: string;
      data: string;
    }
  | {
      type: "exit";
      processId: string;
      code: number | null;
      signal: NodeJS.Signals | null;
      error?: string;
    };

export type HostConnectorEventBatch = {
  protocolVersion: number;
  events: HostConnectorEvent[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function isConnectorSshHost(value: unknown): value is ConnectorSshHost {
  if (!isRecord(value)) return false;
  return (
    typeof value.alias === "string" &&
    typeof value.hostname === "string" &&
    typeof value.username === "string" &&
    typeof value.port === "number" &&
    Number.isInteger(value.port) &&
    value.port >= 1 &&
    value.port <= 65_535
  );
}

export function isHostConnectorEvent(
  value: unknown,
): value is HostConnectorEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "response") {
    return (
      typeof value.requestId === "string" &&
      ((value.success === true && "data" in value) ||
        (value.success === false && typeof value.error === "string"))
    );
  }
  if (
    typeof value.processId !== "string" ||
    value.processId.length === 0
  ) {
    return false;
  }
  if (value.type === "stdout" || value.type === "stderr") {
    return typeof value.data === "string";
  }
  if (value.type === "exit") {
    return (
      (value.code === null || typeof value.code === "number") &&
      (value.signal === null || typeof value.signal === "string") &&
      (value.error === undefined || typeof value.error === "string")
    );
  }
  return false;
}
