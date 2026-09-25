import { appleSpeechHealth, appleSpeechToken } from "./apple-speech.js";
import { readInstallationSecrets } from "./config.js";
import { waitForConnector } from "./connector.js";
import { requireDocker, runDocker } from "./docker.js";
import {
  composeArgs,
  components,
  managedDocker,
  managedInstallation,
  ownedContainer,
  projectContainers,
} from "./management.js";
import { manageNative, nativeServices } from "./native-services.js";
import { waitForApp } from "./setup.js";
import { startServe } from "./tailscale.js";

export async function lifecycle(
  action: "start" | "stop" | "restart",
): Promise<void> {
  const { config, paths } = await managedInstallation();
  const docker = await managedDocker();
  const containers = await projectContainers(docker, config);
  if (containers.some((container) => !ownedContainer(container, config, paths)))
    throw new Error(
      "This Compose project contains resources outside the managed stack. Resolve the ownership conflict before continuing.",
    );
  const native = await nativeServices(config, paths);
  if (action !== "stop") {
    const rendered = await runDocker(docker, [
      ...composeArgs(paths),
      "config",
      "--format",
      "json",
    ]);
    if (rendered.exitCode !== 0)
      throw new Error(
        "The saved Compose configuration is unavailable. Run overtchat setup to repair it.",
      );
    const stack = JSON.parse(rendered.stdout) as {
      services?: Record<string, { image?: string }>;
    };
    if (
      components(config).some(
        (component) =>
          component.service &&
          stack.services?.[component.service]?.image !== component.image,
      )
    ) {
      throw new Error(
        "Stack files differ from the saved component versions, possibly after an interrupted update. Run overtchat update to reconcile before starting.",
      );
    }
  }
  if (action !== "start") {
    for (const service of [...native].reverse())
      await manageNative(service, "stop");
    await requireDocker(
      docker,
      [...composeArgs(paths), "--profile", "*", "stop"],
      { inherit: true },
    );
    if (action === "stop") {
      console.log(
        "OvertChat stopped. Data and configuration retained. Run overtchat start to resume.",
      );
      return;
    }
  }
  for (const service of native.filter((entry) => entry.id === "speech"))
    await manageNative(service, "start");
  // Never pull a newer image as a side effect of starting an installation.
  await requireDocker(
    docker,
    [...composeArgs(paths), "up", "-d", "--pull", "never"],
    { inherit: true },
  );
  await waitForApp(`http://127.0.0.1:${config.appPort}`);
  const secrets = await readInstallationSecrets(paths);
  for (const service of native.filter((entry) => entry.id === "connector")) {
    await manageNative(service, "start");
    if (!secrets.managementSecret)
      throw new Error(
        "Management credentials are missing. Run overtchat setup.",
      );
    await waitForConnector(config, secrets.managementSecret);
  }
  if (native.some((entry) => entry.id === "speech")) {
    const deadline = Date.now() + 180_000;
    while (
      !(await appleSpeechHealth(
        config,
        appleSpeechToken(secrets.managementSecret ?? ""),
      ))
    ) {
      if (Date.now() >= deadline)
        throw new Error(
          "Apple speech is not ready. Run overtchat logs speech.",
        );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (config.managedTailscaleRoute)
    await startServe(
      config.managedTailscaleRoute,
      config.managedTailscaleRoute,
    );
  console.log(`OvertChat ready: ${config.publicUrl}`);
}
