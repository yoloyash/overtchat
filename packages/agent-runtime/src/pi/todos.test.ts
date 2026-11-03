import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { applyAgentRuntimeMessageEvent } from "@overtchat/agent-bridge";
import { latestAgentTaskList, projectAgentTranscript } from "@overtchat/shared/agent-presentation";
import { PiClient } from "./client";
import { OmpClient } from "../omp/client";
import type { AgentProcess, AgentProcessExit } from "../runtime/process";

class RpcProcess implements AgentProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  private resolveExit!: (exit: AgentProcessExit) => void;
  readonly exit = new Promise<AgentProcessExit>((resolve) => { this.resolveExit = resolve; });
  history: unknown[] = [];
  state: Record<string, unknown> = {};
  tree: Record<string, unknown> = {};
  commands: string[] = [];
  holdState = false;
  pendingState: Record<string, unknown> | undefined;
  constructor() {
    this.stdin.on("data", (chunk) => {
      const command = JSON.parse(chunk.toString());
      this.commands.push(command.type);
      if (command.type === "get_state" && this.holdState) { this.pendingState = command; return; }
      this.reply(command, command.type === "get_messages" || command.type === "get_branch_messages"
        ? { messages: command.type === "get_messages" ? this.history : [] }
        : command.type === "get_state" ? this.state
        : command.type === "get_entries" ? this.tree : {});
    });
  }
  reply(command: Record<string, unknown>, data: unknown) {
    this.send({ type: "response", id: command.id, command: command.type, success: true, data });
  }
  send(event: unknown) { this.stdout.write(`${JSON.stringify(event)}\n`); }
  kill(signal: NodeJS.Signals = "SIGTERM") { this.resolveExit({ code: null, signal }); return true; }
}

const phases = (status = "pending") => [{ name: "Implementation", tasks: [
  { content: "Inspect", status: "completed" }, { content: "Implement", status },
] }];
const formats = [
  { name: "OMP", provider: "omp", details: (done: boolean) => ({ phases: phases(done ? "completed" : "in_progress") }), clear: { phases: [] } },
  { name: "Pi example", provider: "pi", details: (done: boolean) => ({ action: "list", nextId: 3, todos: [
    { id: 1, text: "Inspect", done: true }, { id: 2, text: "Implement", done },
  ] }), clear: { action: "clear", nextId: 3, todos: [] } },
  { name: "Pi rpiv", provider: "pi", details: (done: boolean) => ({ action: "list", params: {}, nextId: 3, tasks: [
    { id: 1, subject: "Inspect", status: "completed" }, { id: 2, subject: "Implement", status: done ? "completed" : "in_progress" },
    { id: 3, subject: "Deleted task", status: "deleted" },
  ] }), clear: { action: "clear", params: {}, nextId: 4, tasks: [] } },
];

function setup(provider: string) {
  const process = new RpcProcess();
  const client = provider === "omp" ? new OmpClient(process, "full") : new PiClient(process);
  process.send({ type: "ready", protocolVersion: 1 });
  let messages: unknown[] = [];
  client.onEvent((event) => { messages = applyAgentRuntimeMessageEvent(messages, event); });
  return { process, client, messages: () => messages };
}

function result(id: string, details: unknown, extra = {}) {
  return { role: "toolResult", toolCallId: id, toolName: "todo", content: [{ type: "text", text: "Native summary" }], details, ...extra };
}

for (const format of formats) describe(format.name, () => {
  it("renders confirmed progress once, imports it, and clears the current checklist", async () => {
    const { process, client, messages } = setup(format.provider);
    try {
      const call = { role: "assistant", id: "call", content: [{ type: "toolCall", id: "todo-1", name: "todo", arguments: {} }] };
      process.send({ type: "message_end", message: call });
      const native = result("todo-1", format.details(false));
      process.send({ type: "tool_execution_update", toolName: "todo", toolCallId: "todo-1", partialResult: native });
      expect(latestAgentTaskList(messages())).toBeNull();
      process.send({ type: "tool_execution_end", toolName: "todo", toolCallId: "todo-1", result: native });
      process.send({ type: "message_end", message: native });
      expect(messages()).toHaveLength(2);
      expect(projectAgentTranscript(messages()).map((row) => row.type)).toEqual(["task_list"]);
      expect(latestAgentTaskList(messages())?.tasks.map((task) => task.step)).toEqual(["Inspect", "Implement"]);
      expect(latestAgentTaskList(messages())?.tasks.filter((task) => task.status === "completed")).toHaveLength(1);
      process.history = [call, native];
      expect(latestAgentTaskList((await client.getMessages()).messages)).toEqual(latestAgentTaskList(messages()));
      process.send({ type: "message_end", message: result("todo-2", format.details(true)) });
      expect(latestAgentTaskList(messages())?.tasks.every((task) => task.status === "completed")).toBe(true);
      process.send({ type: "message_end", message: result("todo-3", format.clear) });
      expect(latestAgentTaskList(messages())?.tasks).toEqual([]);
      // Importing the rewound native branch must not retain a later completion/clear.
      await client.rewind("user", "conversation");
      expect(latestAgentTaskList((await client.getMessages()).messages)?.tasks.filter((task) => task.status === "completed")).toHaveLength(1);
    } finally { await client.stop(); }
  });

  it("keeps unknown and failed tools inspectable without overwriting known progress", async () => {
    const { process, client, messages } = setup(format.provider);
    try {
      process.send({ type: "message_end", message: result("good", format.details(false)) });
      const before = latestAgentTaskList(messages());
      for (const [id, details, extra] of [
        ["unknown", { tasks: "unknown extension" }, {}],
        ["failed", format.clear, { isError: true }],
        ["other-tool", format.details(true), { toolName: "custom" }],
      ] as const) process.send({ type: "message_end", message: result(id, details, extra) });
      expect(latestAgentTaskList(messages())).toEqual(before);
      expect(projectAgentTranscript(messages()).flatMap((row) => row.type === "activity" ? row.entries : [])).toHaveLength(3);
    } finally { await client.stop(); }
  });
});

