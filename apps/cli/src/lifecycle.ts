import {
  detectDockerCommand,
  dockerComposeAvailable,
  requireDocker,
} from "./docker.js";
import { composeArgs, managedInstallation } from "./management.js";
import { waitForApp } from "./setup.js";

export type LifecycleAction = "start" | "stop" | "restart";

// Stops and starts the managed Compose services only. The Host Connector and
// native Apple speech are host services with their own lifecycle: stopping the
// connector would end live coding-agent sessions.
export async function lifecycle(action: LifecycleAction): Promise<void> {
  const { config, paths } = await managedInstallation();
  const docker = await detectDockerCommand();
  if (!docker || !(await dockerComposeAvailable(docker)))
    throw new Error("Docker Engine and Docker Compose v2 are required.");
  const compose = (...args: string[]) =>
    requireDocker(docker, [...composeArgs(paths), ...args], { inherit: true });
  // Stopped containers are kept, so data, settings and pairing are untouched
  // and the stack stays stopped across host restarts until started again.
  if (action !== "start") await compose("stop");
  if (action === "stop") {
    console.log("OvertChat is stopped. Run overtchat start to bring it back.");
    return;
  }
  // `up` rather than `start`/`restart`: it honors service health dependencies
  // and recreates containers that were removed outside the CLI.
  await compose("up", "-d");
  await waitForApp(`http://127.0.0.1:${config.appPort}`);
  console.log(`OvertChat is ready at ${config.publicUrl}`);
}
