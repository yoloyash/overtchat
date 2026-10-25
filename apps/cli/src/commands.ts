#!/usr/bin/env node
import { runUpdatedCli, withInstallationLock } from "./installation-lock.js";
import { withInstallationLog } from "./install-log.js";
import { CLI_VERSION } from "./constants.js";
import { readInstallationConfig } from "./config.js";
import { logs } from "./logs.js";
import { installationReport } from "./management.js";
import { runtimePaths } from "./paths.js";
import {
  recoverInterruptedCliUpdate,
  installDownloadedCli,
  latestReleaseManifest,
  updateCliIfNeeded,
} from "./release.js";
import { setup } from "./setup.js";
import { status } from "./status.js";
import { update } from "./update.js";
import { resetPassword } from "./reset-password.js";
import { resetTwoFactor } from "./reset-two-factor.js";

const commands: Record<
  string,
  { usage: string; description: string; flags: string[] }
> = {
  setup: {
    usage: "setup [--dry-run] [--defaults] [--development]",
    description:
      "Install or reconfigure OvertChat using the release manifest. --dry-run writes preview files; --defaults runs without prompts.",
    flags: ["--dry-run", "--defaults", "--development"],
  },
  update: {
    usage: "update [--check [--json]]",
    description:
      "Update installed components. --check reports available versions without changing anything.",
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
  logs: {
    usage: "logs [service] [--follow|-f] [--tail N]",
    description:
      "Show Docker service logs (all by default), or connector/native speech logs. Services: app, redis, search, tts, stt, voice, connector, speech, install. Default: last 100 lines.",
    flags: ["--follow", "-f", "--tail"],
  },
  "reset-password": {
    usage: "reset-password",
    description:
      "Recover a user's or administrator's password on this managed installation. Prompts securely and signs out all of the account's sessions. Requires an interactive terminal and a running app.",
    flags: [],
  },
  "reset-two-factor": {
    usage: "reset-two-factor",
    description:
      "Remove two-factor authentication from an account whose authenticator and backup codes are lost. Signs out all of the account's sessions. Requires an interactive terminal and a running app.",
    flags: [],
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
  // Bootstrap-only entry point; no server setup or credential access.
  if (argv.length === 1 && argv[0] === "install-manager")
    return withInstallationLock(installDownloadedCli);
  const parsed = parseArgs(argv);
  const { command, flags, help } = parsed;
  if (!help && (command === "setup" || (command === "update" && !flags.has("--check")))) {
    const recovered = await recoverInterruptedCliUpdate();
    if (recovered) return runUpdatedCli(recovered, argv);
  }
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
    case "reset-password":
      await resetPassword();
      return;
    case "reset-two-factor":
      await resetTwoFactor();
      return;
    case "setup": return withInstallationLock(() => withInstallationLog("setup", async () => {
      const options = {
        dryRun: flags.has("--dry-run"),
        defaults: flags.has("--defaults"),
        development: flags.has("--development"),
      };
      if (options.development) {
        await setup(options);
        return;
      }
      const manifest = await latestReleaseManifest();
      const updatedExecutable = await updateCliIfNeeded(manifest);
      if (updatedExecutable) {
        await runUpdatedCli(updatedExecutable, ["setup", ...argv.slice(1)]);
        return;
      }
      await setup(options, manifest);
    }));
    case "update":
      if (flags.has("--check")) await update({ check: true, json });
      else await withInstallationLock(() => withInstallationLog("update", () => update()));
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
    case "logs":
      await logs(
        parsed.service,
        flags.has("--follow") || flags.has("-f"),
        parsed.tail,
      );
      return;
  }
}
