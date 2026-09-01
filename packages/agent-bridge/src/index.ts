import type {
  AgentConnectionDraft,
  AgentDiscoveryTarget,
  AgentProviderId,
  AgentRuntimeCursor,
  AgentRuntimeEnvelope,
  AgentRuntimeStatus,
  AgentSessionSync,
  AgentSessionCommand,
  AgentSessionLaunchConfig,
  AgentTerminalEvent,
  AgentTerminalSize,
  AgentTerminalSnapshot,
  ConnectorShellMode,
} from "./agents";
import {
  AGENT_TERMINAL_MAX_COLUMNS,
  AGENT_TERMINAL_MAX_INPUT_CHARS,
  AGENT_TERMINAL_MAX_OUTPUT_CHARS,
  AGENT_TERMINAL_MAX_SNAPSHOT_CHARS,
  AGENT_TERMINAL_MIN_COLUMNS,
  AGENT_TERMINAL_MAX_ROWS,
  AGENT_TERMINAL_MIN_ROWS,
  CONNECTOR_SHELL_MODES,
  AGENT_PROVIDER_IDS,
  agentConnectionDraftSchema,
  agentDiscoveryTargetSchema,
  agentSessionCommandSchema,
  agentSessionLaunchConfigSchema,
} from "./agents";

/** Increment only for a breaking web-to-connector wire contract change. */
export const HOST_CONNECTOR_PROTOCOL_VERSION = 3;
/** Published connector artifact version; independent of wire compatibility. */
export const HOST_CONNECTOR_RELEASE_VERSION = "0.9.0";
export const HOST_CONNECTOR_EVENT_BATCH_LIMIT = 256;

export const HOST_CONNECTOR_CAPABILITIES = [
  "session-sync-v1",
  "command-wal-v1",
  "workspace-files-v1",
  "workspace-terminal-v1",
] as const;
export type HostConnectorCapability =
  (typeof HOST_CONNECTOR_CAPABILITIES)[number];

export type HostConnectorServerInfo = {
  protocolVersion: typeof HOST_CONNECTOR_PROTOCOL_VERSION;
  capabilities: string[];
};

export * from "./agents";
export * from "./catalog";
export * from "./commands";
export * from "./state";

export type ConnectorTarget =
  | { transport: "local" }
  | { transport: "ssh"; alias: string };

export type ConnectorSshHost = {
  alias: string;
  hostname: string;
  port: number;
  username: string;
};

export type AgentDaemonTarget = ConnectorTarget & {
  shellMode?: ConnectorShellMode;
};

export type AgentDaemonWorkspaceDescriptor = {
  connectionId: string;
  workspaceId: string;
  provider: AgentProviderId;
  target: AgentDaemonTarget;
  executable: string;
  cwd: string;
  detectedVersion?: string | null;
};

export type AgentDaemonSessionDescriptor = AgentDaemonWorkspaceDescriptor & {
  sessionId: string;
  providerSessionId: string;
  providerSessionPath: string;
  launchConfig: AgentSessionLaunchConfig;
};

export type AgentSessionDirectoryEntry = {
  sessionId: string;
  runtimeStatus: AgentRuntimeStatus;
};

