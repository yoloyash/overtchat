import { requireDocker } from "./docker.js";
import {
  components,
  composeArgs,
  managedDocker,
  managedInstallation,
} from "./management.js";
import { nativeServices } from "./native-services.js";
import { requireSuccessful } from "./process.js";

export async function logs(
  service: string | undefined,
  follow: boolean,
  tail: number,
): Promise<void> {
  const { config, paths } = await managedInstallation();
  if (service === "connector" || service === "speech") {
    const native = (await nativeServices(config, paths)).find(
      (entry) => entry.id === service,
    );
    if (!native) throw new Error(`${service} is not installed.`);
    if (service === "connector" && process.platform === "linux") {
      await requireSuccessful(
        "journalctl",
        [
          "--user",
          "-u",
          native.label,
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
        ["-n", String(tail), ...(follow ? ["-F"] : []), ...native.logs],
        { inherit: true },
      );
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
