import { appendFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentProviderId } from "@overtchat/agent-bridge";
import { configureLocalTestProcessSpawner } from "./local-process.test-helper";
import { AgentRuntimeRegistry, type AgentSessionRuntime } from "./registry";

beforeAll(configureLocalTestProcessSpawner);

// Opt-in: uses installed provider CLIs and their configured model credentials.
// Set RUN_ATTENTION_INTEGRATION to a comma-separated list, such as
// "claude,codex,omp". Each case owns a new session and a disposable workspace.
// Set ATTENTION_INTEGRATION_LOG to a file path to record each status change.
const providers = (process.env.RUN_ATTENTION_INTEGRATION ?? "")
  .split(",")
  .map((provider) => provider.trim())
  .filter(Boolean) as AgentProviderId[];

/** Modes that ask before running commands, and those that never ask. */
const MODES: Partial<Record<AgentProviderId, { ask: string; bypass: string }>> = {
  claude: { ask: "default", bypass: "bypassPermissions" },
  codex: { ask: "auto", bypass: "full-access" },
  omp: { ask: "ask", bypass: "full" },
};

const TIMEOUT_MS = 180_000;

async function withSession(
  provider: AgentProviderId,
  modeId: string,
  run: (runtime: AgentSessionRuntime, cwd: string) => Promise<void>,
) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), `overtchat-attention-${provider}-`));
  const registry = new AgentRuntimeRegistry({ resolveImages: async () => [] });
  try {
    const { runtime } = await registry.create(`attention-${provider}`, {
      connectionId: "connection",
      workspaceId: "workspace",
      provider,
      target: { transport: "local" },
      executable: process.env[`${provider.toUpperCase()}_COMMAND`] ?? provider,
      cwd,
    }, { modeId });
    const log = process.env.ATTENTION_INTEGRATION_LOG;
    let last = "";
    const unobserve = log
      ? runtime.observe(() => {
          const status = JSON.stringify(runtime.directoryStatus());
          if (status === last) return;
          last = status;
          appendFileSync(log, `${provider} ${status}\n`);
        })
      : () => {};
    try {
      await run(runtime, cwd);
    } finally {
      unobserve();
    }
  } finally {
    await registry.stopAll();
    await rm(cwd, { recursive: true, force: true });
  }
}

describe.runIf(providers.length > 0)("installed agent attention state", () => {
  describe.each(providers)("%s", (provider) => {
    const modes = MODES[provider]!;

    it("reports a completed turn with a preview of the reply", async () => {
      await withSession(provider, modes.bypass, async (runtime) => {
        await runtime.command({
          type: "prompt",
          message: "Reply with exactly ATTENTION_DONE and nothing else. Do not use tools.",
        });
        expect(runtime.directoryStatus()).toMatchObject({
          runtimeStatus: "running",
          turnStartedAt: expect.any(Number),
        });
        await vi.waitFor(() => {
          expect(runtime.directoryStatus()).toMatchObject({
            runtimeStatus: "idle",
            turnStartedAt: null,
            attention: null,
            lastTurn: {
              outcome: "completed",
              preview: expect.stringContaining("ATTENTION_DONE"),
            },
          });
        }, { timeout: TIMEOUT_MS, interval: 200 });
        expect(runtime.directoryStatus().lastTurn).not.toHaveProperty("error");
      });
    }, TIMEOUT_MS + 30_000);

    it("summarizes a command approval until it is denied", async () => {
      await withSession(provider, modes.ask, async (runtime, cwd) => {
        const target = provider === "codex"
          // Codex's sandbox writes the workspace and temp dirs without asking.
          ? path.join(os.homedir(), `.overtchat-attention-probe-${process.pid}`)
          : path.join(cwd, "probe");
        await runtime.command({
          type: "prompt",
          message:
            `Use your shell tool to run exactly this command and nothing else: touch '${target}'. ` +
            "It writes outside your sandbox, so request escalated permissions if your shell tool supports that. " +
            "Do not try alternatives.",
        });
        await vi.waitFor(() => {
          expect(runtime.directoryStatus().attention).toMatchObject({
            kind: "approval",
            detail: expect.stringContaining(target),
          });
        }, { timeout: TIMEOUT_MS, interval: 200 });
        const request = runtime.snapshot().pendingInteraction!;
        const choices = Array.isArray(request.approvalChoices)
          ? (request.approvalChoices as Array<{ value: string; kind: string }>)
          : [];
        const deny = choices.find((choice) => choice.kind === "deny")?.value ??
          (typeof request.denyValue === "string" ? request.denyValue : "Deny");
        await runtime.command({ type: "interaction_response", id: request.id, value: deny });
        await vi.waitFor(() => {
          expect(runtime.directoryStatus()).toMatchObject({
            runtimeStatus: "idle",
            attention: null,
            lastTurn: { outcome: "completed" },
          });
        }, { timeout: TIMEOUT_MS, interval: 200 });
      });
    }, 2 * TIMEOUT_MS + 30_000);

    it("reports a user stop as stopped", async () => {
      await withSession(provider, modes.bypass, async (runtime) => {
        await runtime.command({
          type: "prompt",
          message: "Use your shell tool to run exactly: sleep 120. Then reply SLEPT.",
        });
        // Let the provider start the command before stopping it.
        await vi.waitFor(() => {
          const toolCalls = runtime.snapshot().messages.flatMap((message) => {
            const content = (message as { role?: string; content?: unknown }).content;
            return (message as { role?: string }).role === "assistant" && Array.isArray(content)
              ? content.filter((part) => (part as { type?: string }).type === "toolCall")
              : [];
          });
          expect(JSON.stringify(toolCalls)).toContain("sleep 120");
          expect(runtime.directoryStatus().runtimeStatus).toBe("running");
        }, { timeout: TIMEOUT_MS, interval: 200 });
        await runtime.command({ type: "abort" });
        await vi.waitFor(() => {
          expect(runtime.directoryStatus()).toMatchObject({
            runtimeStatus: "idle",
            lastTurn: { outcome: "stopped" },
          });
        }, { timeout: 60_000, interval: 200 });
        expect(runtime.directoryStatus().lastTurn).not.toHaveProperty("error");
      });
    }, TIMEOUT_MS + 90_000);
  });
});
