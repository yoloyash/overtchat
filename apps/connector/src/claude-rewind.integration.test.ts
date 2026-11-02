import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureProcessSpawner, executeOnHost, type HostTarget } from "@overtchat/agent-runtime";
import { ClaudeRuntimeClient } from "@overtchat/agent-runtime/claude/client";
import { ConnectorProcessHost } from "./runtime.js";

// Uses the installed CLI with synthetic history and an isolated config. No model
// requests or production transcripts. Set CLAUDE_REWIND_SSH_ALIAS for real SSH.
describe.runIf(process.env.RUN_CLAUDE_REWIND_INTEGRATION === "1")("installed Claude rewind durability", () => {
  const target: HostTarget = process.env.CLAUDE_REWIND_SSH_ALIAS
    ? { transport: "ssh", alias: process.env.CLAUDE_REWIND_SSH_ALIAS }
    : { transport: "local" };
  const host = new ConnectorProcessHost();
  let root: string;
  let cwd: string;
  let config: string;
  let sessionId: string;
  let sessionPath: string;
  let ids: string[];
  const run = (script: string, args: string[] = []) => executeOnHost(target, {
    command: "node", args: ["-e", script, ...args],
  }, { timeoutMs: 30_000 });

  beforeAll(async () => {
    configureProcessSpawner(host.spawn);
    const setup = await run(`
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { randomUUID } = require('node:crypto');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'overtchat-claude-rewind-')));
const cwd = path.join(root, 'workspace'), config = path.join(root, 'config');
fs.mkdirSync(cwd);
const project = path.join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
fs.mkdirSync(project, { recursive: true });
const sessionId = randomUUID(), ids = Array.from({ length: 6 }, () => randomUUID());
const entries = ids.map((uuid, i) => ({
  uuid, parentUuid: ids[i - 1] || null, sessionId, cwd, version: '2.1.301', isSidechain: false,
  timestamp: new Date(1790000000000 + i * 1000).toISOString(),
  type: i % 2 ? 'assistant' : 'user',
  message: i % 2 ? {
    id: 'msg_' + uuid, type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: 'Answer ' + i }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } : { role: 'user', content: 'Question ' + i },
}));
const sessionPath = path.join(project, sessionId + '.jsonl');
fs.writeFileSync(sessionPath, entries.map(JSON.stringify).join('\\n') + '\\n');
process.stdout.write(JSON.stringify({ root, cwd, config, sessionId, sessionPath, ids }));
`);
    ({ root, cwd, config, sessionId, sessionPath, ids } = JSON.parse(setup.stdout));
    configureProcessSpawner((target, launch) => host.spawn(target, {
      ...launch, env: { ...launch.env, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    }));
  }, 60_000);

  afterAll(async () => {
    if (root) await run("require('node:fs').rmSync(process.argv[1], {recursive:true,force:true})", [root]);
    await host.stop();
  });

  it("rewinds, stops without sending, reopens, and rewinds again including to empty", async () => {
    const launch = {
      executable: process.env.CLAUDE_COMMAND ?? "claude", cwd, modeId: "default",
      resume: { providerSessionId: sessionId, providerSessionPath: sessionPath },
    };
    let stage = "initial resume";
    const failures: string[] = [];
    const observe = (client: ClaudeRuntimeClient) => client.onEvent((event) => {
      if (event.type === "process_exit" && event.error) failures.push(String(event.error));
    });
    let client = new ClaudeRuntimeClient(target, launch);
    observe(client);
    const reopen = async () => {
      const state = await client.getState();
      await client.stop();
      client = new ClaudeRuntimeClient(target, { ...launch, resume: {
        providerSessionId: state.sessionId as string, providerSessionPath: state.sessionFile as string,
      } });
      observe(client);
      expect((await client.getState()).sessionId).toBe(state.sessionId);
      const context = (await client.getSessionStats()).contextUsage;
      expect(context?.tokens).toBeGreaterThan(0);
      expect(context?.contextWindow).toBeGreaterThan(0);
      return state;
    };
    try {
      await client.getState();
      stage = "first rewind";
      await client.rewind(ids[4]!, "conversation");
      stage = "first reopen";
      const fork = await reopen();
      expect(fork.sessionId).not.toBe(sessionId);
      const messages = (await client.getMessages()).messages as Array<{ id: string }>;
      expect(messages).toHaveLength(4);
      expect(messages.every((message) => !ids.includes(message.id))).toBe(true);
      stage = "second rewind";
      await client.rewind(messages[2]!.id, "conversation");
      await reopen();
      const second = (await client.getMessages()).messages as Array<{ id: string }>;
      expect(second).toHaveLength(2);
      stage = "empty rewind";
      await client.rewind(second[0]!.id, "conversation");
      stage = "empty reopen";
      await reopen();
      expect((await client.getMessages()).messages).toEqual([]);
      // A settings restart before the first post-rewind prompt also stays fresh.
      stage = "empty settings restart";
      await client.setThinkingLevel("off");
      stage = "empty reopen after settings";
      await reopen();
      expect((await client.getMessages()).messages).toEqual([]);
    } catch (error) {
      throw new Error(`${stage}: ${failures.join("; ") || String(error)}`, { cause: error });
    } finally { await client.stop(); }
  }, 120_000);
});
