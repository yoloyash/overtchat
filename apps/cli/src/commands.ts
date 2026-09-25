#!/usr/bin/env node
import { CLI_VERSION } from "./constants.js";
import { readInstallationConfig } from "./config.js";
import { doctor } from "./doctor.js";
import { lifecycle } from "./lifecycle.js";
import { logs } from "./logs.js";
import { installationReport } from "./management.js";
import { runtimePaths } from "./paths.js";
import { requireSuccessful } from "./process.js";
import {
  latestReleaseManifest,
  updateCliIfNeeded,
  type ReleaseManifest,
} from "./release.js";
import { setup } from "./setup.js";
import { status } from "./status.js";
import { uninstall } from "./uninstall.js";
import { update } from "./update.js";

const commands: Record<
  string,
  { usage: string; description: string; flags: string[] }
> = {
  setup: {
    usage: "setup [--dry-run] [--defaults] [--development]",
    description:
      "Install or reconfigure OvertChat. Existing versions are preserved. --dry-run previews without changes; --defaults runs without prompts.",
    flags: ["--dry-run", "--defaults", "--development"],
  },
  update: {
    usage: "update [--check [--json]]",
    description:
      "Update installed components. --check reports available versions without changing anything. App upgrades first verify a database snapshot.",
    flags: ["--check", "--json"],
  },
  status: {
    usage: "status [--json]",
    description:
      "Show running components, versions, access URL and storage paths.",
    flags: ["--json"],
  },
  version: {
    usage: "version [--all] [--json]",
    description:
      "Print the CLI version. --all includes running and configured component versions; --json provides structured output.",
    flags: ["--all", "--json"],
  },
  doctor: {
    usage: "doctor [--json]",
    description:
      "Diagnose installation health without making changes. Exits with status 1 if a check fails.",
    flags: ["--json"],
  },
  logs: {
    usage: "logs [service] [--follow|-f] [--tail N]",
    description:
      "Show Docker service logs (all by default), or connector/native speech logs. Services: app, redis, search, tts, stt, voice, connector, speech. Default: last 100 lines.",
    flags: ["--follow", "-f", "--tail"],
  },
  start: {
    usage: "start",
    description:
      "Start the saved stack and native services using installed images. Does not update or download components.",
    flags: [],
  },
  stop: {
    usage: "stop",
    description:
      "Stop the stack and native services, including active agent connections. Preserve all data.",
    flags: [],
  },
  restart: {
    usage: "restart",
    description:
      "Stop and start the saved stack and native services. Active agent connections are interrupted.",
    flags: [],
  },
  uninstall: {
    usage: "uninstall [--dry-run] [--purge] [--yes] [--remove-cli]",
    description:
      "Remove managed services and containers. Preserve data/configuration by default. --purge deletes proven-owned data, connector history and managed files; adopted storage remains. --dry-run previews the exact removal plan. --yes confirms removal without prompting. --remove-cli also deletes the installed manager binary.",
    flags: ["--dry-run", "--purge", "--yes", "--remove-cli"],
  },
};
export function usage(command?: string): string {
  const entry = command ? commands[command] : undefined;
  if (command && !entry) throw new Error(`Unknown command: ${command}`);
  if (entry) return `Usage: overtchat ${entry.usage}\n\n${entry.description}\n`;
  return `OvertChat management CLI\n\nUsage: overtchat <command> [options]\n\n${Object.values(
    commands,
  )
    .map((item) => `  ${item.usage}`)
    .join("\n")}\n\nRun overtchat <command> --help for details.\n`;
}
export function parseArgs(argv: string[]) {
  let [command, ...args] = argv;
  if (command === "--version" || command === "-v") command = "version";
  if (["help", "--help", "-h"].includes(command ?? "")) {
    if (args.length > 1) throw new Error("Usage: overtchat help [command]");
    return {
      command: args[0],
      help: true,
      flags: new Set<string>(),
      tail: 100,
      service: undefined,
    };
  }
  if (!command)
    return {
      command,
      help: false,
      flags: new Set<string>(),
      tail: 100,
      service: undefined,
    };
  const entry = commands[command];
  if (!entry) throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  const help = args.includes("--help") || args.includes("-h");
  args = args.filter((arg) => arg !== "--help" && arg !== "-h");
  const flags = new Set<string>();
  let tail = 100;
  let service: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (command === "logs" && !arg.startsWith("-") && !service) {
      service = arg;
      continue;
    }
    if (!entry.flags.includes(arg))
      throw new Error(`Unknown ${command} option: ${arg}\n\n${usage(command)}`);
    if (flags.has(arg)) throw new Error(`Repeated option: ${arg}`);
    flags.add(arg);
    if (arg === "--tail") {
      const value = args[++index];
      if (
        !value ||
        !/^\d+$/u.test(value) ||
        !Number.isSafeInteger(Number(value))
      )
        throw new Error("--tail requires a non-negative integer.");
      tail = Number(value);
    }
  }
  if (
    command === "update" &&
    flags.has("--json") &&
    !flags.has("--check") &&
    !help
  )
    throw new Error("update --json requires --check.");
  return { command, help, flags, tail, service };
}
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const { command, flags, help } = parsed;
  if (help) {
    console.log(usage(command));
    return;
  }
  if (!command) {
    if (await readInstallationConfig(runtimePaths())) await status();
    console.log(usage());
    return;
  }
  const json = flags.has("--json");
  switch (command) {
    case "setup": {
      const options = {
        dryRun: flags.has("--dry-run"),
        defaults: flags.has("--defaults"),
        development: flags.has("--development"),
      };
      if (options.development) {
        await setup(options);
        return;
      }
      const saved = await readInstallationConfig(runtimePaths());
      // Reconfiguration must also work offline and must never implicitly upgrade.
      const manifest: ReleaseManifest = saved
        ? { ...saved, cliVersion: CLI_VERSION }
        : await latestReleaseManifest();
      const updatedExecutable =
        !saved && !options.dryRun ? await updateCliIfNeeded(manifest) : null;
      if (updatedExecutable) {
        await requireSuccessful(
          updatedExecutable,
          ["setup", ...argv.slice(1)],
          { inherit: true },
        );
        return;
      }
      await setup(options, manifest);
      return;
    }
    case "update":
      await update({ check: flags.has("--check"), json });
      return;
    case "status":
      await status(json);
      return;
    case "version": {
      if (flags.has("--all")) {
        const report = await installationReport();
        if (json) console.log(JSON.stringify(report, null, 2));
        else {
          console.log(`CLI: ${CLI_VERSION}`);
          if (!report.managed)
            console.log("Server: not managed on this machine");
          for (const item of report.components)
            console.log(
              `${item.id}: ${item.running ?? "unknown"} (configured: ${item.configured}; ${item.state})`,
            );
          for (const problem of report.problems)
            console.log(`Warning: ${problem}`);
        }
      } else
        console.log(json ? JSON.stringify({ cli: CLI_VERSION }) : CLI_VERSION);
      return;
    }
    case "doctor":
      await doctor(json);
      return;
    case "logs":
      await logs(
        parsed.service,
        flags.has("--follow") || flags.has("-f"),
        parsed.tail,
      );
      return;
    case "start":
    case "stop":
    case "restart":
      await lifecycle(command);
      return;
    case "uninstall":
      await uninstall({
        dryRun: flags.has("--dry-run"),
        purge: flags.has("--purge"),
        yes: flags.has("--yes"),
        removeCli: flags.has("--remove-cli"),
      });
      return;
  }
}
