import { isCancel, password, text } from "@clack/prompts";
import { readInstallationConfig, readInstallationSecrets } from "./config.js";
import { verifyConnection } from "./connection-check.js";
import { runtimePaths } from "./paths.js";

export async function resetPassword(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Password recovery requires an interactive terminal.");
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
  const email = await text({
    message: "Account email",
    validate: (value) =>
      value?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim())
        ? undefined
        : "Enter the account email address.",
  });
  if (isCancel(email)) return;
  const newPassword = await password({
    message: "New password",
    mask: "•",
    validate: (value) =>
      value && value.length >= 8 && value.length <= 128
        ? undefined
        : "Use between 8 and 128 characters.",
  });
  if (isCancel(newPassword)) return;
  const confirmation = await password({
    message: "Confirm new password",
    mask: "•",
    validate: (value) =>
      value === newPassword ? undefined : "Passwords do not match.",
  });
  if (isCancel(confirmation)) return;

  // Recheck routing immediately before sending credentials. Never use publicUrl.
  const changed = await verifyConnection(localUrl, config.instanceId);
  if (changed) throw new Error(`Cannot recover this installation: ${changed}`);
  let response: Response;
  try {
    response = await fetch(
      `${localUrl}/api/internal/management/password-reset`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${managementSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          newPassword,
        }),
      },
    );
  } catch {
    throw new Error(
      "Could not complete password recovery. Check the app with overtchat status before trying again.",
    );
  }
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: "The server rejected the email or password. Check the account email and password requirements.",
      401: "The management secret was rejected. Run overtchat setup to repair it.",
      404: "Account or recovery endpoint not found. Check the email and update the server if needed.",
      409: "This account does not use a password.",
    };
    throw new Error(
      messages[response.status] ??
        `Password recovery failed (HTTP ${response.status}).`,
    );
  }
  const result = (await response.json().catch(() => null)) as {
    status?: boolean;
  } | null;
  if (result?.status !== true)
    throw new Error("The server did not confirm password recovery.");
  console.log(
    "Password reset. All of this account's sessions have been signed out. Sign in with the new password.",
  );
}
