export const account = {
  title: "Security",
  signedInAs: "Signed in as <email>{{email}}</email>.",
  sso: {
    title: "Sign-in",
    descriptionWithProvider:
      "You sign in with {{provider}}. Your password and sign-in protection are managed there.",
    descriptionDefault:
      "You sign in with your identity provider. Your password and sign-in protection are managed there.",
  },
  password: {
    title: "Password",
    description: "Changing your password signs you out of all other sessions.",
    currentLabel: "Current password",
    newLabel: "New password",
    newDescription: "Use at least 8 characters.",
    updated: "Password updated",
    submit: "Change password",
    changeFailed: "Failed to change password",
  },
  twoFactor: {
    title: "Two-factor authentication",
    descriptionRequired: "Administrators on this server must use two-factor authentication.",
    descriptionRecommended:
      "Recommended. After your password, sign-in also asks for a code from an authenticator app.",
    statusTitle: "Status",
    loadError: "Could not load two-factor status.",
    backupCodesIntro: "Your old backup codes no longer work. Save these somewhere safe.",
    authenticatorTitle: "Authenticator app",
    enabledDescription:
      "On. When you sign in somewhere new, you can also approve it from a device where you're already signed in. Keep your backup codes somewhere safe in case you lose your device.",
    newBackupCodes: "New backup codes",
    turnOff: "Turn off",
    enabledToast: "Two-factor authentication is on",
    off: "Off",
    setUp: "Set up",
    disabledToast: "Two-factor authentication is off",
    confirm: {
      passwordLabel: "Your password",
      backupCodes: {
        title: "New backup codes",
        description: "Your current backup codes will stop working.",
        submit: "Create new codes",
        pending: "Creating…",
        error: "Could not create backup codes.",
      },
      disable: {
        title: "Turn off two-factor",
        description:
          "Signing in will only need your password. Your authenticator entry and backup codes stop working.",
        submit: "Turn off",
        pending: "Turning off…",
        error: "Could not turn off two-factor.",
      },
    },
  },
  mobile: {
    sso: {
      defaultProvider: "your identity provider",
      description: "Your password and sign-in protection are managed there.",
      signedInWith: "You sign in with",
    },
    password: {
      newHint: "Use 8–128 characters.",
      confirmLabel: "Confirm new password",
      errors: {
        currentRequired: "Enter your current password.",
        invalidLength: "Use 8–128 characters for your new password.",
        mismatch: "The new passwords do not match.",
        changeFailed: "Couldn’t change password.",
      },
    },
    twoFactor: {
      on: "On",
      manageTitle: "Manage two-factor",
      manageDetail: "Set up or turn off an authenticator app in your browser.",
    },
    emailLabel: "Email",
  },
} as const;
