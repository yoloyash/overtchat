export const profile = {
  title: "Profile",
  description: "Choose how you appear to other people on this server.",
  viewActivity: "View activity profile",
  identity: {
    title: "Identity",
    description: "Your profile is visible on the leaderboard and activity pages.",
  },
  preview: {
    title: "Preview",
    description: "This updates as you edit.",
    subtitle: "Activity profile",
  },
  displayName: {
    title: "Display name",
    description: "Use the name people should recognize.",
  },
  avatarUrl: {
    title: "Avatar URL",
    description: "Optional. Use a direct link to an image.",
  },
  updated: "Profile updated",
  saving: "Saving…",
  save: "Save profile",
  errors: {
    nameRequired: "Display name is required.",
    invalidAvatarUrl: "Avatar URL must start with http:// or https://.",
    updateFailed: "Failed to update profile.",
  },
} as const;
