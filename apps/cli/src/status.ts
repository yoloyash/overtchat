import { readInstallationConfig } from "./config.js";
import { detectDockerCommand, runDocker } from "./docker.js";
import { runtimePaths } from "./paths.js";

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
  console.log(`Web search: ${config.search.provider}`);
  console.log(`Text-to-speech: ${config.tts.provider}`);
  console.log(`Speech-to-text: ${config.stt.provider}`);
  console.log(`Realtime voice: ${config.voice.installed ? "installed" : "not installed"}`);
  console.log(`Agent Connections: ${config.agents.installed ? "installed" : "not installed"}`);
}
