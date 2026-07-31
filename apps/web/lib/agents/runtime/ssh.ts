import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const HOST_KEY_TIMEOUT_MS = 8_000;
const MAX_HOST_KEY_OUTPUT = 64 * 1024;

export type ScannedSshHostKey = {
  hostKey: string;
  fingerprint: string;
};

export async function scanSshHostKey(
  hostname: string,
  port: number,
  aliases: string[] = [],
): Promise<ScannedSshHostKey> {
  const child = spawn(
    "ssh-keyscan",
    ["-T", "5", "-p", String(port), hostname],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    if (stdout.length > MAX_HOST_KEY_OUTPUT) child.kill("SIGKILL");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exit = await new Promise<{
    code: number | null;
    error?: Error;
    timedOut: boolean;
  }>((resolve) => {
    let settled = false;
    const finish = (result: {
      code: number | null;
      error?: Error;
      timedOut: boolean;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, timedOut: true });
    }, HOST_KEY_TIMEOUT_MS);
    child.once("error", (error) =>
      finish({ code: null, error, timedOut: false }),
    );
    child.once("exit", (code) =>
      finish({ code, timedOut: false }),
    );
  });

  if (exit.timedOut) throw new Error("Timed out while reading the SSH host key.");
  if (exit.error) {
    throw new Error(`Unable to run ssh-keyscan: ${exit.error.message}`);
  }

  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (lines.length === 0) {
    throw new Error(
      stderr.trim() || "The remote machine did not provide an SSH host key.",
    );
  }

  const parsed = lines
    .map((line) => ({ line, parts: line.split(/\s+/u) }))
    .filter(({ parts }) => parts.length >= 3);
  const preferred =
    parsed.find(({ parts }) => parts[1] === "ssh-ed25519") ??
    parsed.find(({ parts }) => parts[1]?.startsWith("ecdsa-")) ??
    parsed[0];
  const encodedKey = preferred?.parts[2];
  if (!preferred || !encodedKey) {
    throw new Error("The remote machine returned a malformed SSH host key.");
  }
  const digest = createHash("sha256")
    .update(Buffer.from(encodedKey, "base64"))
    .digest("base64")
    .replace(/=+$/u, "");
  const hostPatterns = new Set(preferred.parts[0]?.split(",") ?? []);
  for (const alias of aliases) {
    hostPatterns.add(port === 22 ? alias : `[${alias}]:${port}`);
  }
  return {
    hostKey: [
      [...hostPatterns].join(","),
      ...preferred.parts.slice(1),
    ].join(" "),
    fingerprint: `SHA256:${digest}`,
  };
}
