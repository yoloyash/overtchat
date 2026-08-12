import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
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

export type CommandJournalEntry =
  | {
      commandId: string;
      sessionId: string;
      fingerprint: string;
      status: "pending";
    }
  | {
      commandId: string;
      sessionId: string | null;
      fingerprint: string | null;
      status: "completed";
      result: CachedCommandResult;
    };

export type BeginCommandResult =
  | { status: "execute" }
  | { status: "pending" }
  | { status: "completed"; result: CachedCommandResult };

type SessionState = {
  descriptor: AgentDaemonSessionDescriptor;
  queuedMessages: AgentQueuedMessage[];
};

type ConnectorState = {
  format: 2;
  connectorEpoch: string;
  nextEventSequence: number;
  acknowledgedSequence: number;
  events: HostConnectorEvent[];
  commands: CommandJournalEntry[];
  sessions: Record<string, SessionState>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isQueuedMessage(value: unknown): value is AgentQueuedMessage {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.message === "string" &&
    (value.status === "pending" ||
      value.status === "sending" ||
      value.status === "uncertain") &&
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

function stableCommandResult(result: CachedCommandResult): CachedCommandResult {
  if (!result.success) return { success: false, error: result.error };
  if (!isRecord(result.data)) return { success: true, data: result.data };
  // Queue state is a mutable projection and is already persisted in the
  // session journal/timeline. Replaying old snapshots from the command ledger
  // can resurrect drained messages and made v0.2 journals grow quadratically.
  const stable = { ...result.data };
  delete stable.snapshot;
  return { success: true, data: stable };
}

function isCommandIdentity(
  commandId: string,
  sessionId: string,
  fingerprint: string,
): boolean {
  return (
    commandId.length > 0 &&
    sessionId.length > 0 &&
    /^[a-f0-9]{64}$/u.test(fingerprint)
  );
}

function isCommandEntry(value: unknown): value is CommandJournalEntry {
  if (
    !isRecord(value) ||
    typeof value.commandId !== "string" ||
    !value.commandId
  ) {
    return false;
  }
  if (value.status === "pending") {
    return (
      typeof value.sessionId === "string" &&
      value.sessionId.length > 0 &&
      typeof value.fingerprint === "string" &&
      /^[a-f0-9]{64}$/u.test(value.fingerprint)
    );
  }
  return (
    value.status === "completed" &&
    (value.sessionId === null ||
      (typeof value.sessionId === "string" && value.sessionId.length > 0)) &&
    (value.fingerprint === null ||
      (typeof value.fingerprint === "string" &&
        /^[a-f0-9]{64}$/u.test(value.fingerprint))) &&
    ((value.sessionId === null && value.fingerprint === null) ||
      (typeof value.sessionId === "string" &&
        typeof value.fingerprint === "string")) &&
    isCommandResult(value.result)
  );
}

type JsonArrayRange = { start: number; end: number };

function scanJsonArray(
  raw: string,
  key: string,
  after: number,
  visit: (element: string) => void,
): JsonArrayRange {
  const marker = new RegExp(`"${key}"\\s*:\\s*\\[`, "gu");
  marker.lastIndex = after;
  const match = marker.exec(raw);
  if (!match) throw new Error(`Invalid Host Connector ${key} journal.`);
  const start = match.index + match[0].lastIndexOf("[");
  let elementStart = start + 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start + 1; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      continue;
    }
    if (character === "}" || character === "]") {
      if (character === "]" && depth === 0) {
        const element = raw.slice(elementStart, index).trim();
        if (element) {
          visit(element);
        } else if (elementStart !== start + 1) {
          throw new Error(`Invalid Host Connector ${key} journal.`);
        }
        return { start, end: index };
      }
      depth -= 1;
      if (depth < 0) break;
      continue;
    }
    if (character === "," && depth === 0) {
      const element = raw.slice(elementStart, index).trim();
      if (!element) throw new Error(`Invalid Host Connector ${key} journal.`);
      visit(element);
      elementStart = index + 1;
    }
  }
  throw new Error(`Invalid Host Connector ${key} journal.`);
}

/**
 * v0.2 persisted every token-shaped session event in the general transport
 * outbox. Real installations reached hundreds of megabytes, so parsing the
 * whole JSON into objects during upgrade can exhaust memory. Scan the two
 * legacy arrays element-by-element, discard session events, and strip mutable
 * snapshots before parsing the much smaller reconstructed document.
 */
