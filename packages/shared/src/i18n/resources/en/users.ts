export const users = {
  page: {
    title: "Users",
    description: "Manage who can sign in to this server.",
    addUser: "Add user",
  },
  list: {
    title: "People",
    configured_one: "{{count}} user configured.",
    configured_other: "{{count}} users configured.",
    columns: {
      name: "Name",
      email: "Email",
      role: "Role",
      twoFactor: "Two-factor",
      created: "Created",
      actions: "Actions",
    },
    roleForLabel: "Role for {{email}}",
    twoFactorOn: "On",
    twoFactorOff: "Off",
    currentUser: "Current user",
    resetPassword: "Reset password",
    resetTwoFactor: "Reset two-factor",
    delete: "Delete",
  },
  roles: {
    user: "User",
    admin: "Admin",
  },
  toast: {
    deletedTitle: "User deleted",
    deleteErrorFallback: "Failed to delete user.",
    adminGrantedTitle: "Administrator access granted",
    adminRemovedTitle: "Administrator access removed",
    roleChangeErrorFallback: "The role could not be changed.",
    createdTitle: "User created",
    createErrorFallback: "Failed to create user",
    passwordResetTitle: "Password reset",
    passwordResetDescription: "{{email}} has been signed out on all devices.",
    twoFactorResetTitle: "Two-factor reset",
    twoFactorResetDescription:
      "{{email}} can sign in with their password and set it up again.",
  },
  roleDialog: {
    grantTitle: "Grant administrator access?",
    removeTitle: "Remove administrator access?",
    grantDescription:
      "<email>{{email}}</email> will be able to manage users, models, and agent workspaces, including running code and opening SSH connections from this server. They will be signed out on all devices.",
    removeDescription:
      "<email>{{email}}</email> will lose administrator features. Their active agent runs will stop. They will be signed out on all devices.",
    cancel: "Cancel",
    updating: "Updating…",
    makeAdmin: "Make admin",
    makeUser: "Make user",
  },
  deleteDialog: {
    title: "Delete user?",
    description:
      "<email>{{email}}</email> will no longer be able to sign in. Existing chats and projects are not deleted.",
    deleting: "Deleting…",
  },
  addDialog: {
    ssoDescription: "They sign in with {{provider}}, using this email address.",
    passwordDescription:
      "Share the password with them out-of-band. They can change it later.",
    passwordLabel: "Password",
    creating: "Creating…",
    create: "Create",
  },
  resetPasswordDialog: {
    description:
      "Set a replacement password for {{email}}. They will be signed out on all devices. Share the password privately; they can change it in Security settings.",
    currentPasswordLabel: "Your current password",
    replacementPasswordLabel: "Replacement password",
    confirmPasswordLabel: "Confirm replacement password",
    mismatchError: "The replacement passwords do not match.",
    errorFallback: "Failed to reset password.",
    networkError:
      "Could not reset the password. Check your connection and try again.",
    resetting: "Resetting…",
  },
  resetTwoFactorDialog: {
    description:
      "Remove {{email}}'s authenticator and backup codes, for example after they lose their phone. They will be signed out on all devices and can set two-factor up again in Security settings.",
    errorFallback: "Failed to reset two-factor.",
    networkError:
      "Could not reset two-factor. Check your connection and try again.",
  },
  mobile: {
    roles: {
      administrator: "Administrator",
    },
    list: {
      searchLabel: "Search people",
      emptyTitle: "No matching people",
      emptyDetail: "Try another name or email address.",
    },
    detail: {
      fallbackTitle: "User",
      notFound: "User no longer exists.",
      roleSelfAdmin: "Administrator · You",
      selfPasswordHint: "Change your own password in Security settings.",
    },
    create: {
      passwordDescription:
        "Share the initial password privately. They can change it in Security settings.",
      initialPasswordLabel: "Initial password",
      submit: "Create user",
      backToUsers: "Back to users",
      errors: {
        nameAndEmailRequired: "Enter a name and email address.",
        invalidPasswordLength: "Use an initial password of 8–128 characters.",
        createFailed: "Couldn’t create user.",
      },
    },
    roleDialog: {
      grantMessage:
        "{{email}} will be able to manage this server, users, and coding agents. They will be signed out on all devices.",
      removeMessage:
        "{{email}} will lose administrator features, their active agent runs will stop, and they will be signed out on all devices.",
      confirm: "Change role",
      updated: "Role updated",
    },
    resetPassword: {
      description:
        "This signs the user out on all devices. Share the replacement password privately.",
      submit: "Reset user password",
      errors: {
        invalidLength: "Use a password of 8–128 characters.",
        mismatch: "Replacement passwords do not match.",
        failed: "Couldn’t reset password.",
      },
    },
    deleteDialog: {
      action: "Delete user",
      message:
        "{{email}} will no longer be able to sign in. Existing chats and projects are not deleted.",
      failed: "Couldn’t delete user.",
    },
  },
} as const;
