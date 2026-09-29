import { installationLogPath } from "./install-log.js";
import { requireDocker } from "./docker.js";
import {
  components,
  composeArgs,
  managedDocker,
  managedInstallation,
} from "./management.js";
import os from "node:os";
import path from "node:path";
import { requireSuccessful } from "./process.js";

export async function logs(
  service: string | undefined,
  follow: boolean,
  tail: number,
): Promise<void> {
  if (service === "install") {
    await requireSuccessful("tail", ["-n", String(tail), ...(follow ? ["-F"] : []), installationLogPath()], { inherit: true });
    return;
  }
  // Connector diagnostics must work even if setup never saved installation.json.
  if (service === "connector") {
    const files = ["connector.log", "connector.error.log"].map((file) =>
          path.join(os.homedir(), "Library", "Logs", "OvertChat", file));
    if (process.platform === "linux") {
      await requireSuccessful(
        "journalctl",
        [
          "--user",
          "-u",
          "overtchat-connector.service",
          "--no-pager",
          "-n",
          String(tail),
          ...(follow ? ["-f"] : []),
        ],
        { inherit: true },
      );
    } else
      await requireSuccessful(
        "tail",
        ["-n", String(tail), ...(follow ? ["-F"] : []), ...files],
        { inherit: true },
      );
    return;
  }
  const { config, paths } = await managedInstallation();
  if (service === "speech") {
    if (!components(config).some((entry) => entry.id === service)) throw new Error("speech is not installed.");
    await requireSuccessful("tail", ["-n", String(tail), ...(follow ? ["-F"] : []), path.join(paths.stackDirectory, "apple-speech", "speech.log")], { inherit: true });
    return;
  }
  const selected = service
    ? components(config).find(
        (entry) => entry.id === service || entry.service === service,
      )
    : undefined;
  if (service && !selected?.service)
    throw new Error(
      `Unknown or uninstalled service: ${service}. Use app, redis, search, tts, stt, voice, connector, or speech.`,
    );
  await requireDocker(
    await managedDocker(),
    [
      ...composeArgs(paths),
      "logs",
      "--tail",
      String(tail),
      ...(follow ? ["--follow"] : []),
      ...(selected?.service ? [selected.service] : []),
    ],
    { inherit: true },
  );
}