export type AgentDaemonRequest =
  | { type: "list_ssh_hosts" }
  | {
      type: "provider_snapshot";
      target: AgentDiscoveryTarget;
      refresh?: boolean;
    }
  | { type: "probe"; draft: AgentConnectionDraft }
  | {
      type: "list_sessions";
      workspace: AgentDaemonWorkspaceDescriptor;
    }
  | {
      type: "get_catalog";
      workspace: AgentDaemonWorkspaceDescriptor;
    }
  | { type: "list_directories"; target: AgentDaemonTarget; path?: string }
  | { type: "probe_workspace"; target: AgentDaemonTarget; path: string }
  | { type: "git_status"; target: AgentDaemonTarget; path: string }
  | {
      type: "list_workspace_directory";
      target: AgentDaemonTarget;
      root: string;
      path: string;
    }
  | {
      type: "read_workspace_file";
      target: AgentDaemonTarget;
      root: string;
      path: string;
    }
  | {
      type: "subscribe_terminal";
      subscriptionId: string;
      session: AgentDaemonSessionDescriptor;
      size: AgentTerminalSize;
    }
  | { type: "unsubscribe_terminal"; subscriptionId: string }
  | {
      type: "restart_terminal";
      session: AgentDaemonSessionDescriptor;
      size: AgentTerminalSize;
    }
  | { type: "kill_terminal"; sessionId: string }
  | {
      type: "create_session";
      sessionId: string;
      workspace: AgentDaemonWorkspaceDescriptor;
      launchConfig: AgentSessionLaunchConfig;
    }
  | {
      type: "open_session";
      session: AgentDaemonSessionDescriptor;
      after?: AgentRuntimeCursor;
    }
  | {
      type: "session_command";
      commandId: string;
      clientMessageId?: string;
      session: AgentDaemonSessionDescriptor;
      command: AgentSessionCommand;
    }
  | {
      type: "subscribe_session";
      subscriptionId: string;
      session: AgentDaemonSessionDescriptor;
      after?: { epoch: string; sequence: number };
    }
  | { type: "unsubscribe_session"; subscriptionId: string }
  | { type: "stop_session"; sessionId: string }
  | { type: "stop_workspace"; workspaceId: string }
  | { type: "stop_connection"; connectionId: string }
  | { type: "stop_all" };

export type HostConnectorCommand =
  | {
      type: "sync";
      connectionEpoch: string;
      activeSessionIds: string[];
      serverInfo?: HostConnectorServerInfo;
    }
  | {
      type: "request";
      requestId: string;
      request: AgentDaemonRequest;
    }
  | { type: "terminal_input"; sessionId: string; data: string }
  | {
      type: "terminal_resize";
      sessionId: string;
      size: AgentTerminalSize;
    };

export type HostConnectorEventPayload =
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
      type: "session_event";
      subscriptionId: string;
      sessionId: string;
      envelope: AgentRuntimeEnvelope;
    }
  | {
      type: "session_metadata";
      sessionId: string;
      patch: {
        name?: string | null;
        firstMessage?: string | null;
        messageCount?: number;
        providerModifiedAt?: number;
        launchConfig?: AgentSessionLaunchConfig;
      };
    }
  | {
      type: "terminal_event";
      subscriptionId: string;
      sessionId: string;
      event: AgentTerminalEvent;
    }
  | { type: "session_directory"; sessions: AgentSessionDirectoryEntry[] }
  | { type: "session_update"; session: AgentSessionDirectoryEntry };

export type HostConnectorEvent = {
  sequence: number;
  payload: HostConnectorEventPayload;
};

export type HostConnectorEventBatch = {
  protocolVersion: typeof HOST_CONNECTOR_PROTOCOL_VERSION;
  connectorEpoch: string;
  events: HostConnectorEvent[];
};

export type HostConnectorEventAck = {
  connectorEpoch: string;
  acknowledgedSequence: number;
};

export function parseHostConnectorCapabilities(
  value: string | null | undefined,
): HostConnectorCapability[] {
  if (!value) return [];
  const known = new Set<string>(HOST_CONNECTOR_CAPABILITIES);
  return [...new Set(value.split(",").map((item) => item.trim()))].filter(
    (item): item is HostConnectorCapability => known.has(item),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return (
    normalized === "localhost" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalized)
  );
}

export function normalizeHostConnectorServerUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("OvertChat URL must use HTTP or HTTPS.");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("Non-local OvertChat URLs must use HTTPS.");
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/u, "");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isConnectorTarget(value: unknown): value is ConnectorTarget {
  if (!isRecord(value)) return false;
  return (
    value.transport === "local" ||
    (value.transport === "ssh" && isNonEmptyString(value.alias))
  );
}

export function isHostConnectorProtocolVersion(
  value: unknown,
): value is number {
  return value === HOST_CONNECTOR_PROTOCOL_VERSION;
}

