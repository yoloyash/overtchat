// Deterministic OMP RPC process; the adapter, runtime, daemon, journal and relay are real.
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { configureProcessSpawner } from "@overtchat/agent-runtime/runtime/process";
import { ConnectorClient } from "../src/client.ts";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
process.env.OVERTCHAT_CONNECTOR_STATE = path.join(config.directory, "state.json");
process.env.OVERTCHAT_CONNECTOR_TIMELINES = path.join(config.directory, "timelines");
process.env.OVERTCHAT_CONNECTOR_LOCK = path.join(config.directory, "lock");
const contextFile = path.join(config.directory, "provider-context.json");
let context = JSON.parse(await readFile(contextFile, "utf8").catch(() => "[]"));
const todosFile = path.join(config.directory, "provider-todos.json");
let todoPhases = JSON.parse(await readFile(todosFile, "utf8").catch(() => "[]"));
const models = ["A", "B"].map((name) => ({
  provider: "fixture", id: `model-${name.toLowerCase()}`, name: `Model ${name}`,
  reasoning: true, input: ["text"], contextWindow: 100000,
  thinking: { efforts: ["low", "high"], defaultLevel: "high" },
}));
const client = await ConnectorClient.create(config);
configureProcessSpawner((_target, launch) => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let end;
  const exit = new Promise((resolve) => { end = resolve; });
  const emit = (event) => stdout.write(`${JSON.stringify(event)}\n`);
  const argument = (name) => {
    const index = launch.args.indexOf(name);
    return index < 0 ? undefined : launch.args[index + 1];
  };
  let model = models.find((item) => argument("--model")?.endsWith(item.id)) ?? models[0];
  let level = argument("--thinking") ?? "high";
  let streaming = false;
  let pendingAsync = false;
  let lastControl = "";
  const backgroundAnswer = (text) => {
    const message = { role: "assistant", timestamp: Date.now(), content: [{ type: "text", text }] };
    emit({ type: "message_start", message });
    emit({ type: "message_end", message });
    return message;
  };
  const backgroundWait = () => {
    streaming = false;
    pendingAsync = true;
    emit({ type: "agent_end", isTerminal: false, yielded: true, awaitingAsyncWork: true });
  };
  const backgroundSettle = () => {
    streaming = false;
    pendingAsync = false;
    emit({ type: "session_settled" });
  };
  const controlTimer = config.backgroundLifecycle ? setInterval(async () => {
    const control = await readFile(path.join(config.directory, "background-control"), "utf8").catch(() => "");
    if (!control || control === lastControl) return;
    lastControl = control;
    // A suffix such as "wake-2" repeats a control.
    if (control.startsWith("wake")) {
      streaming = true;
      emit({ type: "agent_start" });
      backgroundAnswer("Background result received; continuing.");
    } else if (control.startsWith("wait")) backgroundWait();
    else if (control.startsWith("settle")) backgroundSettle();
  }, 50) : undefined;
  let input = "";
  let requests = Promise.resolve();
  stdin.on("data", (chunk) => {
    input += chunk.toString();
    for (;;) {
      const newline = input.indexOf("\n");
      if (newline < 0) break;
      const command = JSON.parse(input.slice(0, newline));
      input = input.slice(newline + 1);
      requests = requests.then(async () => {
        await appendFile(path.join(config.directory, "rpc-requests.jsonl"), `${command.type}\n`);
        const reply = (data = {}) => emit({
          type: "response", command: command.type, id: command.id, success: true, data,
        });
        switch (command.type) {
          case "get_state":
            reply({ sessionId: "native-session", sessionFile: "/tmp/runtime-test.jsonl",
              model, thinkingLevel: level, isStreaming: streaming, todoPhases,
              ...(config.backgroundLifecycle ? { hasPendingAsyncWork: pendingAsync, isSettled: !streaming && !pendingAsync } : {}) });
            break;
          case "get_messages": reply({ messages: context }); break;
          case "get_branch_messages": reply({ messages: [] }); break;
          case "get_available_models": reply({ models }); break;
          case "get_available_commands": reply({ commands: [{ name: "compact", source: "builtin", description: "Compact context" }] }); break;
          case "get_session_stats": reply({ totalMessages: context.length }); break;
          case "set_model": model = models.find((item) => item.id === command.modelId); reply(model); break;
          case "set_thinking_level": level = command.level; reply(); break;
          case "compact": {
            await new Promise((resolve) => setTimeout(resolve, 800));
            reply({ tokensBefore: 42000, summary: "A provider-only context summary." });
            break;
          }
          case "abort":
            // Like OMP, foreground abort leaves the async job pending.
            streaming = false;
            reply();
            break;
          case "prompt": {
            if (config.backgroundLifecycle) {
              streaming = true;
              emit({ type: "agent_start" });
              const user = { role: "user", content: command.message, timestamp: Date.now() };
              emit({ type: "message_end", message: user });
              const answer = backgroundAnswer(command.message === "Next" ? "Queued message answered." : "Answer finished; job continues.");
              context.push(user, answer);
              if (command.message === "Next") backgroundSettle();
              else backgroundWait();
              reply();
              break;
            }
            streaming = true;
            emit({ type: "agent_start" });
            let timestamp = 1;
            const message = (row) => {
              const stamped = { timestamp: timestamp++, ...row };
              emit({ type: "message_start", message: stamped });
              emit({ type: "message_end", message: stamped });
              return stamped;
            };
            const progress = (status, id, emitToolResult = true) => {
              todoPhases = [{ name: "Startup", tasks: [
                { content: "Inspect startup", status: "completed" },
                { content: "Verify startup", status },
              ] }];
              // Code-mode mutations can update native state without a named
              // todo result; runtime settlement must still publish progress.
              if (!emitToolResult) return;
              message({ role: "assistant", content: [{ type: "toolCall", id, name: "todo", arguments: {} }] });
              const result = { role: "toolResult", toolCallId: id, toolName: "todo",
                content: [{ type: "text", text: "Native todo summary" }], details: { phases: todoPhases } };
              emit({ type: "tool_execution_end", toolCallId: id, toolName: "todo", result });
              message(result);
            };
            message({ role: "user", content: "Earlier work" });
            for (let i = 1; i <= 4; i++) {
              message({ role: "assistant", content: [
                { type: "toolCall", id: `old-${i}`, name: "bash", arguments: { command: "true" } },
              ] });
              message({ role: "toolResult", toolCallId: `old-${i}`, toolName: "bash",
                content: [{ type: "text", text: "done" }] });
              message({ role: "custom", customType: "async-result",
                content: `<system-notice>Background job bg_${i} completed</system-notice>` });
            }
            message({ role: "assistant", content: [{ type: "text", text: "Earlier work completed." }] });
            progress("in_progress", "todo-start");
            emit({ type: "auto_compaction_start", reason: "threshold" });
            await new Promise((resolve) => setTimeout(resolve, 800));
            emit({ type: "auto_compaction_end", result: { tokensBefore: 120000 }, aborted: false });
            const user = message({ role: "user", content: command.message });
            progress("completed", "todo-finish", false);
            const answer = message({ role: "assistant", content: [
              { type: "text", text: "## Measured timings\n\nThe container is back up and healthy." },
            ] });
            // The provider now exposes compacted context, not the displayed timeline.
            context = [{ role: "compactionSummary", content: "Earlier work summarized." }, user, answer];
            await writeFile(contextFile, JSON.stringify(context));
            await writeFile(todosFile, JSON.stringify(todoPhases));
            streaming = false;
            emit({ type: "agent_end", messages: [answer] });
            reply();
            break;
          }
          default: reply();
        }
      });
      void requests.catch((error) => { console.error(error); process.exitCode = 1; });
    }
  });
  queueMicrotask(() => {
    if (launch.command === "omp") emit({ type: "ready", protocolVersion: 1 });
    else { stderr.end("Not available in the transcript fixture"); end({ code: 1, signal: null }); }
  });
  return { stdin, stdout, stderr, exit, kill: (signal = "SIGTERM") => {
    clearInterval(controlTimer);
    end({ code: null, signal });
    return true;
  } };
});
const running = client.run();
let stopping = false;
process.on("SIGTERM", async () => {
  if (stopping) return;
  stopping = true;
  await client.stop();
  await running;
  process.exit(0);
});
console.log("omp-transcript-fixture-ready");
await running;
