import { confirm, isCancel, note } from "@clack/prompts";
import {
  checkManagedConnectorPrerequisites,
  installManagedConnector,
} from "./connector.js";
import {
  installationLogHint,
  installationMessage,
  logInstallation,
} from "./install-log.js";
import type { InstallationConfig } from "./types.js";

type Progress = {
  start(message: string): void;
  stop(message?: string, code?: number): void;
  message(message: string): void;
};

async function retry(error: unknown, interactive: boolean): Promise<boolean> {
  const message = installationMessage(error);
  logInstallation(`Agent Connections need attention: ${message}`);
  note([
    message,
    installationLogHint(),
    "The app can be used without Agent Connections. Run overtchat setup later to retry.",
  ].filter(Boolean).join("\n"), "Agent Connections pending");
  if (!interactive) return false;
  const answer = await confirm({
    message: "Retry Agent Connections?",
    initialValue: false,
    active: "Retry",
    inactive: "Finish without Agent Connections for now",
  });
  return !isCancel(answer) && answer === true;
}

export async function prepareAgentConnections(
  config: InstallationConfig,
  interactive: boolean,
): Promise<boolean> {
  if (!config.agents.installed) return false;
  while (true) {
    try {
      logInstallation("Checking Agent Connector prerequisites before changing the app");
      await checkManagedConnectorPrerequisites();
      return true;
    } catch (error) {
      config.agents.pending = true;
      if (!(await retry(error, interactive))) return false;
    }
  }
}

export async function completeAgentConnections(
  config: InstallationConfig,
  secret: string,
  progress: Progress,
  interactive: boolean,
): Promise<void> {
  while (true) {
    try {
      await installManagedConnector(config, secret, {
        interactive,
        onProgress(message) {
          progress.message(message);
        },
        async permission(run) {
          progress.stop("Permission needed to keep Agent Connections running after logout");
          try {
            await run();
          } finally {
            progress.start("Installing Agent Connections");
          }
        },
      });
      delete config.agents.pending;
      return;
    } catch (error) {
      config.agents.pending = true;
      progress.stop("The app is running; Agent Connections need attention");
      const again = await retry(error, interactive);
      progress.start(again ? "Retrying Agent Connections" : "Finishing OvertChat setup");
      if (!again) return;
    }
  }
}

export function reportPendingAgentConnections(config: InstallationConfig): void {
  if (!config.agents.installed || !config.agents.pending) return;
  note([
    "The app is ready. Agent Connections setup is pending; your selection has been saved.",
    "Run overtchat setup to retry. Future updates will also retry Agent Connections.",
    installationLogHint(),
  ].filter(Boolean).join("\n"), "Completed with a warning");
}