it("preserves Pi native result identity before adding display-only task content", async () => {
  const { process, client } = setup("pi");
  try {
    const native = result("todo-1", formats[1]!.details(false));
    process.history = [native];
    process.tree = { leafId: "native-result", entries: [
      { id: "native-result", parentId: null, type: "message", message: native },
    ] };
    const history = await client.getMessages();
    expect(history.messages[0]).toMatchObject({ id: "native-result", toolCallId: "todo-1" });
    expect(latestAgentTaskList(history.messages)?.tasks).toHaveLength(2);
  } finally { await client.stop(); }
});

describe("OMP task cards", () => {
  const progress = (done: number) => ({ phases: [{ name: "Work", tasks: ["Inspect", "Implement", "Verify"]
    .map((content, index) => ({ content, status: index < done ? "completed" : index === done ? "in_progress" : "pending" })) }] });
  let clock = Date.parse("2026-10-27T00:00:00Z");
  const todo = (id: string, done: number) => [
    { role: "assistant", id: `call-${id}`, content: [{ type: "toolCall", id, name: "todo", arguments: {} }] },
    result(id, progress(done), { timestamp: ++clock }),
  ];
  const user = (id: string) => ({ role: "user", id, content: id });
  // The visible rows: user messages by ID and task cards by completed count.
  const cards = (messages: unknown[]) => projectAgentTranscript(messages).flatMap((row) =>
    row.type === "message" ? [String((row.message as { id: unknown }).id)]
    : row.type === "task_list" ? [`${row.snapshot.tasks.filter((task) => task.status === "completed").length}/3`] : []);

  function sendTodo(process: RpcProcess, id: string, done: number) {
    const [call, native] = todo(id, done);
    process.send({ type: "message_end", message: call });
    process.send({ type: "tool_execution_end", toolName: "todo", toolCallId: id, result: native });
    process.send({ type: "message_end", message: native });
  }

  it("renders successive snapshots in a turn as one card in its final state", async () => {
    const { process, client, messages } = setup("omp");
    try {
      process.send({ type: "agent_start" });
      process.send({ type: "message_end", message: user("first") });
      for (const done of [0, 1, 2]) sendTodo(process, `todo-${done}`, done);
      expect(cards(messages())).toEqual(["first", "2/3"]);
      process.state = { todoPhases: progress(3).phases };
      process.send({ type: "todo_reminder" });
      await vi.waitFor(() => expect(cards(messages())).toEqual(["first", "3/3"]));
      process.send({ type: "agent_end" });
      expect(projectAgentTranscript(messages()).map((row) => row.type)).toEqual(["message", "task_list"]);

      process.history = [user("first"), ...[0, 1, 2].flatMap((done) => todo(`todo-${done}`, done))];
      const restored = (await client.getMessages()).messages;
      expect(projectAgentTranscript(restored).map((row) => row.type)).toEqual(["message", "task_list"]);
      expect(cards(restored)).toEqual(["first", "3/3"]);
    } finally { await client.stop(); }
  });

  it("keeps each turn's card in its own turn when the list changes across turns", async () => {
    const { process, client, messages } = setup("omp");
    const taskKeys = () => projectAgentTranscript(messages()).flatMap((row) => row.type === "task_list" ? [row.key] : []);
    try {
      process.send({ type: "agent_start" });
      process.send({ type: "message_end", message: user("first") });
      sendTodo(process, "todo-0", 0);
      sendTodo(process, "todo-1", 1);
      process.send({ type: "agent_end" });
      const [first] = taskKeys();

      process.send({ type: "agent_start" });
      process.send({ type: "message_end", message: user("second") });
      sendTodo(process, "todo-2", 2);
      sendTodo(process, "todo-3", 3);
      expect(cards(messages())).toEqual(["first", "1/3", "second", "3/3"]);
      expect(taskKeys()).toHaveLength(2);
      expect(taskKeys()[0]).toBe(first);
      expect(latestAgentTaskList(messages())?.tasks.every((task) => task.status === "completed")).toBe(true);

      process.history = [user("first"), ...todo("todo-0", 0), ...todo("todo-1", 1),
        user("second"), ...todo("todo-2", 2), ...todo("todo-3", 3)];
      process.state = { todoPhases: progress(3).phases };
      expect(cards((await client.getMessages()).messages)).toEqual(["first", "1/3", "second", "3/3"]);
    } finally { await client.stop(); }
  });
});

