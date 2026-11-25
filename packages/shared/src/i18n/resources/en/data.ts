export const data = {
  title: "Data",
  description: "Import chats from other platforms, or export your own.",
  import: {
    title: "Import",
    description:
      "Supports ChatGPT, Claude.ai, OpenWebUI, and overtchat exports.",
    fileTitle: "Import file",
    fileDescription:
      "Choose a downloaded JSON or ZIP file. Imports preserve visible chat text and reasoning, but not attachments, images, or branches.",
    importing: "Importing…",
    chooseFile: "Choose file",
    failedWithStatus: "Import failed ({{status}})",
    failed: "Import failed.",
    completeTitle: "Import complete",
    completeChats_one: "Imported {{count}} chat from {{format}}.",
    completeChats_other: "Imported {{count}} chats from {{format}}.",
    completeWithMemories: "Imported {{chats}} and {{memories}} from {{format}}.",
    chatCount_one: "{{count}} chat",
    chatCount_other: "{{count}} chats",
    memoryCount_one: "{{count}} memory",
    memoryCount_other: "{{count}} memories",
  },
  export: {
    title: "Export",
    description: "Download every chat as a single overtchat JSON file.",
    fileTitle: "Export file",
    fileDescription: "Use this file for backup or a lossless re-import.",
    download: "Download export",
  },
  sharedChats: {
    title: "Shared chats",
    description: "Manage public links to your conversations.",
    loading: "Loading shared chats…",
    updated: "Updated {{date}}",
    unshare: "Unshare",
    empty: "No shared chats.",
  },
  mobile: {
    export: {
      description:
        "Save your chats as an OvertChat JSON file for backup or re-import.",
      action: "Export chats",
      failedWithStatus: "Couldn’t export chats ({{status}}).",
      saved: "Export saved to the selected folder.",
    },
    import: {
      description:
        "ChatGPT, Claude.ai, OpenWebUI, and OvertChat JSON or ZIP exports, up to 50 MB. Visible text and reasoning are preserved; attachments, images, and branches are not imported.",
      chooseFile: "Choose import file",
      tooLarge: "Import files must be 50 MB or smaller.",
      confirmTitle: "Import chats?",
      confirmMessage:
        "Import {{name}} into your account? Importing the same file again may create duplicates.",
      complete: "Imported {{chats}}, {{messages}}, and {{memories}}.",
      messageCount_one: "{{count}} message",
      messageCount_other: "{{count}} messages",
    },
  },
} as const;
