import { cancel, isCancel, note, select, text } from "@clack/prompts";
import {
  CloudError,
  checkNameAvailability,
  claimName,
  fetchAccount,
  linkServer,
  requestDeviceCode,
  signOut,
  waitForApproval,
  type CloudClientOptions,
} from "./cloud.js";
import { installationSpinner as spinner } from "./install-progress.js";
import { protectInstallationSecrets } from "./install-log.js";
import { runCommand } from "./process.js";
import type { CloudAccess } from "./types.js";

const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/u;

function chosen<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    process.exit(130);
  }
  return value;
}

// Only open a browser where one can appear; on a headless server xdg-open may
// start a terminal browser over the setup prompts.
async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.env.DISPLAY || process.env.WAYLAND_DISPLAY
        ? "xdg-open"
        : undefined;
  if (command) await runCommand(command, [url], { timeoutMs: 5_000 }).catch(() => undefined);
}

function nameValidation(value: string | undefined): string | undefined {
  const name = value?.trim().toLowerCase() ?? "";
  if (name.length < 3 || name.length > 30) return "Use 3–30 characters.";
  if (!NAME_PATTERN.test(name) || name.includes("--")) {
    return "Use lowercase letters, numbers, and single hyphens, starting and ending with a letter or number.";
  }
  return undefined;
}

async function chooseName(token: string, options: CloudClientOptions): Promise<string | null> {
  for (;;) {
    const name = chosen(
      await text({
        message: "Choose your address (it can't be changed later)",
        placeholder: "smiths",
        validate: nameValidation,
      }),
    )
      .trim()
      .toLowerCase();
    const availability = await checkNameAvailability(token, name, options);
    if (!availability.available) {
      note(availability.reason, `${name} is not available`);
      continue;
    }
    try {
      await claimName(token, availability.name, options);
      return availability.name;
    } catch (error) {
      if (error instanceof CloudError && error.code === "full") {
        note("All founder spots are taken for now.", "OvertChat Cloud");
        return null;
      }
      if (error instanceof CloudError && error.code === "taken") {
        note("Someone just claimed that name. Choose another.", `${name} is not available`);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Signs in to OvertChat Cloud and links this server. Returns the relay
 * connection with a new credential, or null to choose another access option.
 */
export async function promptCloudLink(
  current: CloudAccess | undefined,
  options: CloudClientOptions = {},
): Promise<CloudAccess | null> {
  if (current) {
    const action = chosen(
      await select({
        message: "OvertChat Cloud",
        options: [
          { value: "keep", label: `Keep using https://${current.hostname}` },
          { value: "link", label: "Sign in and link this server again", hint: "issues a new credential" },
          { value: "back", label: "Choose another access option" },
        ],
      }),
    );
    if (action === "keep") return { ...current, credential: undefined };
    if (action === "back") return null;
  }
  for (;;) {
    try {
      const authorization = await requestDeviceCode(options);
      note(
        `Open ${authorization.verificationUriComplete}\non any device, sign in with Google, and confirm this code:\n\n    ${authorization.userCode.replace(/^(.{4})(.{4})$/u, "$1-$2")}`,
        "Link this server to OvertChat Cloud",
      );
      await openBrowser(authorization.verificationUriComplete);
      const progress = spinner();
      progress.start("Waiting for you to confirm the code in your browser");
      let token: string;
      try {
        token = await waitForApproval(authorization, options);
        progress.stop("Signed in to OvertChat Cloud");
      } catch (error) {
        progress.stop("Sign-in did not finish", 1);
        throw error;
      }
      try {
        const account = await fetchAccount(token, options);
        if (account.instance?.disabled) {
          throw new CloudError("This account's address is turned off. Contact support@overtchat.com.");
        }
        if (!account.instance) {
          if (account.spots.remaining === 0) {
            note("All founder spots are taken for now. Choose another access option.", "OvertChat Cloud");
            return null;
          }
          if (!(await chooseName(token, options))) return null;
        }
        const link = await linkServer(token, options);
        protectInstallationSecrets(link.credential);
        return {
          hostname: link.instance.hostname,
          relayHost: link.relay.host,
          relayPort: link.relay.port,
          relayServerName: link.relay.serverName,
          relayCaPem: link.relay.caPem,
          credential: link.credential,
        };
      } finally {
        await signOut(token, options);
      }
    } catch (error) {
      note(error instanceof Error ? error.message : String(error), "OvertChat Cloud");
      const action = chosen(
        await select({
          message: "Continue with OvertChat Cloud?",
          options: [
            { value: "retry", label: "Try again" },
            { value: "back", label: "Choose another access option" },
          ],
        }),
      );
      if (action === "back") return null;
    }
  }
}
