import { isCancel, password } from "@clack/prompts";
import { promptAccountEmail, recoveryTarget, sendRecovery } from "./recovery.js";

export async function resetPassword(): Promise<void> {
  const target = await recoveryTarget("Password recovery");
  const email = await promptAccountEmail();
  if (email === null) return;
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

  await sendRecovery(
    target,
    "/api/internal/management/password-reset",
    { email, newPassword },
    {
      action: "password recovery",
      messages: {
        400: "The server rejected the email or password. Check the account email and password requirements.",
        404: "Account or recovery endpoint not found. Check the email and update the server if needed.",
        409: "This account does not use a password.",
      },
    },
  );
  console.log(
    "Password reset. All of this account's sessions have been signed out. Sign in with the new password.",
  );
}
