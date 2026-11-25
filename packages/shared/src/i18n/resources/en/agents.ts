export const agents = {
  refresh: {
    failedTitle: "Sessions could not be refreshed",
    failedFallback: "Refresh failed.",
    partialTitle: "Sessions refreshed with some errors",
    successTitle: "Sessions refreshed",
    synced_one: "{{count}} agent workspace synced.",
    synced_other: "{{count}} agent workspaces synced.",
    syncedWithFailures_one: "{{count}} agent workspace synced; {{failed}} failed.",
    syncedWithFailures_other: "{{count}} agent workspaces synced; {{failed}} failed.",
  },
} as const;
