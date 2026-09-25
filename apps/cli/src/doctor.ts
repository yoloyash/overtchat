import { access, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import net from "node:net";
import path from "node:path";
import { verifyConnection } from "./connection-check.js";
import { readInstallationConfig } from "./config.js";
import { dockerComposeAvailable } from "./docker.js";
import { installationReport, managedDocker } from "./management.js";
import { nativePreflight } from "./native-services.js";
import { runtimePaths } from "./paths.js";
import type { InstallationConfig } from "./types.js";

export async function availablePort(
  port: number,
  host: string,
): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}
export async function availableDisk(directory: string): Promise<number> {
  let current = path.resolve(directory);
  for (;;) {
    try {
      const stats = await statfs(current);
      return stats.bavail * stats.bsize;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" ||
        current === path.dirname(current)
      )
        throw error;
      current = path.dirname(current);
    }
  }
}
export async function setupPreflight(
  config: InstallationConfig,
  existingPort?: number,
): Promise<void> {
  if (
    config.appPort !== existingPort &&
    !(await availablePort(config.appPort, config.bindAddress))
  )
    throw new Error(
      `Port ${config.appPort} is already in use. Run overtchat setup and choose another port.`,
    );
  if ((await availableDisk(runtimePaths().stackDirectory)) < 1024 ** 3)
    throw new Error(
      "Less than 1 GiB disk space is available. Free space before downloading OvertChat components; speech models need several additional GiB.",
    );
  await nativePreflight(config);
}
export async function doctor(json = false): Promise<void> {
  const report = await installationReport();
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  try {
    const docker = await managedDocker();
    const compose = await dockerComposeAvailable(docker);
    checks.push({
      name: "Docker and Compose",
      ok: compose,
      detail: compose ? "available" : "Install Docker Compose v2.",
    });
  } catch (error) {
    checks.push({
      name: "Docker",
      ok: false,
      detail: (error as Error).message,
    });
  }
  checks.push({
    name: "Installation",
    ok: report.managed,
    detail: report.managed ? "managed" : "Run overtchat setup.",
  });
  for (const component of report.components)
    checks.push({
      name: component.id,
      ok: ["running", "healthy", "ready", "online"].includes(component.state),
      detail:
        `${component.state}. ${["running", "healthy", "ready", "online"].includes(component.state) ? "" : `Run overtchat logs ${component.id}; overtchat start.`}`.trim(),
    });
  for (const problem of report.problems)
    checks.push({ name: "Configuration", ok: false, detail: problem });
  const paths = runtimePaths();
  const config = await readInstallationConfig(paths);
  if (config) {
    const appState = report.components.find(
      (component) => component.id === "app",
    )?.state;
    if (appState === "unavailable" || appState === "exited") {
      const free = await availablePort(config.appPort, config.bindAddress);
      checks.push({
        name: "App port",
        ok: free,
        detail: free
          ? `Port ${config.appPort} is available.`
          : `Port ${config.appPort} is occupied while the managed app is unavailable. Run overtchat setup to choose another port.`,
      });
    }
    const freeBytes = await availableDisk(paths.stackDirectory);
    checks.push({
      name: "Disk space",
      ok: freeBytes >= 1024 ** 3,
      detail: `${(freeBytes / 1024 ** 3).toFixed(1)} GiB available.${freeBytes < 1024 ** 3 ? " Free disk space before setup/update." : ""}`,
    });
    for (const file of [paths.composeFile, paths.secretsFile]) {
      try {
        await access(file, constants.R_OK);
        checks.push({ name: file, ok: true, detail: "readable" });
      } catch {
        checks.push({
          name: file,
          ok: false,
          detail: "Missing or unreadable. Run overtchat setup to repair.",
        });
      }
    }
    try {
      await nativePreflight(config);
      checks.push({
        name: "Native service session",
        ok: true,
        detail: "available or not required",
      });
    } catch (error) {
      checks.push({
        name: "Native service session",
        ok: false,
        detail: (error as Error).message,
      });
    }
    const problem = await verifyConnection(config.publicUrl, config.instanceId);
    checks.push({
      name: "Access URL",
      ok: !problem,
      detail: problem ?? `Verified ${config.publicUrl}`,
    });
  }
  const ok = checks.every((check) => check.ok);
  if (json) console.log(JSON.stringify({ ok, checks }, null, 2));
  else
    for (const check of checks)
      console.log(
        `${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`,
      );
  if (!ok) process.exitCode = 1;
}
