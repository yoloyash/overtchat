import {
  cancel,
  confirm,
  isCancel,
  note,
  password,
  select,
  text,
} from "@clack/prompts";
import {
  checkIssuer,
  identityProviderRedirect,
  issuerValidation,
  normalizeIssuer,
} from "./identity-provider.js";
import type { IdentityProviderConfig } from "./types.js";

function chosen<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Setup cancelled. Nothing was changed.");
    process.exit(130);
  }
  return value;
}

export type IdentityProviderPromptOptions = {
  /** The address people open, which the provider redirects back to. */
  publicUrl: string;
  /** A client secret is already saved, so the question may be left blank. */
  secretStored: boolean;
  check?: typeof checkIssuer;
};

/**
 * Asks whether people sign in through the operator's OpenID Connect provider.
 * Undefined means they don't: only passwords, as before the question existed.
 */
export async function promptIdentityProvider(
  current: IdentityProviderConfig | undefined,
  { publicUrl, secretStored, check = checkIssuer }: IdentityProviderPromptOptions,
): Promise<IdentityProviderConfig | undefined> {
  note(
    "People can sign in through an identity provider you already run, such as Authentik, Keycloak or Pocket ID, instead of keeping a separate password here.",
    "Sign in with an identity provider",
  );
  const choice = chosen(
    await select<"later" | "keep" | "configure" | "off">({
      message: "Sign in with an identity provider?",
      initialValue: current ? "keep" : "later",
      options: current
        ? [
            { value: "keep", label: `Keep ${current.name}` },
            { value: "configure", label: "Change its settings" },
            {
              value: "off",
              label: "Turn it off",
              hint: "people sign in with their passwords",
            },
          ]
        : [
            { value: "later", label: "Set up later" },
            {
              value: "configure",
              label: "Set up now",
              hint: "needs the provider's issuer URL and a client for OvertChat",
            },
          ],
    }),
  );
  if (choice === "keep") return current;
  if (choice !== "configure") return undefined;

  note(
    [
      "In the provider, create a web (confidential) client for OvertChat with:",
      "",
      `Redirect address: ${identityProviderRedirect(publicUrl)}`,
      "Scopes: openid, profile, email",
    ].join("\n"),
    "Register OvertChat with the provider",
  );
  let issuerUrl = current?.issuerUrl;
  for (;;) {
    issuerUrl = normalizeIssuer(
      chosen(
        await text({
          message: "Issuer URL",
          placeholder: "https://id.example.com",
          initialValue: issuerUrl,
          validate: issuerValidation,
        }),
      ),
    );
    const problem = await check(issuerUrl);
    if (!problem) break;
    note(
      `Couldn't read the provider's configuration at ${issuerUrl} from this computer: ${problem}. The app has to reach that address as well.`,
      "Provider not reached",
    );
    const keep = chosen(
      await confirm({
        message: "Use this address anyway?",
        initialValue: false,
        active: "Use it",
        inactive: "Enter it again",
      }),
    );
    if (keep) break;
  }
  const clientId = chosen(
    await text({
      message: "Client ID",
      initialValue: current?.clientId,
      validate: (value) => (value?.trim() ? undefined : "Enter the client ID."),
    }),
  );
  const clientSecret = chosen(
    await password({
      message: secretStored
        ? "Client secret (leave blank to keep current)"
        : "Client secret",
      mask: "•",
      validate: (value) =>
        value?.trim() || secretStored ? undefined : "Enter the client secret.",
    }),
  );
  const name = chosen(
    await text({
      message: "Name on the sign-in button",
      placeholder: "Pocket ID",
      initialValue: current?.name,
      validate: (value) =>
        value?.trim() ? undefined : "Enter what to call the provider.",
    }),
  ).trim();
  const newcomers = chosen(
    await select<"refuse" | "create">({
      message: `When someone signs in with ${name} but has no account here?`,
      initialValue: current?.autoCreateUsers ? "create" : "refuse",
      options: [
        {
          value: "refuse",
          label: "Refuse them",
          hint: "add people in Settings → Users first",
        },
        {
          value: "create",
          label: "Create an account for them",
          hint: `anyone who can sign in to ${name} gets in`,
        },
      ],
    }),
  );
  const disablePasswordLogin = chosen(
    await confirm({
      message: "Turn off password sign-in?",
      initialValue: current?.disablePasswordLogin ?? false,
      active: `Yes, only ${name}`,
      inactive: "No, keep passwords",
    }),
  );
  if (disablePasswordLogin) {
    note(
      `Everyone then signs in through ${name}, and needs the current desktop and mobile apps. If it stops working, run overtchat setup again and keep passwords, then sign in with a password. overtchat reset-password gives an administrator one.`,
      "Passwords off",
    );
  }
  return {
    issuerUrl,
    clientId: clientId.trim(),
    name,
    autoCreateUsers: newcomers === "create",
    disablePasswordLogin,
    ...(clientSecret?.trim() ? { clientSecret: clientSecret.trim() } : {}),
  };
}
