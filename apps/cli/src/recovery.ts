import { isCancel, text } from "@clack/prompts";
import { readInstallationConfig, readInstallationSecrets } from "./config.js";
import { verifyConnection } from "./connection-check.js";
import { runtimePaths } from "./paths.js";

/** The verified local app that operator recovery talks to. */
export type RecoveryTarget = {
  localUrl: string;
  instanceId: string | undefined;
  managementSecret: string;
};

/**
 * Finds this machine's managed installation and confirms the local port serves
 * it. Recovery never goes to the public URL.
 */
export async function recoveryTarget(action: string): Promise<RecoveryTarget> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${action} requires an interactive terminal.`);
  }
  const paths = runtimePaths();
  const config = await readInstallationConfig(paths);
  if (!config) {
    throw new Error(
      "No managed installation found. See https://github.com/yoloyash/overtchat/blob/main/docs/deploy.md#password-recovery for manual installations.",
    );
  }
  const localUrl = `http://127.0.0.1:${config.appPort}`;
  const problem = await verifyConnection(localUrl, config.instanceId);
  if (problem) throw new Error(`Cannot recover this installation: ${problem}`);
  const { managementSecret } = await readInstallationSecrets(paths);
  if (!managementSecret || managementSecret.length < 32) {
    throw new Error(
      "The installation has no management secret. Run overtchat setup to repair it.",
    );
  }
  return { localUrl, instanceId: config.instanceId, managementSecret };
}

/** Prompts for the account email; null when the operator cancels. */
export async function promptAccountEmail(): Promise<string | null> {
  const email = await text({
    message: "Account email",
    validate: (value) =>
      value?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim())
        ? undefined
        : "Enter the account email address.",
  });
  return isCancel(email) ? null : email.trim().toLowerCase();
}

/**
 * Sends a management recovery request after rechecking the installation, and
 * maps failures to `messages` by HTTP status.
 */
export async function sendRecovery(
  target: RecoveryTarget,
  path: string,
  body: unknown,
  copy: { action: string; messages: Record<number, string> },
): Promise<void> {
  // Recheck routing immediately before sending credentials. Never use publicUrl.
  const changed = await verifyConnection(target.localUrl, target.instanceId);
  if (changed) throw new Error(`Cannot recover this installation: ${changed}`);
  let response: Response;
  try {
    response = await fetch(`${target.localUrl}${path}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${target.managementSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `Could not complete ${copy.action}. Check the app with overtchat status before trying again.`,
    );
  }
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "The management secret was rejected. Run overtchat setup to repair it.",
      ...copy.messages,
    };
    const action = copy.action[0]!.toUpperCase() + copy.action.slice(1);
    throw new Error(
      messages[response.status] ??
        `${action} failed (HTTP ${response.status}).`,
    );
  }
  const result = (await response.json().catch(() => null)) as {
    status?: boolean;
  } | null;
  if (result?.status !== true)
    throw new Error(`The server did not confirm ${copy.action}.`);
}
