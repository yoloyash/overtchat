import { createHash, createHmac } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import bundle from "./generated/apple-speech.json";
import { requireSuccessful, runCommand } from "./process.js";
import { runtimePaths } from "./paths.js";
import type { InstallationConfig, RuntimePaths, SttConfig } from "./types.js";

const UV_VERSION = "0.12.18";
const UV_SHA256 = "cf40e0c6a202190ccd9e0406dcfdd5b2d6668a9a5c779b17948963df32aafe5b";
const PYTHON_VERSION = "3.12.12";
const files = JSON.parse(gunzipSync(Buffer.from(bundle.gzip, "base64")).toString()) as Record<string, string>;
export const APPLE_SPEECH_REVISION = createHash("sha256").update(JSON.stringify([files, UV_SHA256, PYTHON_VERSION])).digest("hex").slice(0, 16);

export function supportsAppleSpeech(platform = process.platform, arch = process.arch, release = os.release()): boolean {
  return platform === "darwin" && arch === "arm64" && Number(release.split(".")[0]) >= 23;
}

export async function detectAppleSpeech(): Promise<string | null> {
  if (!supportsAppleSpeech()) return null;
  const result = await runCommand("sysctl", ["-n", "machdep.cpu.brand_string"]);
  return result.exitCode === 0 ? result.stdout.trim() || "Apple Silicon" : "Apple Silicon";
}

export function usesAppleSpeech(service: SttConfig): boolean {
  return service.bundledInstalled && service.accelerator === "apple";
}

export function appleSpeechCapabilities(config: InstallationConfig): string[] {
  return (["tts", "stt"] as const).filter((id) => usesAppleSpeech(config[id]));
}

export function bundledSpeechUrl(config: InstallationConfig, id: "tts" | "stt"): string {
  return usesAppleSpeech(config[id])
    ? `http://host.docker.internal:${config.appleSpeechPort ?? 5093}`
    : id === "tts" ? "http://kokoro:8880" : "http://stt:5092";
}

export function appleSpeechToken(managementSecret: string): string {
  return createHmac("sha256", managementSecret).update("overtchat.apple-speech.v1").digest("hex");
}

