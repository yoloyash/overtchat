export default function (pi) {
  pi.registerProvider("overtchat-test", {
    baseUrl: "https://example.invalid/v1",
    api: "openai-completions",
    apiKey: "overtchat-test-key",
    models: [
      {
        id: "extension-model",
        name: "Extension Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 1024,
      },
    ],
  });
}
