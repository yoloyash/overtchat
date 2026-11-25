export const models = {
  page: {
    title: "Models",
    description:
      "Manage chat, image, and background task models. One image model can be enabled at a time.",
    addModel: "Add model",
    searchPlaceholder: "Search models",
    searchLabel: "Search models",
    configuredCount: "{{count}} configured",
    empty: "No models configured.",
    addFirstModel: "Add your first model",
    noMatches: "No models match <query>{{query}}</query>.",
    reorderClearSearch: "Clear search to change model order.",
    reorderHint: "Use the arrows to set the model order for everyone.",
    providerCustom: "Custom",
  },
  backgroundTasks: {
    title: "Background tasks",
    description:
      "Choose how lightweight model work is handled across this server.",
    taskModelTitle: "Task model",
    taskModelDescription:
      "Used to generate chat titles. A fast, inexpensive, non-reasoning model works best.",
    taskModelLabel: "Task model",
    sameAsChatModel: "Same as chat model",
    notInChat: "Not in chat",
  },
  item: {
    taskBadge: "Task",
    imageBadge: "Image",
    moveUpTitle: "Move up",
    moveUpLabel: "Move {{label}} up",
    moveDownTitle: "Move down",
    moveDownLabel: "Move {{label}} down",
    on: "On",
    off: "Off",
    disableLabel: "Disable {{label}}",
    enableLabel: "Enable {{label}}",
    edit: "Edit",
    editLabel: "Edit {{label}}",
    delete: "Delete",
    deleteLabel: "Delete {{label}}",
  },
  deleteDialog: {
    title: "Delete model?",
    description:
      "<name>{{name}}</name> will be removed from chat. Existing chats keep their messages.",
    descriptionTaskModel:
      "<name>{{name}}</name> will be removed from chat. Existing chats keep their messages. Background tasks will return to using the active chat model.",
    cancel: "Cancel",
    delete: "Delete",
    deleting: "Deleting…",
  },
  toast: {
    reorderFailed: "Couldn't save model order",
    updateFailedFallback: "Failed to update model",
    enableFailed: "Failed to enable model",
    disableFailed: "Failed to disable model",
    deleted: "Model deleted",
    deleteFailed: "Failed to delete model",
    taskModelUpdateFailed: "Failed to update task model",
    taskModelUnchanged: "The task model was not changed.",
    saved: "Model saved",
    created: "Model created",
    saveFailed: "Failed to save model",
  },
  health: {
    check: "Check",
    checkTitle: "Click to check connection",
    checking: "Checking…",
    checkingTitle: "Checking connection…",
    workingTitle: "Working — responded in {{elapsedMs}}ms",
    down: "Down",
  },
  connectionTester: {
    connectError: "Could not connect to the model provider.",
    testing: "Testing…",
    testConnection: "Test connection",
    connected: "Connected",
    elapsedMs: "{{elapsedMs}}ms",
    elapsedMsWithTokens:
      "{{elapsedMs}}ms · {{inputTokens}} in / {{outputTokens}} out",
  },
  editor: {
    editTitle: "Edit model",
    addTitle: "Add model",
    description: "Configure a model that everyone on this server can use.",
    backLabel: "Back to models",
    modelTypeSection: "Model type",
    typeTitle: "Type",
    typeDescription:
      "Chat models handle conversations. Image models generate and edit pictures through chat tools.",
    typeChat: "Chat",
    typeImage: "Image",
    connectionTitle: "Connection",
    connectionDescription:
      "Provider, credentials, model discovery, and connectivity.",
    headersLabel: "Request headers",
    headersDescription:
      "Extra HTTP headers for gateways that need them. <code>{{placeholder}}</code> in a value becomes the conversation's ID.",
    headersKeyPlaceholder: "Header",
    headersValuePlaceholder: "Value",
    headersAddLabel: "Add header",
    toolCallingTitle: "Tool calling",
    toolCallingSupported:
      "This model or endpoint reports tool support. Test the connection to verify the configured template and parser.",
    toolCallingUnsupported:
      "This model or endpoint reports no tool support. Override only if the served configuration adds it.",
    toolCallingUnknown:
      "Allow tools such as web search. Custom servers rarely report this reliably, so use Test connection to verify the served template and parser.",
    toolCallingDisableLabel: "Disable tool calling",
    toolCallingEnableLabel: "Enable tool calling",
    testConnectionTitle: "Test connection",
    testConnectionWithTools:
      "Send a short request and verify tool calling with the current connection settings.",
    testConnectionTextOnly:
      "Send a short text request with the current connection settings.",
    imageAvailabilityTitle: "Image availability",
    imageAvailabilityDescription:
      "One image model can be enabled at a time. Enabling this model switches off the previous image model.",
    chatAvailabilityTitle: "Chat availability",
    chatAvailabilityDescription:
      "How this model appears to people using chat.",
    displayNameTitle: "Display name",
    displayNameImageDescription: "Shown in model settings.",
    displayNameChatDescription: "Shown in the chat model picker.",
    displayNamePlaceholder: "Shown in the picker",
    credentialsTitle: "Credentials",
    credentialsUserDescription:
      "Each person can have their own key and endpoint, set under People. Anyone without one uses the connection above.",
    credentialsSharedDescription: "Everyone chats with the connection above.",
    credentialsShared: "Shared",
    credentialsUser: "Each person's own",
    enabledTitle: "Enabled",
    enabledImageDescription:
      "Makes image generation and editing available to chats with tool calling enabled.",
    availableInChatTitle: "Available in chat",
    availableInChatDescription:
      "Turn off to keep this model saved without showing it in chat.",
    disableModelLabel: "Disable model",
    enableModelLabel: "Enable model",
    usageCostTitle: "Usage cost",
    usageCostOpenRouter:
      "Chat usage records each image at the charge OpenRouter reports with it.",
    usageCostCustom:
      "Estimates image cost from the token usage the backend reports with each image. Images stay unpriced when it reports none.",
    usageCostDefault:
      "Estimates image cost in chat usage. Providers bill images as output tokens, so size and quality are already reflected in each count.",
    usageCostOpenRouterNotice:
      "No rates are needed for OpenRouter image models.",
    cancel: "Cancel",
    saving: "Saving…",
    saveChanges: "Save changes",
    addModel: "Add model",
    perUserSaveFirst:
      "Save this model, then set each person's own key or endpoint under People.",
    errors: {
      invalidProviderOptions:
        "Provider options must be a valid JSON object: {{error}}",
      invalidJson: "Invalid JSON",
      invalidImagePricing:
        "Enter input and output rates as nonnegative numbers.",
      invalidChatPricing:
        "Enter all four pricing rates as nonnegative numbers.",
      updateAppForProvider:
        "Update the app to edit models that use {{provider}}.",
      invalidInput: "Invalid input",
    },
  },
  connection: {
    providerTitle: "Provider",
    providerDescription:
      "Selects model discovery, authentication, and runtime behavior.",
    customOpenAiCompatible: "Custom (OpenAI-compatible)",
    apiFormatTitle: "API format",
    apiFormatAutoDescription: "Choose the protocol exposed by this endpoint.",
    apiFormatAutomatic: "Automatic",
    apiFormatDescriptions: {
      "openai-images": "For OpenAI-compatible /images/generations endpoints.",
      "openai-chat": "For OpenAI-compatible /chat/completions endpoints.",
      "openai-responses": "For Open Responses-compatible /responses endpoints.",
      "anthropic-messages": "For Anthropic-compatible /messages endpoints.",
    },
    endpointTitle: "Endpoint",
    endpointLocalDescription:
      "Base URL for the model API. If overtchat runs in Docker, use host.docker.internal instead of localhost.",
    endpointDescription: "Base URL for the model API.",
    apiKeyTitle: "API key",
    apiKeyOptionalDescription:
      "Used by everyone without their own key under People. Leave empty if each person must bring one.",
    apiKeyRequiredFor: "Required for {{provider}}.",
    apiKeyOptionalLocalDescription: "Optional for local or custom endpoints.",
    apiKeyUnknownProvider: "Enter the key {{provider}} needs, if any.",
    requiredPlaceholder: "Required",
    optionalPlaceholder: "Optional",
    previouslyUsedGroupLabel: "Previously used API keys",
    previouslyUsed: "Previously used:",
    modelTitle: "Model",
    modelImageDescription: "Choose an image model or enter its ID manually.",
    modelChatDescription: "Choose a fetched model or enter an id.",
    fetchedModelsLabel: "Fetched models",
    searchModelsPlaceholder: "Search models",
    searchModelsLabel: "Search models",
    noMatchingModels: "No matching models.",
    refresh: "Refresh",
    fetch: "Fetch",
    fetchingModels: "Fetching available models",
    modelsFetched_one: "{{count}} model fetched",
    modelsFetched_other: "{{count}} models fetched",
    addApiKeyToFetch: "Add an API key to fetch models.",
    autoFetchHint: "Models will load automatically when ready.",
    manualFetchHint: "Refresh to load available models.",
    enterManually: "Enter manually",
    chooseFetchedModel: "Choose fetched model",
    manualModelNotice:
      "The current model id was not returned by the endpoint, so it is being kept as a manual entry.",
  },
  customImage: {
    title: "Image API settings",
    description:
      "Connect an OpenAI-compatible Images API and configure generation and editing.",
    generationSizeTitle: "Generation size",
    generationSizeDescription:
      "Use a size supported by your backend, such as 512x512. Leave blank to use its default. Chat suggestions cannot override this size.",
    generationSizePlaceholder: "Backend default",
    responseFormatTitle: "Response format",
    responseFormatDescription:
      "URL responses must contain an inline image data URL.",
    responseFormatBase64: "Base64 (b64_json)",
    responseFormatUrl: "Data URL (url)",
    supportsEditingTitle: "Supports image editing",
    supportsEditingDescription:
      "Enable to edit uploaded or generated images. Requires a backend and model that support /images/edits.",
    editingSizeTitle: "Editing size",
    editingSizeDescription:
      "Override the generation size for edits, such as 512x512. Leave blank to use the generation size, or enter auto to use the backend default.",
    editingSizePlaceholder: "Same as generation",
    extraParamsTitle: "Extra request parameters",
    extraParamsDescription:
      'Optional JSON object, such as {"seed": 7}. Use this for backend-specific quality or sampling settings. Model, prompt, size, response format, and image count are managed separately.',
    invalidJsonObject: "Enter a JSON object.",
    invalidValidJsonObject: "Enter a valid JSON object.",
  },
  advanced: {
    title: "Advanced",
    description:
      "Optional prompt and provider-specific behavior for this model.",
    hide: "Hide",
    show: "Show",
    contextWindowTitle: "Context window",
    contextWindowDescription:
      "Maximum tokens this model can hold. Older conversation is automatically summarized to leave room for replies. Leave blank to use the detected or catalog value.",
    contextWindowPlaceholder: "Automatically detected",
    systemPromptTitle: "System prompt",
    systemPromptDescription: "Optional instructions sent before each chat.",
    systemPromptPlaceholder: "You are a helpful assistant…",
    providerOptionsTitle: "Provider options",
    providerOptionsDescription:
      "Optional AI SDK options for the selected provider.",
    providerOptionsAriaLabel: "Provider options JSON",
    providerOptionsHint:
      "Must be a JSON object using the selected provider's AI SDK option keys.",
    providerOptionsMustBeObject: "Must be a JSON object",
    pricing: {
      title: "Pricing",
      description:
        "USD per 1M tokens. Catalog rates apply automatically unless custom rates are enabled.",
      customRates: "Custom rates",
      noCatalogPricing: "No catalog pricing",
      customPricingLabel: "Custom pricing",
      input: "Input",
      output: "Output",
      cacheRead: "Cache read",
      cacheWrite: "Cache write",
      tieredCustomHint: "Flat custom rates replace catalog context tiers.",
      tieredCatalogHint: "Context tiers apply automatically.",
      customHint: "These rates apply to future generations.",
      noCatalogHint: "Enable custom pricing to enter rates for this model.",
      useCatalogPricing: "Use catalog pricing",
      removeCustomPricing: "Remove custom pricing",
    },
  },
  thinking: {
    title: "Thinking",
    description:
      "Thinking levels offered in chat and the request fields each level sends.",
    levelsTitle: "Levels",
    levelsCustomDescription:
      "Custom levels replace catalog and detected values.",
    levelsKnownDescription: "Known levels: {{levels}} (default {{defaultLevel}}).",
    levelsUnknownDescription:
      "No thinking levels are known for this model. Choose Custom to configure them.",
    modeAutomatic: "Automatic",
    modeCustom: "Custom",
    presetsTitle: "Presets",
    presetsDescription:
      "Replace the request fields with a common convention.",
    presetNone: "None",
    presetDescriptions: {
      enable_thinking: "On/Off through chat_template_kwargs.enable_thinking",
      thinking: "On/Off through chat_template_kwargs.thinking",
      reasoning_effort: "Low, medium, and high through reasoning_effort",
      None: "Hide the thinking selector",
    },
    requestFieldsTitle: "Request fields",
    requestFieldsDescription:
      "One entry per level: on, off, minimal, low, medium, high, xhigh, or max. Each entry is merged into the request body; null removes a field. An empty object hides the thinking selector.",
    requestFieldsAriaLabel: "Thinking request fields JSON",
    requestFieldsMustBeObject:
      "Must be a JSON object whose values are objects.",
    defaultLevelTitle: "Default level",
    defaultLevelDescription:
      "What the server does when no thinking field is sent. Chat marks it as the default.",
    chooseLevel: "Choose a level",
    checkTitle: "Check",
    checkDescription:
      "Renders the prompt template for each level without generating a reply. Fields the server handles outside the template aren't reflected.",
    checking: "Checking…",
    checkWithServer: "Check with server",
    useAsDefault: "Use {{level}} as default",
    checkUnavailable:
      "This server has no template render endpoint, so the fields can't be checked without generating.",
    checkRejected: "The server rejected the fields for {{levels}}.",
    checkIdentical: "{{levels}} render the same prompt.",
    checkDistinct: "Each level renders a distinct prompt.",
    checkMatchesDefault:
      "Without thinking fields, the server renders like {{level}}.",
    levels: {
      on: "On",
      off: "Off",
      minimal: "Minimal",
      low: "Low",
      medium: "Medium",
      high: "High",
      xhigh: "Extra high",
      max: "Max",
    },
  },
  userCredentials: {
    title: "People",
    description:
      "Each person can chat with their own key and endpoint. Leave a field empty to use the model's own.",
    loadError: "Couldn't load people",
    loading: "Loading people…",
    removedTitle: "Using the model's own credentials",
    savedTitle: "Credential saved",
    saveErrorTitle: "Couldn't save credential",
    saveErrorFallback: "Request failed",
    statusOwnKey: "own key {{maskedKey}}",
    statusOwnEndpoint: "own endpoint {{baseUrl}}",
    statusOwnBoth: "own key {{maskedKey}} · own endpoint {{baseUrl}}",
    statusDefault: "Uses the model's key and endpoint",
    apiKeyLabel: "API key for {{who}}",
    apiKeyPlaceholder: "Leave empty to use the model's key",
    endpointLabel: "Endpoint for {{who}}",
    endpointPlaceholder: "Leave empty to use {{baseUrl}}",
    cancel: "Cancel",
    save: "Save",
    saveLabel: "Save credential for {{who}}",
    remove: "Remove",
    removeLabel: "Remove credential for {{who}}",
    change: "Change",
    changeLabel: "Change credential for {{who}}",
    setUp: "Set up",
    setUpLabel: "Set up credential for {{who}}",
  },
} as const;
