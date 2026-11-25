export const services = {
  page: {
    title: "Services",
    description:
      "Manage search and speech providers for this server. Local services are installed with overtchat setup.",
    loading: "Loading services…",
    loadError: "Could not load server services.",
  },
  capabilities: {
    search: {
      title: "Web search",
      description: "Choose the first provider OvertChat tries.",
      providerLabel: "Web search provider",
      updatedTitle: "Web search updated",
      updateErrorTitle: "Could not update web search",
      providers: {
        bundled: "Bundled SearXNG",
        brave: "Brave Search API",
        searxng: "Existing SearXNG",
        disabled: "Disabled",
      },
    },
    tts: {
      title: "Text-to-speech",
      description: "Choose the provider used by everyone on this server.",
      providerLabel: "Text-to-speech provider",
      updatedTitle: "Text-to-speech updated",
      updateErrorTitle: "Could not update text-to-speech",
      providers: {
        bundled: "Bundled Kokoro",
        "openai-compatible": "OpenAI-compatible API",
        disabled: "Disabled",
      },
    },
    stt: {
      title: "Speech-to-text",
      description: "Choose the provider used by everyone on this server.",
      providerLabel: "Speech-to-text provider",
      updatedTitle: "Speech-to-text updated",
      updateErrorTitle: "Could not update speech-to-text",
      providers: {
        bundled: "Bundled Parakeet",
        "openai-compatible": "OpenAI-compatible API",
        disabled: "Disabled",
      },
    },
  },
  fields: {
    providerTitle: "Provider",
    bundledMissingDescription:
      "{{provider}} is not installed on this server. Run: overtchat setup",
    providerOptionNotInstalled: "{{provider}} — Not installed",
    apiBaseUrlTitle: "API base URL",
    apiKeyTitle: "API key",
    apiKeyConfiguredDescription:
      "A key is configured. Leave this blank to keep it.",
    searchOrderTitle: "Search order",
    searchOrderDescription:
      "If your primary provider fails, OvertChat tries free search providers.",
    modelTitle: "Model",
    defaultVoiceTitle: "Default voice",
  },
  actions: {
    testing: "Testing…",
    testConnection: "Test connection",
    saving: "Saving…",
    save: "Save",
  },
  errors: {
    updateUnchanged: "The provider was not changed.",
    connectFailed: "Could not connect to the provider.",
    loadCapabilitiesFailed: "Could not load server capabilities.",
    serviceRequestFailed: "Could not complete the service request.",
  },
  voice: {
    title: "Realtime voice",
    description:
      "Live, interruptible conversations using the speech providers above and the selected chat model.",
    statusTitle: "Status",
    configuredLabel: "Configured",
    configuredDescription:
      "Realtime voice conversations are available on this server.",
    notInstalledLabel: "Not installed",
    notInstalledDescription:
      "Run overtchat setup and enable realtime voice conversations.",
    needsSttLabel: "Needs speech-to-text",
    needsSttDescription: "Choose a speech-to-text provider above.",
    needsTtsLabel: "Needs text-to-speech",
    needsTtsDescription: "Choose a text-to-speech provider above.",
    incompleteSetupLabel: "Incomplete setup",
    incompleteSetupDescription:
      "Run overtchat setup to repair the realtime voice configuration.",
  },
  mobile: {
    list: {
      sectionTitle: "Server services",
      sectionDescription: "These providers are used by everyone on this server.",
    },
    status: {
      needsSetup: "Needs setup",
      unavailable: "Unavailable",
    },
    voice: {
      rowTitle: "Voice conversations",
      readyDetail: "Ready for live voice conversations.",
      unavailableDetail:
        "Requires installed realtime voice and configured speech providers. Run overtchat setup on the host to install or repair it.",
    },
    detail: {
      fallbackTitle: "Service",
      notFound: "Service not found.",
      providerDescription: "Changes affect everyone on this server.",
      notInstalledDetail:
        "Run overtchat setup on the server to install this service.",
      apiKeySavedHint: "A key is saved. Leave blank to keep it.",
      apiKeyEmptyHint: "Enter your provider key.",
      searchFallbackNote:
        "When the primary search provider fails, OvertChat tries free search providers.",
      save: "Save service",
      saved: "Service saved",
    },
  },
} as const;