function compactLegacyState(raw: string): string {
  const events: HostConnectorEvent[] = [];
  const eventsRange = scanJsonArray(raw, "events", 0, (element) => {
    const event: unknown = JSON.parse(element);
    if (!isHostConnectorEvent(event)) {
      throw new Error("Invalid Host Connector event journal.");
    }
    if (event.payload.type === "session_event") return;
    events.push({ sequence: events.length + 1, payload: event.payload });
  });
  const commandResults: Array<[string, CachedCommandResult]> = [];
  const commandResultsRange = scanJsonArray(
    raw,
    "commandResults",
    eventsRange.end,
    (element) => {
      const entry: unknown = JSON.parse(element);
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        !entry[0] ||
        !isCommandResult(entry[1])
      ) {
        throw new Error("Invalid Host Connector command journal.");
      }
      commandResults.push([entry[0], stableCommandResult(entry[1])]);
    },
  );
  return [
    raw.slice(0, eventsRange.start),
    JSON.stringify(events),
    raw.slice(eventsRange.end + 1, commandResultsRange.start),
    JSON.stringify(commandResults),
    raw.slice(commandResultsRange.end + 1),
  ].join("");
}

function parseState(value: unknown): ConnectorState {
  if (
    !isRecord(value) ||
    value.format !== 2 ||
    typeof value.connectorEpoch !== "string" ||
    !value.connectorEpoch ||
    !Number.isSafeInteger(value.nextEventSequence) ||
    Number(value.nextEventSequence) < 0 ||
    !Number.isSafeInteger(value.acknowledgedSequence) ||
    Number(value.acknowledgedSequence) < 0 ||
    !Array.isArray(value.events) ||
    !value.events.every(isHostConnectorEvent) ||
    !Array.isArray(value.commands) ||
    !value.commands.every(isCommandEntry) ||
    !isRecord(value.sessions)
  ) {
    throw new Error("Invalid Host Connector state journal.");
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
  const commands = value.commands as CommandJournalEntry[];
  const nextEventSequence = Number(value.nextEventSequence);
  const acknowledgedSequence = Number(value.acknowledgedSequence);
  if (
    acknowledgedSequence > nextEventSequence ||
    (events[0]?.sequence ?? acknowledgedSequence + 1) !==
      acknowledgedSequence + 1 ||
    events.some(
      (event, index) =>
        event.sequence <= acknowledgedSequence ||
        (index > 0 && event.sequence !== events[index - 1]!.sequence + 1),
    ) ||
    (events.at(-1)?.sequence ?? acknowledgedSequence) !== nextEventSequence
  ) {
    throw new Error("Invalid Host Connector event journal.");
  }
  if (new Set(commands.map((entry) => entry.commandId)).size !== commands.length) {
    throw new Error("Invalid Host Connector command journal.");
  }
  return {
    format: 2,
    connectorEpoch: value.connectorEpoch,
    nextEventSequence,
    acknowledgedSequence,
    events,
    commands,
    sessions,
  };
}

function migrateLegacyState(value: unknown): ConnectorState {
  if (
    !isRecord(value) ||
    value.format !== 1 ||
    typeof value.connectorEpoch !== "string" ||
    !value.connectorEpoch ||
    !Array.isArray(value.events) ||
    !value.events.every(isHostConnectorEvent) ||
    !Array.isArray(value.commandResults) ||
    !isRecord(value.sessions)
  ) {
    throw new Error("Invalid Host Connector legacy state journal.");
  }
  const events = (value.events as HostConnectorEvent[]).flatMap((event) =>
    event.payload.type === "session_event" ? [] : [event.payload],
  );
  const commands: CommandJournalEntry[] = value.commandResults.map((entry) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      !entry[0] ||
      !isCommandResult(entry[1])
    ) {
      throw new Error("Invalid Host Connector command journal.");
    }
    return {
      commandId: entry[0],
      sessionId: null,
      fingerprint: null,
      status: "completed",
      result: stableCommandResult(entry[1]),
    };
  });
  return parseState({
    ...value,
    format: 2,
    connectorEpoch: crypto.randomUUID(),
    acknowledgedSequence: 0,
    nextEventSequence: events.length,
    events: events.map((payload, index) => ({ sequence: index + 1, payload })),
    commands,
    commandResults: undefined,
  });
}

function initialState(): ConnectorState {
  return {
    format: 2,
    connectorEpoch: crypto.randomUUID(),
    nextEventSequence: 0,
    acknowledgedSequence: 0,
    events: [],
    commands: [],
    sessions: {},
  };
}

export class ConnectorStateJournal {
  private writeTail = Promise.resolve();
  private saveTimer: NodeJS.Timeout | undefined;
  private lifecycle: "open" | "closing" | "closed" = "open";
  private closePromise: Promise<void> | undefined;

  private constructor(
    private readonly file: string,
    private readonly state: ConnectorState,
  ) {}

