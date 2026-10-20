import { describe, expect, it } from "vitest";
import {
  agentQuestionFields,
  dismissQuestion,
  initialQuestionValues,
  interactionFormComplete,
  isAgentQuestion,
  normalizeFormValues,
  questionResponse,
  toggleQuestionOption,
  type AgentQuestionRequest,
} from "@overtchat/shared/agent-interaction";

const request: AgentQuestionRequest = {
  type: "interaction_request",
  id: "form",
  method: "form",
  fields: [
    {
      id: "choice",
      label: "Choice",
      type: "select",
      required: true,
      allowOther: true,
      options: [
        {
          value: "stable-id",
          label: "Friendly label",
          description: "Why this option",
        },
      ],
    },
    {
      id: "count",
      label: "Count",
      type: "number",
      minimum: 1,
      maximum: 5,
      required: true,
    },
    {
      id: "enabled",
      label: "Enabled",
      type: "boolean",
      required: true,
      defaultValue: false,
    },
  ],
};

describe("shared question projection", () => {
  it("preserves descriptions, provider values, defaults, numeric bounds and explicit false", () => {
    const fields = agentQuestionFields(request);
    expect(fields[0].options[0].description).toBe("Why this option");
    const values = {
      ...initialQuestionValues(fields),
      choice: "stable-id",
      count: "3",
    };
    expect(
      interactionFormComplete(fields, normalizeFormValues(fields, values)),
    ).toBe(true);
    expect(questionResponse(request, fields, values)).toEqual({
      values: { choice: "stable-id", count: 3, enabled: false },
    });
    expect(
      interactionFormComplete(
        fields,
        normalizeFormValues(fields, { ...values, count: "6" }),
      ),
    ).toBe(false);
    expect(
      interactionFormComplete(
        fields,
        normalizeFormValues(fields, { ...values, count: "-" }),
      ),
    ).toBe(false);
    expect(
      interactionFormComplete(
        fields,
        normalizeFormValues(fields, { ...values, choice: "   " }),
      ),
    ).toBe(false);
  });
  it("allows custom answers only when advertised and clears custom text when choosing an option", () => {
    const field = agentQuestionFields(request)[0];
    expect(interactionFormComplete([field], { choice: "Custom" })).toBe(true);
    expect(
      interactionFormComplete([{ ...field, allowOther: false }], {
        choice: "Custom",
      }),
    ).toBe(false);
    expect(
      toggleQuestionOption(
        { ...field, type: "multiselect" },
        ["Custom"],
        "stable-id",
      ),
    ).toEqual(["stable-id"]);
    expect(toggleQuestionOption(field, "stable-id", "stable-id")).toBe("");
  });
  it("does not convert authorization or permission prompts into questions", () => {
    expect(isAgentQuestion(request)).toBe(true);
    expect(isAgentQuestion({ ...request, title: "Approve command?" })).toBe(
      true,
    );
    for (const partial of [{ method: "external" }, { approvalKind: "tool" }]) {
      expect(isAgentQuestion({ ...request, ...partial })).toBe(false);
    }
  });
  it("requires real answers and distinguishes skipping optional input from cancelling", () => {
    const input: AgentQuestionRequest = {
      type: "interaction_request",
      id: "pi",
      method: "input",
      title: "Comment",
      optional: true,
    };
    expect(dismissQuestion(input, agentQuestionFields(input))).toEqual({
      value: "",
    });
    expect(dismissQuestion(request, agentQuestionFields(request))).toEqual({
      cancelled: true,
    });
  });
});
