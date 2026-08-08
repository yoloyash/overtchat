export const HOST_CONNECTOR_PROTOCOL_MIN_VERSION = 2;
export const HOST_CONNECTOR_PROTOCOL_VERSION = 2;

export const CONNECTOR_SHELL_MODES = ["interactive", "login"] as const;
export type ConnectorShellMode = (typeof CONNECTOR_SHELL_MODES)[number];

export type ConnectorTarget =
  | { transport: "local" }
  | { transport: "ssh"; alias: string };

export type ConnectorProcessLaunch = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  shellMode: ConnectorShellMode;
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
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) && typeof item === "string",
    )
  );
}

const CONNECTOR_SIGNALS = new Set<NodeJS.Signals>([
  "SIGABRT",
  "SIGALRM",
  "SIGBUS",
  "SIGCHLD",
  "SIGCONT",
  "SIGFPE",
  "SIGHUP",
  "SIGILL",
  "SIGINT",
  "SIGIO",
  "SIGIOT",
  "SIGKILL",
  "SIGPIPE",
  "SIGPOLL",
  "SIGPROF",
  "SIGPWR",
  "SIGQUIT",
  "SIGSEGV",
  "SIGSTKFLT",
  "SIGSTOP",
  "SIGSYS",
  "SIGTERM",
  "SIGTRAP",
  "SIGTSTP",
  "SIGTTIN",
  "SIGTTOU",
  "SIGURG",
  "SIGUSR1",
  "SIGUSR2",
  "SIGVTALRM",
  "SIGWINCH",
  "SIGXCPU",
  "SIGXFSZ",
]);

function isConnectorTarget(value: unknown): value is ConnectorTarget {
  if (!isRecord(value)) return false;
  return (
    value.transport === "local" ||
    (value.transport === "ssh" && isNonEmptyString(value.alias))
  );
}

function isConnectorProcessLaunch(
  value: unknown,
): value is ConnectorProcessLaunch {
  if (!isRecord(value) || !isNonEmptyString(value.command)) return false;
  return (
    (value.args === undefined || isStringArray(value.args)) &&
    (value.cwd === undefined || typeof value.cwd === "string") &&
    (value.env === undefined || isStringRecord(value.env)) &&
    typeof value.shellMode === "string" &&
    CONNECTOR_SHELL_MODES.includes(value.shellMode as ConnectorShellMode)
  );
}

export function isHostConnectorProtocolVersion(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= HOST_CONNECTOR_PROTOCOL_MIN_VERSION &&
    value <= HOST_CONNECTOR_PROTOCOL_VERSION
  );
}

export function isHostConnectorCommand(
  value: unknown,
): value is HostConnectorCommand {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "sync":
      return isStringArray(value.processIds);
    case "spawn":
      return (
        isNonEmptyString(value.processId) &&
        isConnectorTarget(value.target) &&
        isConnectorProcessLaunch(value.launch)
      );
    case "stdin":
      return (
        isNonEmptyString(value.processId) && typeof value.data === "string"
      );
    case "stdin_end":
      return isNonEmptyString(value.processId);
    case "kill":
      return (
        isNonEmptyString(value.processId) &&
        typeof value.signal === "string" &&
        CONNECTOR_SIGNALS.has(value.signal as NodeJS.Signals)
      );
    case "request":
      return (
        isNonEmptyString(value.requestId) &&
        isRecord(value.request) &&
        value.request.type === "list_ssh_hosts"
      );
    default:
      return false;
  }
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
