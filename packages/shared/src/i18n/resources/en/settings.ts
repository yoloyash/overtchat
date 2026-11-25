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
} as const;
