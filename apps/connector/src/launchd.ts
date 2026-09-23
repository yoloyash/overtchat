import { execFile } from "node:child_process";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const label = "com.overtchat.connector";

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function launchAgentPlist(
  invocation: string[],
  home: string,
  environment: NodeJS.ProcessEnv,
): string {
  const logDirectory = path.join(home, "Library", "Logs", "OvertChat");
  const variables: Record<string, string> = {
    PATH: [
      environment.PATH,
      path.join(home, ".local", "bin"),
      path.join(home, ".bun", "bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ]
      .filter(Boolean)
      .join(":"),
  };
  for (const key of [
    "OVERTCHAT_CONNECTOR_CONFIG",
    "OVERTCHAT_CONNECTOR_STATE",
    "OVERTCHAT_CONNECTOR_TIMELINES",
    "OVERTCHAT_CONNECTOR_LOCK",
  ]) {
    if (environment[key]) variables[key] = environment[key];
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>${invocation.map((argument) => `<string>${xml(argument)}</string>`).join("")}</array>
  <key>WorkingDirectory</key><string>${xml(home)}</string>
  <key>EnvironmentVariables</key><dict>${Object.entries(variables)
    .map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`)
    .join("")}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(path.join(logDirectory, "connector.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logDirectory, "connector.error.log"))}</string>
</dict></plist>
`;
}

export async function assertLaunchAgentAvailable(): Promise<void> {
  if (process.getuid?.() === 0)
    throw new Error(
      "Run the Host Connector as your normal macOS user, without sudo.",
    );
  try {
    await exec("launchctl", ["print", `gui/${process.getuid!()}`]);
  } catch {
    throw new Error(
      "The Host Connector requires a logged-in macOS desktop session. Log in on this Mac and retry as that user.",
    );
  }
}

export async function installLaunchAgent(
  invocation: string[],
): Promise<string> {
  await assertLaunchAgentAvailable();
  const home = os.homedir();
  const directory = path.join(home, "Library", "LaunchAgents");
  const file = path.join(directory, `${label}.plist`);
  await mkdir(directory, { recursive: true });
  await mkdir(path.join(home, "Library", "Logs", "OvertChat"), {
    recursive: true,
    mode: 0o700,
  });
  const domain = `gui/${process.getuid!()}`;
  const previous = await exec("launchctl", [
    "print",
    `${domain}/${label}`,
  ]).catch(() => null);
  if (previous) {
    const pid = Number(previous.stdout.match(/^\s*pid = (\d+)$/mu)?.[1]);
    await exec("launchctl", ["bootout", `${domain}/${label}`]);
    // bootout returns before a running job has necessarily finished exiting.
    // Reusing its label immediately can fail with bootstrap error 5, and its
    // journal lock must be released before a replacement starts.
    const deadline = Date.now() + 15_000;
    while (true) {
      let running = false;
      if (pid) {
        try {
          process.kill(pid, 0);
          running = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
      const registered = await exec("launchctl", [
        "print",
        `${domain}/${label}`,
      ]).then(
        () => true,
        () => false,
      );
      if (!running && !registered) break;
      if (Date.now() >= deadline)
        throw new Error(
          "The previous Host Connector LaunchAgent did not stop. Retry after it exits.",
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await writeFile(file, launchAgentPlist(invocation, home, process.env), {
    mode: 0o600,
  });
  await chmod(file, 0o600);
  await exec("launchctl", ["enable", `${domain}/${label}`]);
  await exec("launchctl", ["bootstrap", domain, file]);
  return file;
}
