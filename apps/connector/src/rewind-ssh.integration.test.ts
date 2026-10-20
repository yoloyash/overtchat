import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  configureManagedProcessSpawner,
  configureProcessSpawner,
  configureTcpTunnelOpener,
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime";
import { agentProviderAdapter } from "@overtchat/agent-runtime/providers/registry";
import type { AgentRuntimeClient } from "@overtchat/agent-runtime/providers/types";
import { ConnectorProcessHost } from "./runtime.js";

const aliases = (process.env.REWIND_SSH_ALIASES ?? "")
  .split(",")
  .filter(Boolean);
const providers = ["claude", "codex", "omp", "opencode"] as const;
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
async function prompt(
  client: AgentRuntimeClient,
  message: string,
): Promise<void> {
  let ended = false;
  let failure: string | undefined;
  const events: string[] = [];
  const unsubscribe = client.onEvent((event) => {
    events.push(event.type);
    if (["agent_settled", "agent_end", "turn_end"].includes(event.type))
      ended = true;
    if (["rpc_error", "process_exit"].includes(event.type))
      failure = String(event.error ?? "Provider exited");
  });
  try {
    await client.prompt(message);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (failure) throw new Error(failure);
      if (ended && (await client.getState()).isStreaming !== true) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Turn did not settle: ${events.slice(-20).join(", ")}`);
  } finally {
    unsubscribe();
  }
}

for (const alias of aliases.length ? aliases : [""]) {
  describe.runIf(Boolean(alias))(`native rewind over SSH to ${alias}`, () => {
    for (const provider of providers) {
      it(`${provider}: restores history, continues, and resumes${provider === "claude" || provider === "opencode" ? " with file checkpoints" : ""}`, async () => {
        const directory = await mkdtemp(
          path.join(os.tmpdir(), "overtchat-rewind-ssh-ledger-"),
        );
        const host = new ConnectorProcessHost(directory);
        configureProcessSpawner(host.spawn);
        configureManagedProcessSpawner(host.spawnManaged);
        configureTcpTunnelOpener(host.openTcpTunnel);
        const target: HostTarget = { transport: "ssh", alias };
        const cwd = (
          await executeOnHost(target, {
            command: "/bin/sh",
            args: [
              "-c",
              'mktemp -d "${TMPDIR:-/tmp}/overtchat-rewind-ssh.XXXXXX"',
            ],
          })
        ).stdout.trim();
        expect(cwd).toMatch(/\/overtchat-rewind-ssh\.[^/]+$/);
        const adapter = agentProviderAdapter(provider);
        const launch = {
          executable:
            process.env[`${provider.toUpperCase()}_COMMAND`] ?? provider,
          cwd,
          ...(process.env[`${provider.toUpperCase()}_REWIND_MODEL`]
            ? { model: process.env[`${provider.toUpperCase()}_REWIND_MODEL`] }
            : {}),
          ...(provider === "claude" ? { modeId: "bypassPermissions" } : {}),
        };
        let client: AgentRuntimeClient | undefined;
        let stopApprovals = () => {};
        try {
          await executeOnHost(target, {
            command: "git",
            args: ["init", "-q", cwd],
          });
          client = adapter.startSession(target, launch);
          const active = client;
          stopApprovals = client.onEvent((event) => {
            if (
              event.type === "interaction_request" &&
              typeof event.id === "string"
            )
              active.respondToInteraction(event.id, {
                value: "Allow once",
                confirmed: true,
              });
          });
          await client.getState();
          const token = `KEEP_${randomUUID().slice(0, 8)}`;
          const files = provider === "claude" || provider === "opencode";
          await prompt(
            client,
            `Remember ${token}. ${files ? "Use the Write tool to create checkpoint.txt containing exactly FIRST. Do not use shell commands." : "Do not use tools."} Reply with only ${token}.`,
          );
          await prompt(
            client,
            `${files ? "Use the Edit tool to replace FIRST with SECOND in checkpoint.txt. Do not use shell commands." : "Do not use tools."} Reply with exactly DISCARD_THIS_TURN.`,
          );
          const before = (await client.getMessages()).messages;
          const user = before
            .filter((value) => record(value).role === "user")
            .at(-1);
          expect(record(user).id).toEqual(expect.any(String));
          if (files) {
            expect(
              (
                await executeOnHost(target, {
                  command: "cat",
                  args: [`${cwd}/checkpoint.txt`],
                })
              ).stdout,
            ).toContain("SECOND");
          }
          if (provider === "claude") {
            await client.rewind!(record(user).id as string, "files");
            expect((await client.getMessages()).messages).toEqual(before);
          }
          await client.rewind!(
            record(user).id as string,
            files ? "both" : "conversation",
          );
          const after = (await client.getMessages()).messages;
          expect(
            after.some((value) => body(value).includes("DISCARD_THIS_TURN")),
          ).toBe(false);
          expect(after.some((value) => body(value).includes(token))).toBe(true);
          if (files) {
            expect(
              (
                await executeOnHost(target, {
                  command: "cat",
                  args: [`${cwd}/checkpoint.txt`],
                })
              ).stdout,
            ).toContain("FIRST");
          }
          await prompt(
            client,
            "What token did I ask you to remember? Reply with only the token. Do not use tools.",
          );
          const continued = (await client.getMessages()).messages;
          expect(
            body(
              continued
                .filter((value) => record(value).role === "assistant")
                .at(-1),
            ),
          ).toContain(token);
          const identity = adapter.sessionIdentity(await client.getState());
          stopApprovals();
          await client.stop();
          client = adapter.startSession(target, {
            ...launch,
            resume: identity,
          });
          await client.getState();
          const resumed = (await client.getMessages()).messages;
          expect(resumed.some((value) => body(value).includes(token))).toBe(
            true,
          );
          expect(
            resumed.some((value) => body(value).includes("DISCARD_THIS_TURN")),
          ).toBe(false);
          const first = resumed.find((value) => record(value).role === "user");
          await client.rewind!(
            record(first).id as string,
            provider === "opencode" ? "both" : "conversation",
          );
          expect(
            (await client.getMessages()).messages.filter((value) =>
              ["user", "assistant"].includes(String(record(value).role)),
            ),
          ).toEqual([]);
        } finally {
          stopApprovals();
          await client?.stop();
          await executeOnHost(target, {
            command: "rm",
            args: ["-rf", "--", cwd],
          });
          await host.stop();
          await rm(directory, { recursive: true, force: true });
        }
      }, 300_000);
    }
  });
}
