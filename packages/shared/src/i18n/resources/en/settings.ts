export const settings = {
  general: {
    title: "General",
    description: "Preferences saved for this browser.",
    messages: {
      title: "Messages",
      description: "Choose which details appear in your conversations.",
      expandActivity: {
        title: "Expand thinking and tools",
        description: "Open each reply's thinking and tool steps without a click.",
      },
      messageStats: {
        title: "Message stats",
        description: "Show token counts and speed stats on assistant messages.",
        toggle: "Show message stats",
      },
      contextMeter: {
        title: "Context meter",
        description: "Show context-window usage in the chat header.",
        toggle: "Show context meter",
      },
      sessionCost: {
        title: "Session cost",
        description: "Show session cost in the chat header.",
        toggle: "Show session cost",
      },
    },
  },
  appearance: {
    title: "Appearance",
    description: "Choose how OvertChat looks and reads.",
    display: {
      title: "Display",
      description: "Saved on this device.",
    },
    theme: {
      title: "Theme",
      description: "Use a fixed theme or follow the system setting.",
      light: "Light",
      dark: "Dark",
      system: "System",
    },
    accent: {
      title: "Accent color",
      description: "Tint the interface on this device. Olive is the default.",
    },
    font: {
      title: "Interface font",
      description: "Choose the font used throughout the app.",
      system: "System",
    },
    language: {
      title: "Language",
      description: "Choose the language of the interface on this device.",
      system: "System",
    },
  },
  alerts: {
    title: "Alerts",
    description:
      "When a chat reply is ready in the background. Only on this device, and only while OvertChat is open.",
    descriptionWithAgents:
      "When a chat reply is ready in the background, and when an agent needs you, finishes or fails. Only on this device, and only while OvertChat is open; otherwise your phone is told.",
    sound: {
      title: "Play a sound",
      description: "A short chime when a reply is done.",
      descriptionWithAgents:
        "A short chime: rising when an agent needs you, falling when it or a reply is done.",
    },
    system: {
      title: "System notifications",
      description: "Shown while the window is in the background.",
      descriptionWithAgents:
        "Shown while the window is in the background. In front, agent alerts appear in the corner instead.",
      unsupported:
        "System notifications need a supported browser over HTTPS, or the desktop app.",
      blocked:
        "Allow notifications for this site in your browser or system settings, then turn this on again.",
    },
  },
  nav: {
    ariaLabel: "Settings",
    pageSelectLabel: "Settings page",
    groups: {
      preferences: "Preferences",
      account: "Account",
      administration: "Administration",
    },
    items: {
      general: "General",
      personalization: "Personalization",
      tools: "Tools",
      profile: "Profile",
      security: "Security",
      data: "Data",
      models: "Models",
      services: "Services",
      agents: "Agents",
      users: "Users",
    },
  },
  pairs: {
    keyLabel: "{{label}} key {{index}}",
    valueLabel: "{{label}} value {{index}}",
  },
  mobile: {
    common: {
      back: "Back",
      openInBrowser: "Open in browser",
    },
    unsaved: {
      title: "Discard changes?",
      message: "Your changes haven’t been saved.",
      keepEditing: "Keep editing",
      discard: "Discard",
    },
    errors: {
      requestFailed: "Couldn’t complete the request.",
      openBrowserFailed: "Couldn’t open browser",
      adminRequired: "Administrator access is required.",
      settingUnavailable:
        "This setting is unavailable. Check your server version.",
      serviceNotInstalled:
        "This service is not installed. Run overtchat setup on the server.",
    },
    index: {
      yourProfile: "Your profile",
      chatAndTools: "Chat & tools",
      notifications: "Notifications",
      dataAndBackups: "Data & backups",
      adminDescription: "Changes here affect everyone on this server.",
      agentConnections: "Agent connections",
      appGroup: "App",
      server: "Server",
      about: "About",
      signingOut: "Signing out…",
      signOutFailed: "Couldn’t sign out.",
    },
    about: {
      appVersion: "App version",
      unknown: "Unknown",
      build: "Build",
      development: "Development",
      serverVersion: "Server version",
    },
    server: {
      connectedServer: "Connected server",
      address: "Address",
      openInBrowser: "Open server in browser",
      changeDescription: "Changing servers signs you out on this device.",
      confirmTitle: "Change server?",
      confirmMessage:
        "You’ll be signed out on this device before choosing another server.",
    },
    chat: {
      messagesDescription: "Display preferences for this device.",
      expandActivityDetail:
        "Open each reply's thinking and tool steps without a tap.",
      messageStatsDetail: "Token counts and generation speed below responses.",
      contextMeterDetail: "Context-window ring in the chat header.",
      sessionCostDetail:
        "Recorded cost in the usage details, when pricing is available.",
    },
    notifications: {
      responsesTitle: "Responses",
      responsesDescription: "For this device and account on this server.",
      chatResponsesTitle: "Chat responses",
      chatResponsesDetail: "When a saved chat response is ready.",
      agentActivityTitle: "Agent activity",
      agentActivityDetail:
        "When an agent needs an approval or an answer, finishes, or fails.",
      signInRequestsTitle: "Sign-in requests",
      signInRequestsDetail:
        "Approve sign-ins to your account from this phone instead of typing a code.",
      privacyTitle: "Privacy",
      showPreviewsTitle: "Show previews",
      showPreviewsDetail:
        "Include chat text, agent session names, what agents ask or reply, and the browser or app signing in. Previews pass through Expo and Apple or Google and may appear on your lock screen.",
      phoneSettingsTitle: "Phone notification settings",
      phoneSettingsDetail: "Permission, sounds, and lock-screen visibility",
    },
    appearance: {
      searchFont: "Search interface font",
      searchLanguage: "Search language",
    },
  },
} as const;
