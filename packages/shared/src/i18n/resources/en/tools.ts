export const tools = {
  page: {
    title: "Tools",
    description:
      "Control model capabilities, connect your accounts, and add external tool servers.",
  },
  builtIn: {
    title: "Built-in tools",
    description: "Disabled tools are removed from chat requests.",
    webSearch: {
      title: "Web search",
      description:
        "Allow supported models to search the web and fetch pages. Disabling this also turns off the Search action in chat.",
      toggleLabel: "Enable web search",
    },
  },
  interactiveUi: {
    title: "Interactive UI",
    description:
      "Supported models render interactive charts, tables, forms and cards with OpenUI. On demand tool access is recommended.",
    toolAccessTitle: "Tool access",
    toolAccessDescription:
      "On demand loads the OpenUI instructions when a message calls for an interface, or when you ask for one from the + menu or /openui. Always available adds about 6,800 tokens to every request.",
    toolAccessLabel: "Interactive UI tool access",
  },
  accessChoice: {
    alwaysAvailable: "Always available",
    onDemand: "On demand",
  },
  connectors: {
    title: "Connectors",
    description:
      "Connect your own accounts so models can work with them in your chats. On demand tool access is recommended.",
    loading: "Loading connectors…",
    loadError: "Unable to load connectors.",
    status: {
      signInEnded: "Sign-in ended",
      connected: "Connected",
    },
    google: {
      unconfiguredAdmin:
        "Set up Google access for this server before anyone can connect.",
      unconfiguredUser:
        "Not set up on this server. Ask an administrator to set up Google access.",
      needsReconnect:
        "Google ended access for {{email}}. Reconnect to keep using it.",
      signInOnce: "Sign in once to connect {{services}}.",
      disconnecting: "Disconnecting…",
      disconnect: "Disconnect",
      changeAccess: "Change access",
      reconnect: "Reconnect",
      connect: "Connect",
      accessSettings: "Google access settings",
      setUp: "Set up",
      disconnectedTitle: "Google disconnected",
      disconnectErrorTitle: "Failed to disconnect Google",
      disconnectErrorFallback: "The account is still connected.",
    },
    integrations: {
      gmail: {
        description:
          "Let models search, read and organize your mail, and write emails for you to send.",
        toolAccess:
          "On demand loads the mail skill when a message needs your mail, or when you type /gmail. Always available adds about 1,100 tokens to every request.",
      },
      calendar: {
        description:
          "Let models check your schedule and add, change or delete events.",
        toolAccess:
          "On demand loads the calendar skill when a message needs your schedule, or when you type /calendar. Always available adds about 900 tokens to every request.",
      },
    },
    row: {
      notPartOfSignIn: "Not part of this sign-in.",
      toolAccessLabel: "{{name}} tool access",
      add: "Add",
      sendingTitle: "Sending",
      sendingWithoutAskingDescription:
        "A model can send email as you without asking. Mail it reads can try to trick it into sending.",
      sendingAskFirstDescription: "A model writes an email and you send it.",
      sendingLabel: "{{name}} sending",
      askFirst: "Ask first",
      withoutAsking: "Without asking",
      updateErrorTitle: "Failed to change {{name}}",
      updateErrorFallback: "The setting was not saved.",
    },
    connectGoogle: {
      title: "Connect Google",
      description: "Sign in with Google, then bring the result back here.",
      connectedTitle: "{{services}} connected",
      partialDescription:
        "{{services}} was not allowed on Google's page. Change access to add it.",
      connectErrorFallback: "Could not connect Google. Try again.",
      chooseTitle: "Choose what to connect",
      signInTitle: "Sign in with Google",
      signInInstructions:
        "Allow access, ticking any checkbox Google shows. If Google says it hasn't verified this app, continue anyway. If it says access is blocked, an administrator needs to add your Google address as a test user first.",
      startSignInError: "Could not start the sign-in. Try again.",
      chooseAtLeastOne: "Choose at least one thing to connect.",
      openSignIn: "Open Google sign-in",
      copyAddressTitle: "Copy the address of the page you land on",
      copyAddressDescription:
        "Your browser will show a page that can't be reached. That is expected. Copy its whole address, which starts with <url>{{prefix}}</url>.",
      pasteTitle: "Paste it here",
      pasteLabel: "Address from your browser",
      startAgain: "Start again",
      cancel: "Cancel",
      connecting: "Connecting…",
      connect: "Connect",
    },
    googleAccess: {
      title: "Google access",
      description:
        "Everyone on this server signs in to Google through an OAuth client from your own Google Cloud project. Create one of type Desktop app, enter it here, and add each person's Google address to the project's test users. <guide>Setup guide</guide>",
      loadError: "Unable to load Google access.",
      loading: "Loading…",
      savedTitle: "Google access saved",
      saveErrorFallback: "Could not save Google access.",
      removedTitle: "Google access removed",
      removeErrorFallback: "Could not remove Google access.",
      confirmRemoval:
        "Remove Google access? Everyone's Google connection on this server will be deleted, and nobody can connect until it is set up again.",
      cancel: "Cancel",
      removing: "Removing…",
      remove: "Remove",
      clientIdLabel: "Client ID",
      clientIdChangeWarning:
        "A different client ID disconnects everyone until they sign in again.",
      clientSecretLabel: "Client secret",
      clientSecretPlaceholder: "Leave empty to keep the stored secret",
      saving: "Saving…",
      save: "Save",
    },
  },
  mcp: {
    available: {
      title: "MCP servers",
      description:
        "Choose which available MCP servers can provide tools in your chats.",
      loading: "Loading MCP servers…",
      loadError: "Unable to load MCP servers.",
      emptyTitle: "No MCP servers available",
      emptyDescription: "Ask an administrator to connect a tool server.",
      enableErrorTitle: "Failed to enable MCP server",
      disableErrorTitle: "Failed to disable MCP server",
      toggleErrorFallback: "Your preference was not changed.",
      enableLabel: "Enable {{name}} for my chats",
      disableLabel: "Disable {{name}} for my chats",
    },
    health: {
      check: "Check",
      checkTitle: "Click to check connection",
      checking: "Checking…",
      checkingTitle: "Checking connection…",
      toolCount_one: "{{count}} tool",
      toolCount_other: "{{count}} tools",
      workingTitle_one:
        "Working — discovered {{count}} tool in {{elapsedMs}}ms",
      workingTitle_other:
        "Working — discovered {{count}} tools in {{elapsedMs}}ms",
      down: "Down",
    },
    manage: {
      title: "Manage MCP servers",
      description:
        "Connect external tool servers and choose who can use them. Commands run inside the OvertChat server environment.",
      addServer: "Add server",
      loading: "Loading MCP servers…",
      loadError: "Unable to load MCP servers.",
      emptyTitle: "No MCP servers available",
      emptyDescription:
        "Connect a server to make its tools available in chats.",
      availableTo: "Available to",
      availableToLabel: "Available to for {{name}}",
      availability: {
        everyone: "Everyone",
        admins: "Admins only",
        disabled: "Disabled",
      },
      edit: "Edit",
      delete: "Delete",
      availabilityErrorTitle: "Failed to change MCP server availability",
      availabilityErrorFallback: "The server was not changed.",
      deletedTitle: "MCP server deleted",
      deleteErrorFallback: "Failed to delete MCP server",
      deleteDialogTitle: "Delete MCP server?",
      deleteDialogDescription:
        "<name>{{name}}</name> and its configuration will be removed.",
      cancel: "Cancel",
      deleting: "Deleting…",
    },
    editor: {
      backToTools: "Back to tools",
      editTitle: "Edit MCP server",
      addTitle: "Add MCP server",
      documentation: "MCP documentation",
      connectionTitle: "Connection",
      connectionDescription:
        "Name this server and choose how OvertChat connects to it.",
      nameLabel: "Name",
      namePlaceholder: "MCP server name",
      transportTitle: "Transport",
      transportDescription:
        "Run a local process or connect to an HTTP server.",
      localProcessTitle: "Local process",
      localProcessDescription:
        "Configure the command and environment used to start this server.",
      commandLabel: "Command to launch",
      argumentsLabel: "Arguments",
      addArgument: "Add argument",
      argumentValueLabel: "Arguments value {{index}}",
      removeArgumentRow: "Remove arguments row",
      envVarsLabel: "Environment variables",
      keyPlaceholder: "Key",
      valuePlaceholder: "Value",
      addEnvVar: "Add environment variable",
      removeEnvVarRow: "Remove environment variables row",
      envPassthroughLabel: "Environment variable passthrough",
      addVariable: "Add variable",
      passthroughValueLabel: "Environment variable passthrough value {{index}}",
      removePassthroughRow: "Remove environment variable passthrough row",
      workingDirectoryLabel: "Working directory",
      httpConnectionTitle: "HTTP connection",
      httpConnectionDescription:
        "Configure the server address and optional authentication.",
      serverUrlLabel: "Server URL",
      httpHeadersLabel: "HTTP headers",
      headerPlaceholder: "Header",
      addHeader: "Add header",
      removeHttpHeaderRow: "Remove http headers row",
      envHeadersLabel: "Environment variable HTTP headers",
      envVarPlaceholder: "Environment variable",
      addEnvHeader: "Add environment header",
      removeEnvHeaderRow: "Remove environment variable http headers row",
      bearerTokenEnvVarLabel: "Bearer token environment variable",
      cancel: "Cancel",
      saving: "Saving…",
      saveChanges: "Save changes",
      addServer: "Add server",
      validationFallback: "Check the server configuration.",
      updatedTitle: "MCP server updated",
      addedTitle: "MCP server added",
      saveErrorFallback: "Failed to save MCP server",
    },
  },
} as const;
