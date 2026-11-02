// Apple accepts notarization before stapler fetches its ticket from CloudKit.
// Retry only explicit transport failures; signing/rejection errors still fail.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

export function isAppleNetworkFailure(output) {
  return /api\.apple-cloudkit\.com|CloudKit/i.test(output)
    && /NSURLErrorDomain\s+Code=-(?:1001|1005|1009)\b/.test(output);
}

export async function retryAppleNetwork(operation, {
  pause = delay,
  report = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await operation();
    if (result.status === 0 || attempt === 3 || !isAppleNetworkFailure(result.output)) return result;
    report(`Apple ticket connection failed; retrying (${attempt}/3).`);
    await pause(attempt * 15_000);
  }
}

export function execute(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", chunk => { output += chunk; process.stderr.write(chunk); });
    child.on("error", reject);
    child.on("close", (status, signal) => resolve({ status, signal, output }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  assert(command && args.length, "Usage: desktop-mac-network-retry.mjs command arguments...");
  const result = await retryAppleNetwork(() => execute(command, args));
  process.exitCode = result.status ?? 1;
}
