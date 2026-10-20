import { spinner } from "@clack/prompts";
import { logInstallation, onInstallationFinished } from "./install-log.js";

export function installationSpinner() {
  const progress = spinner();
  let timer: NodeJS.Timeout | undefined;
  let active = false;
  onInstallationFinished(() => {
    clearInterval(timer);
    if (active) progress.stop("Installation interrupted", 1);
  });
  function track(message: string) {
    clearInterval(timer);
    logInstallation(message);
    const started = Date.now();
    timer = setInterval(() => progress.message(`${message} (${Math.floor((Date.now() - started) / 1000)}s)`), 1_000);
    timer.unref();
  }
  return {
    start(message: string) { active = true; progress.start(message); track(message); },
    message(message: string) { progress.message(message); track(message); },
    stop(message?: string, code?: number) {
      clearInterval(timer);
      active = false;
      if (message) logInstallation(message);
      if (code === undefined) progress.stop(message);
      else progress.stop(message, code);
    },
  };
}
