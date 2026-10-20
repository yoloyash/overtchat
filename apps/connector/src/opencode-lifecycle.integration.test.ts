import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  configureManagedProcessSpawner,
  configureProcessSpawner,
  configureTcpTunnelOpener,
  executeOnHost,
  type HostTarget,
} from "@overtchat/agent-runtime";
import { OpenCodeRuntimeClient } from "@overtchat/agent-runtime/opencode/client";
import { openCodeServerPool } from "@overtchat/agent-runtime/opencode/server";
import { describe, expect, it, vi } from "vitest";
import { ConnectorProcessHost } from "./runtime.js";

const enabled = process.env.RUN_OPENCODE_LIFECYCLE_INTEGRATION === "1";
const targets: HostTarget[] = [
  { transport: "local" },
  ...(process.env.OPENCODE_SSH_ALIASES ?? "")
    .split(",")
    .filter(Boolean)
    .map((alias) => ({ transport: "ssh" as const, alias })),
];

function configure(host: ConnectorProcessHost): void {
  configureProcessSpawner(host.spawn);
  configureManagedProcessSpawner(host.spawnManaged);
  configureTcpTunnelOpener(host.openTcpTunnel);
}

async function waitUntil(
  condition: () => Promise<boolean>,
  timeout = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for OpenCode lifecycle state");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function fixture(target: HostTarget) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "overtchat-opencode-ledger-"),
  );
  const host = new ConnectorProcessHost(directory);
  configure(host);
  const executable =
    target.transport === "local"
      ? (process.env.OPENCODE_COMMAND ?? "opencode")
      : "opencode";
  const workspace = (
    await executeOnHost(target, {
      command: "/bin/sh",
      args: [
        "-c",
        'mktemp -d "${TMPDIR:-/tmp}/overtchat-opencode-lifecycle.XXXXXX"',
      ],
    })
  ).stdout.trim();
  return {
    host,
    directory,
    executable,
    workspace,
    async close() {
      await executeOnHost(target, {
        command: "rm",
        args: ["-rf", "--", workspace],
      });
      await host.stop();
      // Do not discard recovery evidence if a test fails to clean up a helper.
      expect(await readdir(directory)).toEqual([]);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe.runIf(enabled).each(targets)(
  "OpenCode lifecycle on $transport $alias",
  (target) => {
    it("aborts a running session without stopping another session's shared server", async () => {
      const setup = await fixture(target);
      const keeper = await openCodeServerPool.acquire(target, setup.executable);
      const sdk = createOpencodeClient({
        baseUrl: keeper.baseUrl,
        directory: setup.workspace,
      });
      // Use the native shell endpoint: exercise actual tool cancellation without
      // spending model tokens or relying on a model to choose a particular tool.
      const created = await sdk.session.create({ directory: setup.workspace });
      expect(created.error).toBeUndefined();
      const sessionID = created.data!.id;
      const first = new OpenCodeRuntimeClient(target, {
        executable: setup.executable,
        cwd: setup.workspace,
        resumeSessionId: sessionID,
      });
      const second = new OpenCodeRuntimeClient(target, {
        executable: setup.executable,
        cwd: setup.workspace,
      });
      let secondId: string | undefined;
      try {
        await first.getState();
        secondId = (await second.getState()).sessionId as string;
        const shell = sdk.session.shell({
          sessionID,
          directory: setup.workspace,
          agent: "build",
          command: "sleep 30",
        });
        let shellError: unknown;
        void shell.then((result) => {
          shellError = result.error;
        });
        await waitUntil(async () => {
          if (shellError) throw new Error(JSON.stringify(shellError));
          const status = await sdk.session.status({
            directory: setup.workspace,
          });
          return status.data?.[sessionID]?.type === "busy";
        });
        await first.stop();
        await waitUntil(async () => {
          const status = await sdk.session.status({
            directory: setup.workspace,
          });
          return status.data?.[sessionID]?.type !== "busy";
        });
        await shell;
        expect((await sdk.global.health()).data?.healthy).toBe(true);
        await expect(second.getState()).resolves.toMatchObject({
          sessionId: secondId,
        });
      } finally {
        await first.stop();
        await second.stop();
        await sdk.session.delete({ sessionID, directory: setup.workspace });
        if (secondId)
          await sdk.session.delete({
            sessionID: secondId,
            directory: setup.workspace,
          });
        await keeper.release();
        await setup.close();
      }
    }, 90_000);

    it.skipIf(target.transport !== "ssh")(
      "retries failed SSH cleanup before launching another server",
      async () => {
        const setup = await fixture(target);
        const first = await openCodeServerPool.acquire(
          target,
          setup.executable,
        );
        const [file] = await readdir(setup.directory);
        const record = JSON.parse(
          await readFile(path.join(setup.directory, file), "utf8"),
        );
        const blockedPath = await mkdtemp(
          path.join(os.tmpdir(), "overtchat-ssh-outage-"),
        );
        await writeFile(
          path.join(blockedPath, "ssh"),
          "#!/bin/sh\nexit 255\n",
          { mode: 0o700 },
        );
        const originalPath = process.env.PATH;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        let replacement:
          | Awaited<ReturnType<typeof openCodeServerPool.acquire>>
          | undefined;
        try {
          // Only new control connections fail. Existing sessions and the hosts'
          // actual networking are unaffected by this fixture-local executable.
          process.env.PATH = `${blockedPath}:${originalPath}`;
          await expect(first.release()).rejects.toThrow();
          expect(await readdir(setup.directory)).toContain(file);
          process.env.PATH = originalPath;
          replacement = await openCodeServerPool.acquire(
            target,
            setup.executable,
          );
          await expect(
            executeOnHost(target, {
              command: "kill",
              args: ["-0", String(record.root.pid)],
            }),
          ).rejects.toThrow();
          expect(await readdir(setup.directory)).not.toContain(file);
          expect(await readdir(setup.directory)).toHaveLength(1);
        } finally {
          if (originalPath === undefined) delete process.env.PATH;
          else process.env.PATH = originalPath;
          warn.mockRestore();
          await replacement?.release();
          await rm(blockedPath, { recursive: true, force: true });
          await setup.close();
        }
      },
      90_000,
    );

    it("recovers its recorded OpenCode server after the connector is killed", async () => {
      const setup = await fixture(target);
      const script = `
      import { ConnectorProcessHost } from ${JSON.stringify(new URL("./runtime.ts", import.meta.url).href)};
      const host = new ConnectorProcessHost(process.argv[1]);
      const target = JSON.parse(process.argv[2]);
      const child = await host.spawnManaged(target, {
        command: process.argv[3],
        args: ["serve", "--hostname", "127.0.0.1", "--port", "0"],
        cwd: process.argv[4], shellMode: "interactive",
        env: { OPENCODE_SERVER_PASSWORD: "" },
      });
      child.stdin.end();
      let output = "";
      const inspect = (chunk) => {
        output += chunk.toString();
        if (output.includes("opencode server listening on")) console.log("READY");
      };
      child.stdout.on("data", inspect);
      child.stderr.on("data", inspect);
    `;
      const connector = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          script,
          setup.directory,
          JSON.stringify(target),
          setup.executable,
          setup.workspace,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      let errors = "";
      connector.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      connector.stderr.on("data", (chunk) => {
        errors += chunk.toString();
      });
      const exited = new Promise<void>((resolve) =>
        connector.once("exit", () => resolve()),
      );
      try {
        await waitUntil(async () => {
          if (connector.exitCode !== null)
            throw new Error(`Connector fixture exited: ${errors}`);
          return output.includes("READY");
        }, 45_000);
        const [file] = await readdir(setup.directory);
        const record = JSON.parse(
          await readFile(path.join(setup.directory, file), "utf8"),
        );
        connector.kill("SIGKILL");
        await exited;
        const running = await executeOnHost(target, {
          command: "ps",
          args: ["-p", String(record.root.pid), "-o", "stat="],
        });
        expect(running.stdout.trim()).not.toMatch(/^Z/u);
        await setup.host.reap();
        expect(await readdir(setup.directory)).toEqual([]);
        await expect(
          executeOnHost(target, {
            command: "kill",
            args: ["-0", String(record.root.pid)],
          }),
        ).rejects.toThrow();
      } finally {
        connector.kill("SIGKILL");
        await exited;
        await setup.host.reap();
        await setup.close();
      }
    }, 90_000);
  },
);
