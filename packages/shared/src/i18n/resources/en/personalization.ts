export const personalization = {
  title: "Personalization",
  description:
    "Tell OvertChat about you and manage what it remembers between chats.",
  loading: "Loading personalization…",
  loadError: "Unable to load personalization.",
  profile: {
    title: "About you",
    description:
      "These fields can only be changed here. Empty fields are not added to model context.",
    enabled: {
      title: "Use personalization",
      description:
        "Include your profile and saved memories in chats, and allow models to manage memory when asked. Temporary chats never use personalization.",
    },
    preferredName: {
      title: "Preferred name",
      description: "What should OvertChat call you?",
    },
    occupation: {
      title: "Occupation",
    },
    about: {
      title: "More about you",
      description: "Interests, values, or preferences to keep in mind.",
    },
    optionalPlaceholder: "Optional",
    save: "Save",
    saving: "Saving…",
    savedToast: "Personalization saved",
    saveError: "Failed to save personalization.",
  },
  memories: {
    title: "Saved memories",
    description:
      "Models can add, update, or remove these entries when you explicitly ask them to remember or forget something. Your profile and memories share a 4 KiB context budget.",
    usageTooltip:
      "{{bytes}} of {{limit}} context bytes, including profile · {{entries}} of {{entryLimit}} memories",
    usageBadge: "{{percent}}% used",
    clearedToast: "Memories cleared",
    add: "Add memory",
    searchPlaceholder: "Search memories",
    emptyTitle: "Nothing remembered yet",
    emptyDescription:
      "Ask OvertChat to remember something, or add it manually.",
    noMatches: "No memories match <query>{{query}}</query>.",
    updated: "Updated {{date}}",
    editAriaLabel: "Edit {{key}}",
    editTitle: "Edit memory",
    dialog: {
      editTitle: "Edit memory",
      addTitle: "Add memory",
      description:
        "Saved memories are included in future chats when personalization is on.",
      valueLabel: "What should OvertChat remember?",
      valueAriaLabel: "Memory value",
      valuePlaceholder: "Prefer concise answers.",
      keyLabel: "Label",
      keyAriaLabel: "Memory key",
      keyHint:
        "Used to update this memory later. Start with a letter and use lowercase letters, numbers, or underscores.",
      cancel: "Cancel",
      saving: "Saving…",
      saveChanges: "Save changes",
      addSubmit: "Add memory",
      updatedToast: "Memory updated",
      addedToast: "Memory added",
      updateError: "Failed to update memory.",
      addError: "Failed to add memory.",
    },
    deleteDialog: {
      ariaLabel: "Delete {{key}}",
      buttonTitle: "Delete memory",
      title: "Delete this memory?",
      description:
        "OvertChat will no longer include it in future conversations.",
      cancel: "Cancel",
      deleting: "Deleting…",
      confirm: "Delete",
      deletedToast: "Memory deleted",
      error: "Failed to delete memory.",
    },
    clearDialog: {
      trigger: "Clear all",
      title: "Clear all memories?",
      description:
        "This permanently deletes every saved memory. Your profile fields are not affected.",
      cancel: "Cancel",
      clearing: "Clearing…",
      confirm: "Clear all",
      error: "Failed to clear memories.",
    },
  },
  mobile: {
    openOnWeb: "Open on web",
    profile: {
      description: "Empty fields are not added to model context.",
      enabledDescription:
        "Include your profile and memories in chats, and allow models to manage memory when asked. Temporary chats never use it.",
      saveError: "Couldn't save personalization.",
      saveLabel: "Save personalization",
    },
    memories: {
      description:
        "Models can change these entries when you explicitly ask them to remember or forget something. Your profile and memories share a 4 KiB context budget.",
      deleteError: "Couldn't delete memory",
      clearError: "Couldn't clear memories",
      usageAccessibility:
        "{{percent}}% used, {{bytes}} of {{limit}} context bytes, {{entries}} of {{entryLimit}} memories",
      usageDetail:
        "{{bytes}} of {{limit}} bytes · {{entries}} of {{entryLimit}} memories",
      clearAllLabel: "Clear all memories",
      addShort: "Add",
      noMatches: "No memories match “{{query}}”.",
      saveError: "Couldn't save memory.",
      keyHint:
        "Start with a letter and use lowercase letters, numbers, or underscores.",
    },
  },
} as const;