  static async open(file: string): Promise<ConnectorStateJournal> {
    let state: ConnectorState;
    let migrated = false;
    try {
      let raw = await readFile(file, "utf8");
      const format = /^\s*\{\s*"format"\s*:\s*(\d+)/u.exec(raw)?.[1];
      if (format === "1") {
        raw = compactLegacyState(raw);
        state = migrateLegacyState(JSON.parse(raw));
        migrated = true;
      } else {
        state = parseState(JSON.parse(raw));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = initialState();
    }
    const journal = new ConnectorStateJournal(file, state);
    if (migrated) await journal.save();
    return journal;
  }

  get connectorEpoch(): string {
    return this.state.connectorEpoch;
  }

  enqueue(payload: HostConnectorEventPayload): HostConnectorEvent {
    this.assertOpen();
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

  async acknowledge(
    ack: HostConnectorEventAck,
  ): Promise<"acknowledged" | "rebased"> {
    this.assertOpen();
    if (ack.connectorEpoch !== this.state.connectorEpoch) {
      throw new Error("OvertChat acknowledged a different connector epoch.");
    }
    if (
      Number.isSafeInteger(ack.acknowledgedSequence) &&
      ack.acknowledgedSequence >= 0 &&
      ack.acknowledgedSequence < this.state.acknowledgedSequence
    ) {
      // Servers released before session-sync-v1 kept their receive cursor only
      // in memory. After one restarts it acknowledges 0 for a durable sender
      // that may be at 20,000+. Rotate only the transport identity and renumber
      // pending, already-produced events; daemon commands are never rerun.
      this.state.connectorEpoch = crypto.randomUUID();
      this.state.acknowledgedSequence = 0;
      this.state.events = this.state.events.map((event, index) => ({
        ...event,
        sequence: index + 1,
      }));
      this.state.nextEventSequence = this.state.events.length;
      await this.save();
      return "rebased";
    }
    if (
      !Number.isSafeInteger(ack.acknowledgedSequence) ||
      ack.acknowledgedSequence < 0 ||
      ack.acknowledgedSequence > this.state.nextEventSequence
    ) {
      throw new Error("OvertChat returned an invalid connector acknowledgement.");
    }
    this.state.acknowledgedSequence = ack.acknowledgedSequence;
    this.state.events = this.state.events.filter(
      (event) => event.sequence > ack.acknowledgedSequence,
    );
    await this.save();
    return "acknowledged";
  }

  commandEntry(commandId: string): CommandJournalEntry | undefined {
    return this.state.commands.find((entry) => entry.commandId === commandId);
  }

  async beginCommand(
    commandId: string,
    sessionId: string,
    fingerprint: string,
  ): Promise<BeginCommandResult> {
    this.assertOpen();
    if (!isCommandIdentity(commandId, sessionId, fingerprint)) {
      throw new Error("Invalid command ledger identity.");
    }
    const existing = this.commandEntry(commandId);
    if (existing) {
      if (
        existing.sessionId === null ||
        existing.fingerprint === null
      ) {
        return existing.status === "completed"
          ? { status: "completed", result: existing.result }
          : { status: "pending" };
      }
      if (
        existing.sessionId !== sessionId ||
        existing.fingerprint !== fingerprint
      ) {
        throw new Error("A command identity was reused for different work.");
      }
      return existing.status === "completed"
        ? { status: "completed", result: existing.result }
        : { status: "pending" };
    }
    this.state.commands.push({
      commandId,
      sessionId,
      fingerprint,
      status: "pending",
    });
    await this.save();
    return { status: "execute" };
  }

  async completeCommand(
    commandId: string,
    sessionId: string,
    fingerprint: string,
    result: CachedCommandResult,
  ): Promise<void> {
    this.assertOpen();
    if (!isCommandIdentity(commandId, sessionId, fingerprint)) {
      throw new Error("Invalid command ledger identity.");
    }
    const existing = this.commandEntry(commandId);
    if (
      !existing ||
      existing.sessionId !== sessionId ||
      existing.fingerprint !== fingerprint
    ) {
      throw new Error("The command ledger entry changed before completion.");
    }
    if (existing.status === "completed") {
      throw new Error("The command ledger entry was already completed.");
    }
    const index = this.state.commands.indexOf(existing);
    this.state.commands[index] = {
      commandId,
      sessionId,
      fingerprint,
      status: "completed",
      result: stableCommandResult(result),
    };
    await this.save();
  }

  sessionQueue(sessionId: string): readonly AgentQueuedMessage[] {
    return this.state.sessions[sessionId]?.queuedMessages ?? [];
  }

  sessionIds(): string[] {
    return Object.keys(this.state.sessions);
  }

  sessionIdsForWorkspace(workspaceId: string): string[] {
    return Object.values(this.state.sessions)
      .filter((session) => session.descriptor.workspaceId === workspaceId)
      .map((session) => session.descriptor.sessionId);
  }

  sessionIdsForConnection(connectionId: string): string[] {
    return Object.values(this.state.sessions)
      .filter((session) => session.descriptor.connectionId === connectionId)
      .map((session) => session.descriptor.sessionId);
  }

  async retainSessions(sessionIds: ReadonlySet<string>): Promise<string[]> {
    this.assertOpen();
    const removed = this.deleteMatchingSessions(
      (session) => !sessionIds.has(session.descriptor.sessionId),
    );
    this.retainCommandsForSessions(sessionIds);
    await this.save();
    return removed;
  }

  async recordSession(descriptor: AgentDaemonSessionDescriptor): Promise<void> {
    this.assertOpen();
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
    this.assertOpen();
    const current = this.state.sessions[sessionId];
    if (!current) return;
    current.queuedMessages = messages.map((message) => ({
      ...message,
      ...(message.images ? { images: [...message.images] } : {}),
    }));
    await this.save();
  }

  async deleteSession(sessionId: string): Promise<string[]> {
    this.assertOpen();
    const removed = Boolean(this.state.sessions[sessionId]);
    if (removed) delete this.state.sessions[sessionId];
    const removedCommands = this.deleteCommandsForSessions(
      new Set([sessionId]),
    );
    if (!removed && !removedCommands) return [];
    await this.save();
    return removed ? [sessionId] : [];
  }

  async deleteWorkspace(workspaceId: string): Promise<string[]> {
    this.assertOpen();
    const removed = this.deleteMatchingSessions(
      (session) => session.descriptor.workspaceId === workspaceId,
    );
    await this.save();
    return removed;
  }

  async deleteConnection(connectionId: string): Promise<string[]> {
    this.assertOpen();
    const removed = this.deleteMatchingSessions(
      (session) => session.descriptor.connectionId === connectionId,
    );
    await this.save();
    return removed;
  }

  async deleteAllSessions(): Promise<string[]> {
    this.assertOpen();
    const removed = Object.keys(this.state.sessions);
    this.state.sessions = {};
    this.state.commands = this.state.commands.filter(
      (entry) => entry.sessionId === null,
    );
    await this.save();
    return removed;
  }

  async flush(): Promise<void> {
    this.assertOpen();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    await this.save();
    await this.writeTail;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.lifecycle = "closing";
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    this.closePromise = (async () => {
      try {
        await this.writeState();
        await this.writeTail;
      } finally {
        this.lifecycle = "closed";
      }
    })();
    return this.closePromise;
  }

  private assertOpen(): void {
    if (this.lifecycle !== "open") {
      throw new Error("Host Connector state journal is closed.");
    }
  }

  private deleteMatchingSessions(
    predicate: (session: SessionState) => boolean,
  ): string[] {
    const removed: string[] = [];
    for (const [sessionId, session] of Object.entries(this.state.sessions)) {
      if (!predicate(session)) continue;
      delete this.state.sessions[sessionId];
      removed.push(sessionId);
    }
    this.deleteCommandsForSessions(new Set(removed));
    return removed;
  }

  private deleteCommandsForSessions(
    sessionIds: ReadonlySet<string>,
  ): boolean {
    if (sessionIds.size === 0) return false;
    const previousLength = this.state.commands.length;
    this.state.commands = this.state.commands.filter(
      (entry) => entry.sessionId === null || !sessionIds.has(entry.sessionId),
    );
    return this.state.commands.length !== previousLength;
  }

  private retainCommandsForSessions(sessionIds: ReadonlySet<string>): void {
    this.state.commands = this.state.commands.filter(
      (entry) => entry.sessionId === null || sessionIds.has(entry.sessionId),
    );
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
    this.assertOpen();
    return this.writeState();
  }

  private writeState(): Promise<void> {
    const serialized = `${JSON.stringify(this.state)}\n`;
    const operation = this.writeTail.then(async () => {
      const directory = path.dirname(this.file);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(serialized, "utf8");
          await handle.chmod(0o600);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, this.file);
        let directoryHandle: Awaited<ReturnType<typeof open>> | undefined;
        try {
          directoryHandle = await open(directory, "r");
          await directoryHandle.sync();
        } catch (error) {
          if (
            !["EINVAL", "ENOTSUP", "EISDIR", "EPERM"].includes(
              String((error as NodeJS.ErrnoException).code),
            )
          ) {
            throw error;
          }
        } finally {
          await directoryHandle?.close();
        }
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    });
    this.writeTail = operation.catch(() => {});
    return operation;
  }
}
