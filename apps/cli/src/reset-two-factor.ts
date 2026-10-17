import { promptAccountEmail, recoveryTarget, sendRecovery } from "./recovery.js";

/** Removes an account's authenticator when it's lost, for example an administrator's. */
export async function resetTwoFactor(): Promise<void> {
  const target = await recoveryTarget("Two-factor recovery");
  const email = await promptAccountEmail();
  if (email === null) return;
  await sendRecovery(
    target,
    "/api/internal/management/two-factor-reset",
    { email },
    {
      action: "two-factor recovery",
      messages: {
        400: "The server rejected the email. Check the account email.",
        404: "Account or recovery endpoint not found. Check the email and update the server if needed.",
        409: "This account doesn't use two-factor authentication.",
      },
    },
  );
  console.log(
    "Two-factor removed. All of this account's sessions have been signed out. Sign in with the password, then set up two-factor again.",
  );
}
