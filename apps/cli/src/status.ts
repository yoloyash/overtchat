import { readInstallationConfig } from "./config.js";
import { detectDockerCommand, runDocker } from "./docker.js";
import { runtimePaths } from "./paths.js";

export function providerStatus(provider: string): string {
  return provider === "disabled" ? "not configured" : provider;
}

export async function status(): Promise<void> {
  const paths = runtimePaths();
  const config = await readInstallationConfig(paths);
  if (!config) {
    console.log("OvertChat is not managed on this machine. Run: overtchat setup");
    return;
  }
  const docker = await detectDockerCommand();
  const app = docker
    ? await runDocker(docker, [
        "inspect",
        "--format",
        "{{.State.Status}}",
        "overtchat-app",
      ])
    : null;
  console.log(`OvertChat ${config.appVersion}`);
  console.log(`Status: ${app?.exitCode === 0 ? app.stdout.trim() : "unavailable"}`);
  console.log(`URL: ${config.publicUrl}`);
  console.log(`Web search: ${providerStatus(config.search.provider)}`);
  console.log(
    `Text-to-speech: ${providerStatus(config.tts.provider)}${
      config.tts.provider === "bundled"
        ? ` (${config.tts.accelerator === "auto" || config.tts.accelerator === "gpu" ? "NVIDIA" : "CPU"})`
        : ""
    }`,
  );
  console.log(`Speech-to-text: ${providerStatus(config.stt.provider)}`);
  console.log(`Realtime voice: ${config.voice.installed ? "installed" : "not installed"}`);
  console.log(`Agent Connections: ${config.agents.installed ? "installed" : "not installed"}`);
}
