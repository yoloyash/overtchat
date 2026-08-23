#!/usr/bin/env node
import { CLI_VERSION } from "./constants.js";
import { requireSuccessful } from "./process.js";
import {
  latestReleaseManifest,
  updateCliIfNeeded,
} from "./release.js";
import { setup } from "./setup.js";
import { status } from "./status.js";
import { update } from "./update.js";

function usage(): string {
  return `OvertChat management CLI

Usage:
  overtchat setup [--dry-run] [--defaults] [--development]
  overtchat update
  overtchat status
  overtchat version
`;
}

async function main(): Promise<void> {
  const [command = "setup", ...args] = process.argv.slice(2);
  switch (command) {
    case "setup": {
      const supported = new Set(["--dry-run", "--defaults", "--development"]);
      const unexpected = args.find((argument) => !supported.has(argument));
      if (unexpected) throw new Error(`Unknown setup option: ${unexpected}`);
      const options = {
        dryRun: args.includes("--dry-run"),
        defaults: args.includes("--defaults"),
        development: args.includes("--development"),
      };
      if (options.development) {
        await setup(options);
        return;
      }
      const manifest = await latestReleaseManifest();
      const updatedExecutable = await updateCliIfNeeded(manifest);
      if (updatedExecutable) {
        await requireSuccessful(updatedExecutable, ["setup", ...args], {
          inherit: true,
        });
        return;
      }
      await setup(options, manifest);
      return;
    }
    case "update":
      if (args.length > 0) throw new Error("overtchat update takes no options.");
      await update();
      return;
    case "status":
      if (args.length > 0) throw new Error("overtchat status takes no options.");
      await status();
      return;
    case "version":
    case "--version":
    case "-v":
      console.log(CLI_VERSION);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(usage());
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
