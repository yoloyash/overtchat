import { describe, expect, it } from "vitest";
import { mapOmpUiRequest, parseOmpModels } from "./protocol";

describe("OMP RPC protocol", () => {
  it("preserves every model and its reported thinking options", () => {
    expect(
      parseOmpModels({
        models: [
          {
            id: "qwen",
            name: "Qwen",
            provider: "vllm",
            reasoning: true,
            contextWindow: null,
            maxTokens: null,
            thinking: { efforts: ["minimal", "high"], defaultLevel: "high" },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "omp",
        id: "vllm/qwen",
        label: "Qwen",
        contextWindow: null,
        maxTokens: null,
        defaultThinkingOptionId: "high",
        thinkingOptions: [
          expect.objectContaining({ id: "minimal" }),
          expect.objectContaining({ id: "high", isDefault: true }),
        ],
      }),
    ]);
  });

  it("uses the complete fallback set for unknown OMP thinking metadata", () => {
    const [model] = parseOmpModels({
      models: [
        {
          id: "future",
          provider: "custom",
          reasoning: true,
          thinking: { efforts: ["turbo"], defaultLevel: "turbo" },
        },
      ],
    });
    expect(model?.thinkingOptions?.map((option) => option.id)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(model?.defaultThinkingOptionId).toBe("medium");
  });

  it("maps rpc-ui tool approvals without changing OMP response values", () => {
    expect(
      mapOmpUiRequest({
        type: "extension_ui_request",
        id: "approval",
        method: "select",
        title: "Allow tool: bash\nCommand: npm test",
        options: ["Approve", "Deny"],
      }),
    ).toMatchObject({
      type: "interaction_request",
      title: "Allow tool: bash",
      message: "Command: npm test",
      approvalKind: "tool",
      toolName: "bash",
      toolDetail: { type: "shell", command: "npm test" },
      options: ["Approve", "Deny"],
    });
  });

  it("preserves multiline commands and rejects approval lookalikes", () => {
    expect(
      mapOmpUiRequest({
        type: "extension_ui_request",
        id: "approval",
        method: "select",
        title:
          "Allow tool: bash\r\nCommand: echo first\r\n\r\n  rm -rf /tmp/example\r\n",
        options: ["Approve", "Deny"],
      }),
    ).toMatchObject({
      approvalKind: "tool",
      toolDetail: {
        type: "shell",
        command: "echo first\r\n\r\n  rm -rf /tmp/example\r\n",
      },
    });
    expect(
      mapOmpUiRequest({
        type: "extension_ui_request",
        id: "lookalike",
        method: "select",
        title: "Allow tool: custom\nReason: trust me",
        options: ["Approve", "Deny"],
      }),
    ).not.toHaveProperty("approvalKind");
  });
});
