import type {
  AgentInteractionValue,
  AgentRuntimeSnapshot,
  AgentSessionCommand,
} from "@overtchat/agent-bridge";

export type InteractionFormField = {
  id: string;
  label: string;
  description?: string;
  type: "text" | "number" | "boolean" | "select" | "multiselect";
  required: boolean;
  secret: boolean;
  allowOther: boolean;
  placeholder?: string;
  options: Array<{ value: string; label: string; description?: string }>;
  defaultValue?: AgentInteractionValue;
  minimum?: number;
  maximum?: number;
};

export function interactionFormFields(value: unknown): InteractionFormField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return [];
    }
    const field = candidate as Record<string, unknown>;
    const id = typeof field.id === "string" ? field.id : "";
    const type = field.type;
    if (
      !id ||
      !["text", "number", "boolean", "select", "multiselect"].includes(
        typeof type === "string" ? type : "",
      )
    ) {
      return [];
    }
    const options = Array.isArray(field.options)
      ? field.options.flatMap((option) => {
          if (!option || typeof option !== "object" || Array.isArray(option)) {
            return [];
          }
          const record = option as Record<string, unknown>;
          return typeof record.value === "string"
            ? [
                {
                  value: record.value,
                  ...(typeof record.description === "string"
                    ? { description: record.description }
                    : {}),
                  label:
                    typeof record.label === "string"
                      ? record.label
                      : record.value,
                },
              ]
            : [];
        })
      : [];
    const defaultValue = field.defaultValue;
    return [
      {
        id,
        label:
          typeof field.label === "string" && field.label ? field.label : id,
        ...(typeof field.description === "string" && field.description
          ? { description: field.description }
          : {}),
        type: type as InteractionFormField["type"],
        required: field.required === true,
        secret: field.secret === true,
        allowOther: field.allowOther === true,
        ...(typeof field.placeholder === "string"
          ? { placeholder: field.placeholder }
          : {}),
        options,
        ...(typeof defaultValue === "string" ||
        typeof defaultValue === "number" ||
        typeof defaultValue === "boolean" ||
        (Array.isArray(defaultValue) &&
          defaultValue.every((item) => typeof item === "string"))
          ? { defaultValue: defaultValue as AgentInteractionValue }
          : {}),
        ...(typeof field.minimum === "number"
          ? { minimum: field.minimum }
          : {}),
        ...(typeof field.maximum === "number"
          ? { maximum: field.maximum }
          : {}),
      },
    ];
  });
}

export function interactionFormComplete(
  fields: InteractionFormField[],
  values: Record<string, AgentInteractionValue>,
): boolean {
  return fields.every((field) => {
    const value = values[field.id];
    if (
      value === undefined ||
      value === "" ||
      (typeof value === "string" && !value.trim())
    )
      return !field.required;
    if (field.type === "boolean") return typeof value === "boolean";
    if (field.type === "number") {
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (field.minimum === undefined || value >= field.minimum) &&
        (field.maximum === undefined || value <= field.maximum)
      );
    }
    if (field.type === "multiselect") {
      return (
        Array.isArray(value) &&
        (!field.required || value.length > 0) &&
        value.every(
          (item) =>
            (field.allowOther && item.trim().length > 0) ||
            field.options.some((option) => option.value === item),
        )
      );
    }
    if (field.type === "select")
      return (
        typeof value === "string" &&
        ((field.allowOther && value.trim().length > 0) ||
          field.options.some((option) => option.value === value))
      );
    return typeof value === "string" && value.length > 0;
  });
}

export function normalizeFormValues(
  fields: InteractionFormField[],
  values: Record<string, AgentInteractionValue>,
): Record<string, AgentInteractionValue> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const raw = values[field.id];
      const value =
        field.type === "number" && typeof raw === "string"
          ? raw.trim()
            ? Number(raw)
            : undefined
          : raw;
      return value === undefined || value === "" ? [] : [[field.id, value]];
    }),
  );
}