function isAgentDaemonTarget(value: unknown): value is AgentDaemonTarget {
  return (
    isRecord(value) &&
    isConnectorTarget(value) &&
    (Reflect.get(value, "shellMode") === undefined ||
      (typeof Reflect.get(value, "shellMode") === "string" &&
        CONNECTOR_SHELL_MODES.includes(
          Reflect.get(value, "shellMode") as ConnectorShellMode,
        )))
  );
}

export function isAgentTerminalSize(
  value: unknown,
): value is AgentTerminalSize {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.cols) &&
    Number(value.cols) >= AGENT_TERMINAL_MIN_COLUMNS &&
    Number(value.cols) <= AGENT_TERMINAL_MAX_COLUMNS &&
    Number.isSafeInteger(value.rows) &&
    Number(value.rows) >= AGENT_TERMINAL_MIN_ROWS &&
    Number(value.rows) <= AGENT_TERMINAL_MAX_ROWS
  );
}

export function isAgentTerminalSnapshot(
  value: unknown,
): value is AgentTerminalSnapshot {
  if (!isRecord(value) || !isAgentTerminalSize(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    isNonEmptyString(snapshot.sessionId) &&
    Number.isSafeInteger(snapshot.revision) &&
    Number(snapshot.revision) >= 0 &&
    typeof snapshot.data === "string" &&
    snapshot.data.length <= AGENT_TERMINAL_MAX_SNAPSHOT_CHARS &&
    typeof snapshot.exited === "boolean" &&
    (snapshot.exitCode === null || Number.isSafeInteger(snapshot.exitCode)) &&
    (snapshot.signal === null || Number.isSafeInteger(snapshot.signal))
  );
}

export function isAgentDaemonWorkspaceDescriptor(
  value: unknown,
): value is AgentDaemonWorkspaceDescriptor {
  return (
    isRecord(value) &&
    isNonEmptyString(value.connectionId) &&
    isNonEmptyString(value.workspaceId) &&
    (AGENT_PROVIDER_IDS as readonly unknown[]).includes(value.provider) &&
    isAgentDaemonTarget(value.target) &&
    isNonEmptyString(value.executable) &&
    typeof value.cwd === "string" &&
    (value.detectedVersion === undefined ||
      value.detectedVersion === null ||
      typeof value.detectedVersion === "string")
  );
}

export function isAgentDaemonSessionDescriptor(
  value: unknown,
): value is AgentDaemonSessionDescriptor {
  return (
    isRecord(value) &&
    isAgentDaemonWorkspaceDescriptor(value) &&
    isNonEmptyString(Reflect.get(value, "sessionId")) &&
    isNonEmptyString(Reflect.get(value, "providerSessionId")) &&
    isNonEmptyString(Reflect.get(value, "providerSessionPath")) &&
    agentSessionLaunchConfigSchema.safeParse(
      Reflect.get(value, "launchConfig"),
    ).success
  );
}

function isAgentDaemonRequest(value: unknown): value is AgentDaemonRequest {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "list_ssh_hosts":
      return true;
    case "provider_snapshot":
      return (
        agentDiscoveryTargetSchema.safeParse(value.target).success &&
        (value.refresh === undefined || typeof value.refresh === "boolean")
      );
    case "probe":
      return agentConnectionDraftSchema.safeParse(value.draft).success;
    case "list_sessions":
      return isAgentDaemonWorkspaceDescriptor(value.workspace);
    case "get_catalog":
      return isAgentDaemonWorkspaceDescriptor(value.workspace);
    case "list_directories":
      return (
        isAgentDaemonTarget(value.target) &&
        (value.path === undefined || typeof value.path === "string")
      );
    case "probe_workspace":
      return isAgentDaemonTarget(value.target) && typeof value.path === "string";
    case "git_status":
      return isAgentDaemonTarget(value.target) && typeof value.path === "string";
    case "list_workspace_directory":
    case "read_workspace_file":
      return (
        isAgentDaemonTarget(value.target) &&
        typeof value.root === "string" &&
        value.root.length > 0 &&
        typeof value.path === "string"
      );
    case "subscribe_terminal":
      return (
        isNonEmptyString(value.subscriptionId) &&
        isAgentDaemonSessionDescriptor(value.session) &&
        isAgentTerminalSize(value.size)
      );
    case "unsubscribe_terminal":
      return isNonEmptyString(value.subscriptionId);
    case "restart_terminal":
      return (
        isAgentDaemonSessionDescriptor(value.session) &&
        isAgentTerminalSize(value.size)
      );
    case "kill_terminal":
      return isNonEmptyString(value.sessionId);
    case "create_session":
      return (
        isNonEmptyString(value.sessionId) &&
        isAgentDaemonWorkspaceDescriptor(value.workspace) &&
        agentSessionLaunchConfigSchema.safeParse(value.launchConfig).success
      );
    case "open_session":
      return (
        isAgentDaemonSessionDescriptor(value.session) &&
        (value.after === undefined || isAgentRuntimeCursor(value.after))
      );
    case "session_command":
      return (
        isNonEmptyString(value.commandId) &&
        (value.clientMessageId === undefined ||
          isNonEmptyString(value.clientMessageId)) &&
        isAgentDaemonSessionDescriptor(value.session) &&
        agentSessionCommandSchema.safeParse(value.command).success
      );
    case "subscribe_session":
      return (
        isNonEmptyString(value.subscriptionId) &&
        isAgentDaemonSessionDescriptor(value.session) &&
        (value.after === undefined || isAgentRuntimeCursor(value.after))
      );
    case "unsubscribe_session":
      return isNonEmptyString(value.subscriptionId);
    case "stop_session":
      return isNonEmptyString(value.sessionId);
    case "stop_workspace":
      return isNonEmptyString(value.workspaceId);
    case "stop_connection":
      return isNonEmptyString(value.connectionId);
    case "stop_all":
      return true;
    default:
      return false;
  }
}

