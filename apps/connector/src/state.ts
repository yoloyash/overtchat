import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  HOST_CONNECTOR_EVENT_BATCH_LIMIT,
  agentPromptImageSchema,
  isAgentDaemonSessionDescriptor,
  isHostConnectorEvent,
  type AgentDaemonSessionDescriptor,
  type AgentQueuedMessage,
  type HostConnectorEvent,
  type HostConnectorEventAck,
  type HostConnectorEventPayload,
} from "@overtchat/agent-bridge";

export type CachedCommandResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

type SessionState = {
  descriptor: AgentDaemonSessionDescriptor;
  queuedMessages: AgentQueuedMessage[];
};

type ConnectorState = {
  format: 1;
  connectorEpoch: string;
  nextEventSequence: number;
  acknowledgedSequence: number;
  events: HostConnectorEvent[];
  commandResults: Array<[string, CachedCommandResult]>;
  sessions: Record<string, SessionState>;
};

const COMMAND_RESULT_LIMIT = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isQueuedMessage(value: unknown): value is AgentQueuedMessage {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.message === "string" &&
    (value.status === "pending" || value.status === "sending") &&
    (value.images === undefined ||
      (Array.isArray(value.images) &&
        value.images.every((image) => agentPromptImageSchema.safeParse(image).success)))
  );
}

function isCommandResult(value: unknown): value is CachedCommandResult {
  return (
    isRecord(value) &&
    ((value.success === true && "data" in value) ||
      (value.success === false && typeof value.error === "string"))
  );
}

function parseState(value: unknown): ConnectorState {
  if (
    !isRecord(value) ||
    value.format !== 1 ||
    typeof value.connectorEpoch !== "string" ||
    !value.connectorEpoch ||
    !Number.isSafeInteger(value.nextEventSequence) ||
    Number(value.nextEventSequence) < 0 ||
    !Number.isSafeInteger(value.acknowledgedSequence) ||
    Number(value.acknowledgedSequence) < 0 ||
    !Array.isArray(value.events) ||
    !value.events.every(isHostConnectorEvent) ||
    !Array.isArray(value.commandResults) ||
    !isRecord(value.sessions)
  ) {
    throw new Error("Invalid Host Connector state journal.");
  }
  const commandResults: Array<[string, CachedCommandResult]> = [];
  for (const entry of value.commandResults) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      !entry[0] ||
      !isCommandResult(entry[1])
    ) {
      throw new Error("Invalid Host Connector command journal.");
    }
    commandResults.push([entry[0], entry[1]]);
  }
  const sessions: Record<string, SessionState> = {};
  for (const [sessionId, session] of Object.entries(value.sessions)) {
    if (
      !isRecord(session) ||
      !isAgentDaemonSessionDescriptor(session.descriptor) ||
      session.descriptor.sessionId !== sessionId ||
      !Array.isArray(session.queuedMessages) ||
      !session.queuedMessages.every(isQueuedMessage)
    ) {
      throw new Error("Invalid Host Connector session journal.");
    }
    sessions[sessionId] = {
      descriptor: session.descriptor,
      queuedMessages: session.queuedMessages,
    };
  }
  const events = value.events as HostConnectorEvent[];
  const nextEventSequence = Number(value.nextEventSequence);
  const acknowledgedSequence = Number(value.acknowledgedSequence);
  if (
    acknowledgedSequence > nextEventSequence ||
    events.some(
      (event, index) =>
        event.sequence <= acknowledgedSequence ||
        (index > 0 && event.sequence !== events[index - 1]!.sequence + 1),
    ) ||
    (events.at(-1)?.sequence ?? acknowledgedSequence) !== nextEventSequence
  ) {
    throw new Error("Invalid Host Connector event journal.");
  }
  return {
    format: 1,
    connectorEpoch: value.connectorEpoch,
    nextEventSequence,
    acknowledgedSequence,
    events,
    commandResults: commandResults.slice(-COMMAND_RESULT_LIMIT),
    sessions,
  };
}

function initialState(): ConnectorState {
  return {
    format: 1,
    connectorEpoch: crypto.randomUUID(),
    nextEventSequence: 0,
    acknowledgedSequence: 0,
    events: [],
    commandResults: [],
    sessions: {},
  };
}