export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export type AgentQuestionRequest = NonNullable<
  AgentRuntimeSnapshot["pendingInteraction"]
>;
export type AgentQuestionResponse = Omit<
  Extract<AgentSessionCommand, { type: "interaction_response" }>,
  "type" | "id"
>;

export function isAgentQuestion(
  request: AgentQuestionRequest | undefined,
): boolean {
  return (
    !!request &&
    request.approvalKind !== "tool" &&
    ["form", "select", "input", "editor", "confirm"].includes(request.method)
  );
}

export function agentQuestionFields(
  request: AgentQuestionRequest,
): InteractionFormField[] {
  if (request.method === "form") return interactionFormFields(request.fields);
  return [
    {
      id: "answer",
      label:
        typeof request.title === "string"
          ? request.title
          : "Your agent needs input",
      description:
        typeof request.message === "string" ? request.message : undefined,
      type:
        request.method === "select"
          ? "select"
          : request.method === "confirm"
            ? "boolean"
            : "text",
      required: request.allowEmpty !== true && request.optional !== true,
      secret: request.secret === true,
      allowOther: request.allowOther === true,
      placeholder:
        typeof request.placeholder === "string"
          ? request.placeholder
          : undefined,
      options: Array.isArray(request.options)
        ? request.options.flatMap((option) =>
            typeof option === "string"
              ? [{ value: option, label: option }]
              : [],
          )
        : [],
      ...(typeof request.prefill === "string"
        ? { defaultValue: request.prefill }
        : {}),
    },
  ];
}

export function initialQuestionValues(
  fields: InteractionFormField[],
): Record<string, AgentInteractionValue> {
  return Object.fromEntries(
    fields.flatMap((field) =>
      field.defaultValue === undefined ? [] : [[field.id, field.defaultValue]],
    ),
  );
}

export function questionResponse(
  request: AgentQuestionRequest,
  fields: InteractionFormField[],
  values: Record<string, AgentInteractionValue>,
): AgentQuestionResponse {
  if (request.method === "form")
    return { values: normalizeFormValues(fields, values) };
  if (request.method === "confirm")
    return { confirmed: values.answer === true };
  return { value: typeof values.answer === "string" ? values.answer : "" };
}

export function dismissQuestion(
  request: AgentQuestionRequest,
  fields: InteractionFormField[],
): AgentQuestionResponse {
  if (
    fields.length > 0 &&
    fields.every((field) => !field.required && field.type === "text")
  ) {
    return questionResponse(request, fields, {});
  }
  return { cancelled: true };
}

export function questionOptions(field: InteractionFormField) {
  return field.type === "boolean"
    ? [
        { value: "true", label: "Yes", description: undefined },
        { value: "false", label: "No", description: undefined },
      ]
    : field.options;
}

export function toggleQuestionOption(
  field: InteractionFormField,
  current: AgentInteractionValue | undefined,
  option: string,
): AgentInteractionValue {
  if (field.type === "boolean")
    return current === (option === "true") ? "" : option === "true";
  if (field.type !== "multiselect") return current === option ? "" : option;
  const selected = Array.isArray(current)
    ? current.filter((value) =>
        field.options.some((item) => item.value === value),
      )
    : [];
  return selected.includes(option)
    ? selected.filter((value) => value !== option)
    : [...selected, option];
}

// Keep typed alternatives separate from option values until submission. A typed
// answer can equal an option label without turning into an option selection.
export function questionAnswerValues(
  fields: InteractionFormField[],
  values: Record<string, AgentInteractionValue>,
  customTexts: Record<string, string>,
): Record<string, AgentInteractionValue> {
  return Object.fromEntries(
    fields
      .map((field) => {
        const custom = field.allowOther ? customTexts[field.id] : undefined;
        return [
          field.id,
          custom
            ? field.type === "multiselect"
              ? [custom]
              : custom
            : values[field.id],
        ];
      })
      .filter(([, value]) => value !== undefined),
  );
}
