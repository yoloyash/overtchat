import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { AGENT_PROVIDER_IDS } from "@overtchat/agent-bridge";
import { agentProviderAdapter } from "../providers/registry";
import type { AgentRuntimeClient } from "../providers/types";
import { configureLocalTestProcessSpawner } from "./local-process.test-helper";

const selected = (process.env.REWIND_PROVIDERS ?? "").split(",");
beforeAll(configureLocalTestProcessSpawner);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function body(value: unknown): string {
  const content = record(value).content;
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => record(part).text ?? "").join("\n")
      : "";
}
function allowTestTools(client: AgentRuntimeClient): () => void {
  return client.onEvent((event) => {
    if (event.type === "interaction_request" && typeof event.id === "string") {
      client.respondToInteraction(event.id, {
        value: "Allow once",
        confirmed: true,
      });
    }
  });
}

async function prompt(client: AgentRuntimeClient, text: string) {
  let ended = false;
  const events: string[] = [];
  let failure: string | undefined;
  const off = client.onEvent((event) => {
    events.push(event.type);
    if (["agent_settled", "agent_end", "turn_end"].includes(event.type))
      ended = true;
    if (event.type === "rpc_error" || event.type === "process_exit")
      failure = String(event.error ?? "Provider exited");
  });
  try {
    await client.prompt(text);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (failure) throw new Error(failure);
      if (ended && (await client.getState()).isStreaming !== true) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      `Provider turn did not settle within 120 seconds: ${JSON.stringify({ events: events.slice(-20), state: await client.getState() })}`,
    );
  } finally {
    off();
  }
}

for (const provider of AGENT_PROVIDER_IDS) {
  describe.runIf(selected.includes(provider))(
    `installed ${provider} rewind`,
    () => {
      it.runIf(provider === "claude" || provider === "opencode")(
        "restores files with the provider's native checkpoints",
        async () => {
          const cwd = mkdtempSync(
            join(tmpdir(), `overtchat-rewind-files-${provider}-`),
          );
          execFileSync("git", ["init", "-q", cwd]);
          const adapter = agentProviderAdapter(provider);
          const executable =
            process.env[`${provider.toUpperCase()}_COMMAND`] ?? provider;
          const client = adapter.startSession(
            { transport: "local" },
            {
              executable,
              cwd,
              ...(provider === "claude" ? { modeId: "bypassPermissions" } : {}),
            },
          );
          const stopApprovals = allowTestTools(client);
          try {
            await client.getState();
            await prompt(
              client,
              "Use the Write tool to create checkpoint.txt containing exactly FIRST. Do not use shell commands. Then reply DONE.",
            );
            await prompt(
              client,
              "Use the Edit tool to replace FIRST with SECOND in checkpoint.txt. Do not use shell commands. Then reply DONE.",
            );
            expect(readFileSync(join(cwd, "checkpoint.txt"), "utf8")).toContain(
              "SECOND",
            );
            const before = (await client.getMessages()).messages;
            const target = before
              .filter((message) => record(message).role === "user")
              .at(-1);
            await client.rewind!(
              record(target).id as string,
              provider === "claude" ? "files" : "both",
            );
            expect(readFileSync(join(cwd, "checkpoint.txt"), "utf8")).toContain(
              "FIRST",
            );
            const after = (await client.getMessages()).messages;
            if (provider === "claude") {
              expect(after).toEqual(before);
              await client.rewind!(record(target).id as string, "both");
            }
            expect(
              (await client.getMessages()).messages.some(
                (message) =>
                  record(message).role === "user" &&
                  body(message).includes("replace FIRST"),
              ),
            ).toBe(false);
          } finally {
            stopApprovals();
            await client.stop();
            rmSync(cwd, { recursive: true, force: true });
          }
        },
        300_000,
      );

      it("rewinds a native conversation, continues with retained context, and resumes", async () => {
        const cwd = mkdtempSync(
          join(tmpdir(), `overtchat-rewind-${provider}-`),
        );
        execFileSync("git", ["init", "-q", cwd]);
        const adapter = agentProviderAdapter(provider);
        const executable =
          process.env[`${provider.toUpperCase()}_COMMAND`] ??
          (provider === "claude" ? "claude" : provider);
        const launch = {
          executable,
          cwd,
          ...(process.env[`${provider.toUpperCase()}_REWIND_MODEL`]
            ? { model: process.env[`${provider.toUpperCase()}_REWIND_MODEL`] }
            : {}),
        };
        let client = adapter.startSession({ transport: "local" }, launch);
        const token = `KEEP_${randomUUID().slice(0, 8)}`;
        try {
          await client.getState();
          await prompt(
            client,
            `Remember the token ${token}. Reply with only that token. Do not use tools.`,
          );
          await prompt(
            client,
            "Reply with exactly DISCARD_THIS_TURN. Do not use tools.",
          );
          const before = (await client.getMessages()).messages;
          const users = before.filter(
            (message) => record(message).role === "user",
          );
          expect(users).toHaveLength(2);
          const id = record(users[1]).id;
          expect(id, "Native user message ID").toEqual(expect.any(String));
          await client.rewind!(
            id as string,
            provider === "opencode" ? "both" : "conversation",
          );
          const after = (await client.getMessages()).messages;
          expect(
            after.some((message) =>
              body(message).includes("DISCARD_THIS_TURN"),
            ),
          ).toBe(false);
          expect(after.some((message) => body(message).includes(token))).toBe(
            true,
          );
          await prompt(
            client,
            "What token did I ask you to remember? Reply with only the token. Do not use tools.",
          );
          const continued = (await client.getMessages()).messages;
          expect(
            body(
              continued
                .filter((message) => record(message).role === "assistant")
                .at(-1),
            ),
          ).toContain(token);
          const identity = adapter.sessionIdentity(await client.getState());
          await client.stop();
          client = adapter.startSession(
            { transport: "local" },
            { ...launch, resume: identity },
          );
          await client.getState();
          const resumed = (await client.getMessages()).messages;
          expect(
            resumed.some((message) =>
              body(message).includes("DISCARD_THIS_TURN"),
            ),
          ).toBe(false);
          expect(resumed.some((message) => body(message).includes(token))).toBe(
            true,
          );
          const first = resumed.find(
            (message) => record(message).role === "user",
          );
          await client.rewind!(
            record(first).id as string,
            provider === "opencode" ? "both" : "conversation",
          );
          expect(
            (await client.getMessages()).messages.filter((message) =>
              ["user", "assistant"].includes(String(record(message).role)),
            ),
          ).toHaveLength(0);
        } finally {
          await client.stop();
          rmSync(cwd, { recursive: true, force: true });
        }
      }, 420_000);
    },
  );
}