export class ConnectorStateJournal {
  private writeTail = Promise.resolve();
  private saveTimer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly file: string,
    private readonly state: ConnectorState,
  ) {}

  static async open(file: string): Promise<ConnectorStateJournal> {
    let state: ConnectorState;
    try {
      state = parseState(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = initialState();
    }
    return new ConnectorStateJournal(file, state);
  }

  get connectorEpoch(): string {
    return this.state.connectorEpoch;
  }

  enqueue(payload: HostConnectorEventPayload): HostConnectorEvent {
    const event = {
      sequence: ++this.state.nextEventSequence,
      payload,
    };
    this.state.events.push(event);
    this.scheduleSave();
    return event;
  }

  eventBatch(): HostConnectorEvent[] {
    return this.state.events.slice(0, HOST_CONNECTOR_EVENT_BATCH_LIMIT);
  }

  async acknowledge(ack: HostConnectorEventAck): Promise<void> {
    if (ack.connectorEpoch !== this.state.connectorEpoch) {
      throw new Error("OvertChat acknowledged a different connector epoch.");
    }
    if (
      !Number.isSafeInteger(ack.acknowledgedSequence) ||
      ack.acknowledgedSequence < this.state.acknowledgedSequence ||
      ack.acknowledgedSequence > this.state.nextEventSequence
    ) {
      throw new Error("OvertChat returned an invalid connector acknowledgement.");
    }
    this.state.acknowledgedSequence = ack.acknowledgedSequence;
    this.state.events = this.state.events.filter(
      (event) => event.sequence > ack.acknowledgedSequence,
    );
    await this.save();
  }

  commandResult(commandId: string): CachedCommandResult | undefined {
    return new Map(this.state.commandResults).get(commandId);
  }

  async recordCommandResult(
    commandId: string,
    result: CachedCommandResult,
  ): Promise<void> {
    const existing = this.state.commandResults.findIndex(
      ([storedId]) => storedId === commandId,
    );
    if (existing >= 0) this.state.commandResults.splice(existing, 1);
    this.state.commandResults.push([commandId, result]);
    if (this.state.commandResults.length > COMMAND_RESULT_LIMIT) {
      this.state.commandResults.splice(
        0,
        this.state.commandResults.length - COMMAND_RESULT_LIMIT,
      );
    }
    await this.save();
  }

  sessionQueue(sessionId: string): readonly AgentQueuedMessage[] {
    return this.state.sessions[sessionId]?.queuedMessages ?? [];
  }

  sessionIds(): string[] {
    return Object.keys(this.state.sessions);
  }

  async retainSessions(sessionIds: ReadonlySet<string>): Promise<void> {
    this.deleteMatchingSessions(
      (session) => !sessionIds.has(session.descriptor.sessionId),
    );
    await this.save();
  }

  async recordSession(descriptor: AgentDaemonSessionDescriptor): Promise<void> {
    const current = this.state.sessions[descriptor.sessionId];
    this.state.sessions[descriptor.sessionId] = {
      descriptor,
      queuedMessages: current?.queuedMessages ?? [],
    };
    await this.save();
  }

  async saveSessionQueue(
    sessionId: string,
    messages: readonly AgentQueuedMessage[],
  ): Promise<void> {
    const current = this.state.sessions[sessionId];
    if (!current) return;
    current.queuedMessages = messages.map((message) => ({
      ...message,
      ...(message.images ? { images: [...message.images] } : {}),
    }));
    await this.save();
  }

  async deleteSession(sessionId: string): Promise<void> {
    delete this.state.sessions[sessionId];
    await this.save();
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.deleteMatchingSessions(
      (session) => session.descriptor.workspaceId === workspaceId,
    );
    await this.save();
  }

  async deleteConnection(connectionId: string): Promise<void> {
    this.deleteMatchingSessions(
      (session) => session.descriptor.connectionId === connectionId,
    );
    await this.save();
  }

  async deleteAllSessions(): Promise<void> {
    this.state.sessions = {};
    await this.save();
  }

  async close(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    await this.save();
    await this.writeTail;
  }

  private deleteMatchingSessions(
    predicate: (session: SessionState) => boolean,
  ): void {
    for (const [sessionId, session] of Object.entries(this.state.sessions)) {
      if (predicate(session)) delete this.state.sessions[sessionId];
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.save().catch((error) => {
        console.error(
          `Unable to write Host Connector state: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }, 25);
    this.saveTimer.unref();
  }

  private save(): Promise<void> {
    const serialized = `${JSON.stringify(this.state)}\n`;
    const operation = this.writeTail.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, serialized, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, this.file);
      await chmod(this.file, 0o600);
    });
    this.writeTail = operation.catch(() => {});
    return operation;
  }
}