describe("OMP current task state", () => {
  it("logs a failed reminder refresh and recovers on the next runtime state refresh", async () => {
    const { process, client, messages } = setup("omp");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      process.state = { todoPhases: phases() };
      await client.getState();
      process.send({ type: "message_end", message: result("current", { phases: phases() }) });
      const before = [...messages()];
      process.holdState = true;
      process.send({ type: "todo_reminder" });
      await vi.waitFor(() => expect(process.pendingState).toBeDefined());
      process.send({ type: "response", id: process.pendingState!.id,
        command: "get_state", success: false, error: "Temporary failure" });
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
        "Oh My Pi task progress refresh failed.", expect.any(Error),
      ));
      expect(messages()).toEqual(before);
      process.holdState = false;
      process.state = { todoPhases: phases("completed") };
      await client.getState();
      expect(latestAgentTaskList(messages())?.tasks.every((task) => task.status === "completed")).toBe(true);
    } finally { await client.stop(); warn.mockRestore(); }
  });

  it("observes a code-mode clear after restarting from an existing durable transcript", async () => {
    const { process, client, messages } = setup("omp");
    try {
      process.state = { todoPhases: phases() };
      await client.getState(); // Runtime loads metadata, retaining its saved transcript.
      expect(messages()).toEqual([]);
      process.state = { todoPhases: [] };
      process.send({ type: "agent_end" });
      await client.getState(); // The runtime settlement path already fetches state.
      expect(latestAgentTaskList(messages())?.tasks).toEqual([]);
    } finally { await client.stop(); }
  });

  it("restores state after compacted/code-mode history and represents blocked/abandoned work", async () => {
    const { process, client } = setup("omp");
    try {
      process.history = [{ role: "compactionSummary", content: "Private summary" }];
      process.state = { todoPhases: [{ name: "Build", tasks: [
        { content: "Waiting", status: "blocked", blocker: "Needs input" },
        { content: "Dropped", status: "abandoned" },
      ] }] };
      const imported = (await client.getMessages()).messages;
      expect(latestAgentTaskList(imported)?.tasks).toEqual([{ id: "0:0", step: "Waiting (blocked: Needs input)", status: "pending" }]);
      expect(imported[0]).toEqual(process.history[0]);
      process.history = [result("old", { phases: phases() })];
      process.state = { todoPhases: [] };
      expect(latestAgentTaskList((await client.getMessages()).messages)?.tasks).toEqual([]);
    } finally { await client.stop(); }
  });

  it("uses full state for reminders and settles code-mode updates without duplicate snapshots", async () => {
    const { process, client, messages } = setup("omp");
    try {
      process.state = { todoPhases: [] };
      await client.getState();
      process.state = { todoPhases: phases() };
      process.send({ type: "todo_reminder", todos: [{ content: "Implement", status: "pending" }] });
      await vi.waitFor(() => expect(latestAgentTaskList(messages())?.tasks).toHaveLength(2));
      const count = messages().length;
      const requests = process.commands.length;
      process.send({ type: "agent_end" });
      await new Promise((resolve) => setImmediate(resolve));
      expect(process.commands).toHaveLength(requests);
      await client.getState();
      expect(messages()).toHaveLength(count);
      process.state = { todoPhases: phases("completed") };
      process.send({ type: "agent_end" });
      await client.getState();
      expect(latestAgentTaskList(messages())?.tasks.every((task) => task.status === "completed")).toBe(true);
    } finally { await client.stop(); }
  });

  it.each(["newer result", "rewind", "stop"])("drops a delayed state response after %s", async (action) => {
    const { process, client, messages } = setup("omp");
    try {
      process.holdState = true;
      process.send({ type: "todo_reminder" });
      await vi.waitFor(() => expect(process.pendingState).toBeDefined());
      if (action === "newer result") process.send({ type: "message_end", message: result("new", { phases: phases("completed") }) });
      else if (action === "rewind") await client.rewind("user", "conversation");
      else await client.stop();
      const before = [...messages()];
      process.reply(process.pendingState!, { todoPhases: phases() });
      await new Promise((resolve) => setImmediate(resolve));
      expect(messages()).toEqual(before);
    } finally { await client.stop(); }
  });
});