export function isHostConnectorCommand(
  value: unknown,
): value is HostConnectorCommand {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "sync":
      return (
        isNonEmptyString(value.connectionEpoch) &&
        Array.isArray(value.activeSessionIds) &&
        value.activeSessionIds.every(isNonEmptyString) &&
        (value.serverInfo === undefined ||
          (isRecord(value.serverInfo) &&
            value.serverInfo.protocolVersion ===
              HOST_CONNECTOR_PROTOCOL_VERSION &&
            Array.isArray(value.serverInfo.capabilities) &&
            value.serverInfo.capabilities.every(
              (capability) => typeof capability === "string",
            )))
      );
    case "request":
      return (
        isNonEmptyString(value.requestId) &&
        isAgentDaemonRequest(value.request)
      );
    case "terminal_input":
      return (
        isNonEmptyString(value.sessionId) &&
        typeof value.data === "string" &&
        value.data.length > 0 &&
        value.data.length <= AGENT_TERMINAL_MAX_INPUT_CHARS
      );
    case "terminal_resize":
      return (
        isNonEmptyString(value.sessionId) && isAgentTerminalSize(value.size)
      );
    default:
      return false;
  }
}

export function isAgentRuntimeCursor(
  value: unknown,
): value is AgentRuntimeCursor {
  return (
    isRecord(value) &&
    isNonEmptyString(value.epoch) &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) >= 0
  );
}

export function isAgentRuntimeEnvelope(
  value: unknown,
): value is AgentRuntimeEnvelope {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.epoch) ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    !["snapshot", "runtime_event"].includes(String(value.type)) ||
    !isRecord(value.data)
  ) {
    return false;
  }
  return value.type === "snapshot"
    ? isNonEmptyString(value.data.sessionId) &&
        ["idle", "running", "exited"].includes(String(value.data.status))
    : isNonEmptyString(value.data.type);
}

export function isAgentSessionDirectoryEntry(
  value: unknown,
): value is AgentSessionDirectoryEntry {
  return (
    isRecord(value) &&
    isNonEmptyString(value.sessionId) &&
    ["idle", "running", "exited"].includes(String(value.runtimeStatus))
  );
}

