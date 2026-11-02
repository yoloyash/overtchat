import { readFile, readdir, rm, writeFile, truncate, access } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureLocalTestProcessSpawner } from "../runtime/local-process.test-helper";
import { forkClaudeSession } from "./rewind";
import { readClaudeSessionForResume, renameClaudeSession } from "./sessions";
import { claudeRewindFixture } from "./rewind.test-helper";

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("durable Claude forks", () => {
  it("persists an SDK fork from a transcript larger than the normal command output bound", async () => {
    configureLocalTestProcessSpawner();
    const f = await claudeRewindFixture(true); roots.push(f.root);
    const original = await readFile(f.sessionPath, "utf8");
    const fork = await forkClaudeSession({ transport: "local" }, f.sessionId, f.sessionPath, f.cwd, f.ids[3]);
    expect(fork.providerSessionId).not.toBe(f.sessionId);
    const saved = await readClaudeSessionForResume({ transport: "local" }, fork.providerSessionPath);
    expect(saved.empty).toBe(false);
    expect(saved.messages).toHaveLength(4);
    expect(saved.messages[0]).toMatchObject({ role: "user", content: [{ type: "text", text: "Question 0" }] });
    const remapped = saved.messages as Array<{ id: string }>;
    expect(remapped.every((m) => !f.ids.includes(m.id))).toBe(true);
    const second = await forkClaudeSession({ transport: "local" }, fork.providerSessionId, fork.providerSessionPath, f.cwd, remapped[1]!.id);
    expect((await readClaudeSessionForResume({ transport: "local" }, second.providerSessionPath)).messages).toHaveLength(2);
    expect(await readFile(f.sessionPath, "utf8")).toBe(original);
    expect((await readdir(f.project)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("persists an explicit empty checkpoint for rewinding the first message", async () => {
    configureLocalTestProcessSpawner();
    const f = await claudeRewindFixture(); roots.push(f.root);
    const fork = await forkClaudeSession({ transport: "local" }, f.sessionId, f.sessionPath, f.cwd);
    expect(await readClaudeSessionForResume({ transport: "local" }, fork.providerSessionPath)).toEqual({ messages: [], empty: true });
  });

  it("does not publish a fork when the native anchor is absent", async () => {
    configureLocalTestProcessSpawner();
    const f = await claudeRewindFixture(); roots.push(f.root);
    await expect(forkClaudeSession({ transport: "local" }, f.sessionId, f.sessionPath, f.cwd, "00000000-0000-4000-8000-000000000001")).rejects.toThrow("not found");
    expect(await readdir(f.project)).toEqual([`${f.sessionId}.jsonl`]);
  });
});


it("resolves ID-only source descriptors on the execution host", async () => {
  configureLocalTestProcessSpawner();
  const f = await claudeRewindFixture(); roots.push(f.root);
  vi.stubEnv("CLAUDE_CONFIG_DIR", f.config);
  const fork = await forkClaudeSession({ transport: "local" }, f.sessionId, f.sessionId, f.cwd, f.ids[1]);
  expect(fork.providerSessionPath).toContain(f.project);
  expect((await readClaudeSessionForResume({ transport: "local" }, fork.providerSessionPath)).messages).toHaveLength(2);
});

it("keeps empty resets fresh after renaming, then retires their marker when native history exists", async () => {
  configureLocalTestProcessSpawner();
  const f = await claudeRewindFixture(); roots.push(f.root);
  const target = { transport: "local" } as const;
  const fork = await forkClaudeSession(target, f.sessionId, f.sessionPath, f.cwd);
  await renameClaudeSession(target, fork.providerSessionPath, fork.providerSessionId, "Reset");
  await expect(access(fork.providerSessionPath)).rejects.toThrow();
  expect((await readClaudeSessionForResume(target, fork.providerSessionPath)).empty).toBe(true);
  await writeFile(fork.providerSessionPath, JSON.stringify({ ...f.entries[0], sessionId: fork.providerSessionId }) + "\n");
  expect((await readClaudeSessionForResume(target, fork.providerSessionPath)).empty).toBe(false);
  await expect(access(fork.providerSessionPath + ".overtchat-empty")).rejects.toThrow();
  await rm(fork.providerSessionPath);
  await expect(readClaudeSessionForResume(target, fork.providerSessionPath)).rejects.toThrow();
});

it("rejects oversized native transcripts before publishing a new identity", async () => {
  configureLocalTestProcessSpawner();
  const f = await claudeRewindFixture(); roots.push(f.root);
  await truncate(f.sessionPath, 64 * 1024 * 1024 + 1);
  await expect(forkClaudeSession({ transport: "local" }, f.sessionId, f.sessionPath, f.cwd, f.ids[1])).rejects.toThrow("64 MiB");
  expect(await readdir(f.project)).toEqual([`${f.sessionId}.jsonl`]);
});
