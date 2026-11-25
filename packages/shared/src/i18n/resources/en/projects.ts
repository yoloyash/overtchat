export const projects = {
  loading: "Loading…",
  settingsLabel: "Project settings",
  nameInputLabel: "Project name",
  renameTitle: "Rename project",
  actionsLabel: "Project actions",
  deleteProject: "Delete project",
  actions: {
    rename: "Rename",
    delete: "Delete",
    deleting: "Deleting…",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    tryAgain: "Try again",
  },
  deleteDialog: {
    title: "Delete project?",
    description:
      "<name>{{name}}</name> will be deleted. Chats inside it will move to your main list.",
  },
  toast: {
    renameError: "Failed to rename project",
    deletedTitle: "Project deleted",
    deletedDescription: "Chats from the project moved to your main list.",
  },
  errors: {
    renameFallback: "The project name was not changed.",
    deleteFallback: "Failed to delete project.",
  },
  chats: {
    heading: "Chats",
    untitled: "Untitled",
    filterPlaceholder: "Filter chats",
    empty: {
      title: "No chats yet",
      description:
        "Start a conversation above. Chats here share this project's instructions and default model.",
      noMatches: "No chats match <query>{{query}}</query>.",
    },
    renameInputLabel: "Chat title",
    pinned: "Pinned",
    responding: "Responding…",
    actionsLabel: "Actions for {{title}}",
    removeFromProject: "Remove from project",
    deleteDialog: {
      title: "Delete chat?",
      description: "<title>{{title}}</title> will be permanently deleted.",
    },
    toast: {
      deleted: "Chat deleted",
      renameError: "Failed to rename chat",
      removedTitle: "Removed from project",
      removedDescription: "The chat moved to your main list.",
      moveError: "Failed to move chat",
    },
    errors: {
      deleteFailed: "Failed to delete",
      renameFallback: "The chat title was not changed.",
      moveFallback: "The chat stayed where it was.",
    },
  },
  files: {
    sectionLabel: "Project files",
    title: "Files",
    description: "Reference material the model can read in every chat here.",
    addFiles: "Add files",
    inputLabel: "Project files to add",
    loadError: "Could not load the project files.",
    listLabel: "Files",
    pages_one: "{{count}} page",
    pages_other: "{{count}} pages",
    fromChat: "from <chatLink>{{chat}}</chatLink>",
    fromUnnamedChat: "from <chatLink>a chat</chatLink>",
    removeFileLabel: "Remove {{filename}} from project",
    removeFromProject: "Remove from project",
    uploading: "Uploading…",
    footer:
      "{{used}} of {{max}} files. The model reads and searches them with the file tools when a question needs them.",
    toast: {
      limitTitle_one: "A project holds up to {{count}} file",
      limitTitle_other: "A project holds up to {{count}} files",
      limitPartial_one: "Only the first {{count}} selected file was added.",
      limitPartial_other: "Only the first {{count}} selected files were added.",
      limitFull: "Remove a file to add another.",
      addError: "Could not add {{filename}}",
      removeError: "Could not remove {{filename}}",
    },
    errors: {
      addFallback: "The file was not added.",
      removeFallback: "The file is still in the project.",
    },
  },
  instructions: {
    title: "Instructions",
    description: "Added to every chat in this project.",
    edit: "Edit instructions",
    add: "Add instructions",
    dialogTitle: "Project instructions",
    dialogDescription:
      "Tell the model how to respond in {{name}}: context, tone, or preferences it should always follow.",
    placeholder:
      "e.g. Always respond in concise bullet points. Assume the reader is a senior engineer.",
    unsavedChanges: "Unsaved changes",
    toast: {
      saved: "Instructions saved",
      saveError: "Failed to save instructions",
    },
    errors: {
      saveFallback: "The project instructions were not changed.",
    },
  },
  model: {
    title: "Default model",
    description: "New chats in this project start with this model.",
    accountDefault: "Account default",
    noModels: "No models configured",
    unavailable:
      "The selected model is unavailable, so new chats use your account default.",
    toast: {
      changeError: "Failed to change the default model",
    },
    errors: {
      changeFallback: "Please try again.",
    },
  },
  saveToProject: {
    inProject: "In project",
    saveToProject: "Save to project",
    inProjectTitle: "In {{project}}. Save again to replace or keep both.",
    saveToProjectTitle: "Save to {{project}}",
    conflictDialog: {
      title: "Replace {{filename}}?",
      description:
        "<project>{{project}}</project> already has a file with this name. Replacing keeps past chats as they are; keeping both gives the new file a numbered name.",
      keepBoth: "Keep both",
      replace: "Replace",
    },
    toast: {
      alreadyInProject: "Already in {{project}}",
      savedToProject: "Saved to {{project}}",
      openProject: "Open project",
      saveError: "Could not save {{filename}}",
    },
    errors: {
      uploadFailed: "Upload failed ({{status}})",
      saveFallback: "The file was not added to the project.",
    },
  },
} as const;
