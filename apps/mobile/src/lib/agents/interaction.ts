import type { AgentInteractionValue } from "@overtchat/agent-bridge";

export type InteractionFormField = {
  id: string;
  label: string;
  description?: string;
  type: "text" | "number" | "boolean" | "select" | "multiselect";
  required: boolean;
  secret: boolean;
  options: Array<{ value: string; label: string }>;
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
    if (value === undefined || value === "") return !field.required;
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
        value.every((item) =>
          field.options.some((option) => option.value === item),
        )
      );
    }
    if (field.type === "select")
      return field.options.some((option) => option.value === value);
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