export function isAgentSessionSync(value: unknown): value is AgentSessionSync {
  if (
    !isRecord(value) ||
    typeof value.reset !== "boolean" ||
    !isAgentRuntimeCursor(value.cursor)
  ) {
    return false;
  }
  if (value.reset) {
    return (
      isRecord(value.snapshot) &&
      isNonEmptyString(value.snapshot.sessionId) &&
      ["idle", "running", "exited"].includes(String(value.snapshot.status))
    );
  }
  const cursor = value.cursor;
  const events = value.events;
  if (
    !Array.isArray(events) ||
    !events.every(isAgentRuntimeEnvelope) ||
    events.some((event) => event.epoch !== cursor.epoch)
  ) {
    return false;
  }
  return (
    events.every(
      (event, index) =>
        event.sequence <= cursor.sequence &&
        (index === 0 ||
          event.sequence === events[index - 1]!.sequence + 1),
    ) &&
    (events.at(-1)?.sequence ?? cursor.sequence) === cursor.sequence
  );
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
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    !isRecord(value.payload) ||
    typeof value.payload.type !== "string"
  ) {
    return false;
  }
  const payload = value.payload;
  if (payload.type === "response") {
    return (
      isNonEmptyString(payload.requestId) &&
      ((payload.success === true && "data" in payload) ||
        (payload.success === false && typeof payload.error === "string"))
    );
  }
  if (payload.type === "session_event") {
    return (
      isNonEmptyString(payload.subscriptionId) &&
      isNonEmptyString(payload.sessionId) &&
      isAgentRuntimeEnvelope(payload.envelope) &&
      (payload.envelope.type !== "snapshot" ||
        payload.envelope.data.sessionId === payload.sessionId)
    );
  }
  if (payload.type === "terminal_event") {
    if (
      !isNonEmptyString(payload.subscriptionId) ||
      !isNonEmptyString(payload.sessionId) ||
      !isRecord(payload.event) ||
      !Number.isSafeInteger(payload.event.revision) ||
      Number(payload.event.revision) < 1
    ) {
      return false;
    }
    if (payload.event.type === "output") {
      return (
        typeof payload.event.data === "string" &&
        payload.event.data.length > 0 &&
        payload.event.data.length <= AGENT_TERMINAL_MAX_OUTPUT_CHARS
      );
    }
    return (
      payload.event.type === "exit" &&
      (payload.event.exitCode === null ||
        Number.isSafeInteger(payload.event.exitCode)) &&
      (payload.event.signal === null ||
        Number.isSafeInteger(payload.event.signal))
    );
  }
  if (payload.type === "session_metadata") {
    if (!isNonEmptyString(payload.sessionId) || !isRecord(payload.patch)) {
      return false;
    }
    const allowed = new Set([
      "name",
      "firstMessage",
      "messageCount",
      "providerModifiedAt",
      "launchConfig",
    ]);
    return (
      Object.keys(payload.patch).every((key) => allowed.has(key)) &&
      (payload.patch.name === undefined ||
        payload.patch.name === null ||
        typeof payload.patch.name === "string") &&
      (payload.patch.firstMessage === undefined ||
        payload.patch.firstMessage === null ||
        typeof payload.patch.firstMessage === "string") &&
      (payload.patch.messageCount === undefined ||
        (Number.isSafeInteger(payload.patch.messageCount) &&
          Number(payload.patch.messageCount) >= 0)) &&
      (payload.patch.providerModifiedAt === undefined ||
        (typeof payload.patch.providerModifiedAt === "number" &&
          Number.isFinite(payload.patch.providerModifiedAt))) &&
      (payload.patch.launchConfig === undefined ||
        agentSessionLaunchConfigSchema.safeParse(payload.patch.launchConfig).success)
    );
  }
  if (payload.type === "session_directory") {
    return (
      Array.isArray(payload.sessions) &&
      payload.sessions.every(isAgentSessionDirectoryEntry) &&
      new Set(payload.sessions.map((session) => session.sessionId)).size ===
        payload.sessions.length
    );
  }
  if (payload.type === "session_update") {
    return isAgentSessionDirectoryEntry(payload.session);
  }
  return false;
}