function locations(paths: RuntimePaths) {
  const suffix = createHash("sha256").update(paths.configDirectory).digest("hex").slice(0, 12);
  const label = `com.overtchat.speech.${suffix}`;
  const root = path.join(paths.stackDirectory, "apple-speech");
  return { root, label, domain: `gui/${process.getuid!()}`, plist: path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`) };
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function speechPlist(label: string, directory: string, root: string): string {
  const strings = [path.join(directory, ".venv", "bin", "python"), path.join(directory, "server.py"), "--config", path.join(directory, "service.json")];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${strings.map((value) => `<string>${xml(value)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(directory)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>EnvironmentVariables</key><dict><key>PYTHONUNBUFFERED</key><string>1</string></dict>
<key>StandardOutPath</key><string>${xml(path.join(root, "speech.log"))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(root, "speech.log"))}</string>
</dict></plist>\n`;
}

export async function appleSpeechHealth(config: InstallationConfig, token: string): Promise<{ ready: boolean; revision: string; capabilities: string[] } | null> {
  const response = await fetch(`http://127.0.0.1:${config.appleSpeechPort ?? 5093}/healthz`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const body = await response.json().catch(() => null);
  return body?.name === "overtchat-speech" && body.ready === true ? body : null;
}

async function waitReady(config: InstallationConfig, token: string, revision: string, capabilities: string[]): Promise<void> {
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const health = await appleSpeechHealth(config, token);
    if (health?.revision === revision && JSON.stringify(health.capabilities) === JSON.stringify(capabilities)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Apple speech did not become ready. Check apple-speech/speech.log in the managed stack directory.");
}

async function readOptional(file: string): Promise<string | null> {
  try { return await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function ensureRuntime(root: string, directory: string): Promise<void> {
  if (await readOptional(path.join(directory, ".installed"))) return;
  const uvRoot = path.join(root, "tools", UV_VERSION);
  const uv = path.join(uvRoot, "uv-aarch64-apple-darwin", "uv");
  const environment = { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(root, "python"), UV_CACHE_DIR: path.join(root, "downloads") };
  await mkdir(uvRoot, { recursive: true, mode: 0o700 });
  if (await readOptional(path.join(uvRoot, ".verified")) !== UV_SHA256) {
    const response = await fetch(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-apple-darwin.tar.gz`, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Could not download the speech installer (HTTP ${response.status}).`);
    const archive = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(archive).digest("hex") !== UV_SHA256) throw new Error("Speech installer checksum mismatch");
    const archivePath = path.join(uvRoot, "uv.tar.gz");
    await writeFile(archivePath, archive, { mode: 0o600 });
    await requireSuccessful("tar", ["-xzf", archivePath, "-C", uvRoot]);
    await rm(archivePath);
    await writeFile(path.join(uvRoot, ".verified"), UV_SHA256, { mode: 0o600 });
  }
  await requireSuccessful(uv, ["python", "install", "--no-bin", PYTHON_VERSION], { environment, inherit: true });
  await requireSuccessful(uv, ["venv", "--managed-python", "--python", PYTHON_VERSION, path.join(directory, ".venv")], { environment, inherit: true });
  await requireSuccessful(uv, ["pip", "sync", "--python", path.join(directory, ".venv", "bin", "python"), "--require-hashes", path.join(directory, "requirements.lock")], { environment, inherit: true });
  await writeFile(path.join(directory, ".installed"), APPLE_SPEECH_REVISION, { mode: 0o600 });
}

export type SpeechChange = { commit: () => Promise<void>; rollback: () => Promise<void> };

export async function stopSpeechAgent(target: string): Promise<void> {
  const previous = await runCommand("launchctl", ["print", target]);
  if (previous.exitCode !== 0) return;
  const pid = Number(previous.stdout.match(/^\s*pid = (\d+)$/mu)?.[1]);
  await requireSuccessful("launchctl", ["bootout", target]);
  // Like the connector, wait for both the job and process: bootout is asynchronous.
  const deadline = Date.now() + 30_000;
  while (true) {
    let running = false;
    if (pid) {
      try { process.kill(pid, 0); running = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
    const registered = await runCommand("launchctl", ["print", target]);
    if (!running && registered.exitCode !== 0) return;
    if (Date.now() >= deadline) throw new Error("The previous Apple speech service has not stopped. Retry after it exits.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Prepare and start a candidate before routing the app to it; preserve the previous service on failure. */
export async function prepareAppleSpeech(config: InstallationConfig, managementSecret: string, paths = runtimePaths()): Promise<SpeechChange> {
  const capabilities = appleSpeechCapabilities(config);
  const noop = async () => {};
  if (!capabilities.length && process.platform !== "darwin") return { commit: noop, rollback: noop };
  const { root, label, domain, plist } = locations(paths);
  const previous = await readOptional(plist);
  if (!capabilities.length) {
    return { rollback: noop, commit: async () => {
      if (!previous) return;
      await stopSpeechAgent(`${domain}/${label}`);
      await rm(plist, { force: true });
    } };
  }
  if (!supportsAppleSpeech()) throw new Error("Apple speech requires Apple Silicon and macOS 14 or later.");
  if (process.getuid!() === 0) throw new Error("Run Apple speech setup as your normal macOS user, without sudo.");
  await requireSuccessful("launchctl", ["print", domain]);
  const token = appleSpeechToken(managementSecret);
  const health = await appleSpeechHealth(config, token);
  if (health?.revision === APPLE_SPEECH_REVISION && JSON.stringify(health.capabilities) === JSON.stringify(capabilities)) return { commit: noop, rollback: noop };
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Include credentials as well as the selection so rollback always retains the old configuration.
  const selection = createHash("sha256").update(JSON.stringify([capabilities, token, config.appleSpeechPort ?? 5093])).digest("hex").slice(0, 12);
  const directory = path.join(root, `${APPLE_SPEECH_REVISION}-${selection}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [name, contents] of Object.entries(files)) await writeFile(path.join(directory, name), contents, { mode: 0o600 });
  await ensureRuntime(root, directory);
  await writeFile(path.join(directory, "service.json"), JSON.stringify({ port: config.appleSpeechPort ?? 5093, capabilities, token, revision: APPLE_SPEECH_REVISION, cache_directory: root }), { mode: 0o600 });
  await chmod(path.join(directory, "service.json"), 0o600);
  await mkdir(path.dirname(plist), { recursive: true });
  const next = speechPlist(label, directory, root);
  const rollback = async () => {
    await stopSpeechAgent(`${domain}/${label}`);
    if (previous) {
      await writeFile(plist, previous, { mode: 0o600 });
      await requireSuccessful("launchctl", ["bootstrap", domain, plist]);
    } else await rm(plist, { force: true });
  };
  try {
    await stopSpeechAgent(`${domain}/${label}`);
    await writeFile(`${plist}.next`, next, { mode: 0o600 });
    await rename(`${plist}.next`, plist);
    await requireSuccessful("launchctl", ["enable", `${domain}/${label}`]);
    await requireSuccessful("launchctl", ["bootstrap", domain, plist]);
    await waitReady(config, token, APPLE_SPEECH_REVISION, capabilities);
  } catch (error) {
    try { await rollback(); }
    catch (recoveryError) { throw new AggregateError([error, recoveryError], "Apple speech startup failed and its previous service could not be restored. Run overtchat setup to repair it."); }
    throw error;
  }
  return { rollback, commit: noop };
}
