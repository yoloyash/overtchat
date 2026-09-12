import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.join(root, ".readme-media");
const assets = path.join(root, ".github/assets");
const mode = process.argv[2];
if (!["generate", "serve"].includes(mode) || process.argv.length !== 3) {
  throw new Error("Usage: npm run media:generate | media:serve");
}

const sourceFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root })
  .toString().split("\0").filter(Boolean).filter((file) =>
    /^(apps\/web\/|packages\/(shared|agent-bridge)\/)/.test(file) &&
    (!/(^|\/)(e2e|scripts)\/|\.(test|spec)\.|AGENTS\.md$|\.env/.test(file) || file.startsWith("apps/web/media/")) ||
    ["package.json", "package-lock.json", "apps/site/public/install-manifest.json"].includes(file),
  ).sort();
// Refuse concurrent capture runs. Never reuse a developer's server or database.
const npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
if (process.versions.node.split(".")[0] !== "22" || npmVersion !== "10.9.8") {
  throw new Error("README media requires Node 22 and npm 10.9.8, matching the repository toolchain.");
}
await fs.mkdir(work, { recursive: true });
const lock = path.join(work, "lock");
try { await fs.mkdir(lock); } catch {
  throw new Error("A media run is active, or an interrupted run left .readme-media/lock. See docs/readme-media.md.");
}
await fs.writeFile(path.join(lock, "pid"), String(process.pid));
const children = new Set();
const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "SYSTEMROOT", "CI"]
  .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
Object.assign(env, {
  NODE_ENV: "production", TZ: "UTC", NEXT_TELEMETRY_DISABLED: "1", DISABLE_UPDATE_CHECK: "true",
  BETTER_AUTH_SECRET: "readme-demo-only-not-a-production-secret-0000", REDIS_URL: "",
});

function start(command, args, cwd, extra = {}, stdio = "inherit") {
  const child = spawn(command, args, { cwd, env: { ...env, ...extra }, stdio });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}
async function run(command, args, cwd, extra) {
  const child = start(command, args, cwd, extra);
  const [code, signal] = await once(child, "exit");
  if (code !== 0) throw new Error(`${path.basename(command)} failed (${signal ?? code})`);
}
async function stopChildren() {
  await Promise.all([...children].map(async (child) => {
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await once(child, "exit").catch(() => {});
    clearTimeout(timer);
  }));
}
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  interrupted = true;
  await stopChildren();
  await fs.rm(path.join(work, "server.json"), { force: true });
  await fs.rm(lock, { recursive: true, force: true });
  process.exit(130);
});

try {
  const stage = path.join(work, "workspace");
  await fs.rm(stage, { recursive: true, force: true });
  for (const file of sourceFiles) {
    const target = path.join(stage, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(root, file), target);
  }
  // Install the locked web workspace without touching the developer's dependencies.
  await run("npm", ["ci", "--workspace", "apps/web", "--include-workspace-root=false", "--include=dev", "--no-audit", "--no-fund"], stage);
  const stagedRequire = createRequire(path.join(stage, "apps/web/package.json"));
  await run(process.execPath, [stagedRequire.resolve("@playwright/test/cli"), "install", "chromium"], stage);
  const app = path.join(stage, "apps/web");
  const portProbe = createServer();
  portProbe.listen(mode === "serve" ? 4799 : 0, "127.0.0.1");
  await once(portProbe, "listening");
  const port = portProbe.address().port;
  await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));
  const baseURL = `http://127.0.0.1:${port}`;
  const database = path.join(work, "demo.db");
  for (const suffix of ["", "-wal", "-shm"]) await fs.rm(database + suffix, { force: true });
  Object.assign(env, { DATABASE_URL: database, BETTER_AUTH_URL: baseURL, MIGRATIONS_FOLDER: path.join(app, "drizzle") });
  console.log("Building the current source in .readme-media/workspace (no local environment files).");
  const next = stagedRequire.resolve("next/dist/bin/next");
  await run(process.execPath, [next, "build"], app);
  const standalone = path.join(app, ".next/standalone/apps/web");
  await fs.cp(path.join(app, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
  await fs.cp(path.join(app, "public"), path.join(standalone, "public"), { recursive: true });
  const log = await fs.open(path.join(work, "server.log"), "w");
  const server = start(process.execPath, [path.join(standalone, "server.js")], standalone, { PORT: String(port), HOSTNAME: "127.0.0.1" }, ["ignore", log.fd, log.fd]);
  try {
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (server.exitCode !== null) throw new Error("Capture server exited; see .readme-media/server.log");
      try { if ((await fetch(`${baseURL}/login`)).ok) break; } catch { /* wait for startup */ }
      if (Date.now() > deadline) throw new Error("Capture server timed out; see .readme-media/server.log");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (mode === "serve") {
      await run(process.execPath, ["--import", stagedRequire.resolve("tsx"), path.join(app, "media/seed-demo.ts")], app, {
        MEDIA_BASE_URL: baseURL, MEDIA_DATABASE: database,
      });
      await fs.writeFile(path.join(work, "server.json"), JSON.stringify({ baseURL, port, pid: process.pid }));
      console.log(`Demo server ready at ${baseURL}. Leave this command running during Android capture.`);
      await once(server, "exit");
    } else {
      const candidate = path.join(work, "candidate");
      await fs.rm(candidate, { recursive: true, force: true });
      await fs.mkdir(candidate, { recursive: true });
      await run(process.execPath, [stagedRequire.resolve("@playwright/test/cli"), "test", "--config", path.join(app, "media/playwright.config.ts")], stage, {
        MEDIA_BASE_URL: baseURL, MEDIA_DATABASE: database, MEDIA_OUTPUT: candidate,
      });
      const images = ["banner", "chat", "search", "voice", "agent-connections", "mobile-web"];
      for (const name of images) {
        const bytes = await fs.readFile(path.join(candidate, `${name}.png`));
        if (bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a" || bytes.length > 2_000_000) {
          throw new Error(`Invalid or oversized capture: ${name}.png`);
        }
      }
      await fs.mkdir(assets, { recursive: true });
      for (const name of images) await fs.copyFile(path.join(candidate, `${name}.png`), path.join(assets, `${name}.png`));
      console.log(`Generated ${images.length} README images in .github/assets. Review them before committing.`);
    }
  } finally { await stopChildren(); await log.close(); }
} finally {
  if (!interrupted) await stopChildren();
  if (mode === "serve") await fs.rm(path.join(work, "server.json"), { force: true });
  await fs.rm(lock, { recursive: true, force: true });
}
