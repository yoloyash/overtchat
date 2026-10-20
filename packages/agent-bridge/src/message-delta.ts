export type AgentTextDelta = {
  id: string;
  part?: number;
  field: "content" | "text" | "thinking";
  offset: number;
  text: string;
};

export type AgentTurnDelta = {
  type: "overtchat_turn_delta";
  turnId: string;
  order: string[];
  messages: unknown[];
  textDeltas: AgentTextDelta[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isAgentTurnDelta(value: unknown): value is AgentTurnDelta {
  const e = record(value);
  return (
    !!e &&
    e.type === "overtchat_turn_delta" &&
    typeof e.turnId === "string" &&
    e.turnId.length > 0 &&
    Array.isArray(e.order) &&
    e.order.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(e.order).size === e.order.length &&
    Array.isArray(e.messages) &&
    new Set(e.messages.map((m) => record(m)?.id)).size === e.messages.length &&
    e.messages.every((m) => {
      const r = record(m);
      return (
        r &&
        typeof r.id === "string" &&
        r.overtchatTurnId === e.turnId &&
        (e.order as string[]).includes(r.id)
      );
    }) &&
    Array.isArray(e.textDeltas) &&
    e.textDeltas.every((v) => {
      const d = record(v);
      return (
        d &&
        typeof d.id === "string" &&
        (e.order as string[]).includes(d.id) &&
        ["content", "text", "thinking"].includes(String(d.field)) &&
        Number.isSafeInteger(d.offset) &&
        Number(d.offset) >= 0 &&
        typeof d.text === "string" &&
        (d.part === undefined ||
          (Number.isSafeInteger(d.part) && Number(d.part) >= 0))
      );
    })
  );
}

/** Append deltas carry the expected offset, so a missing baseline triggers reconciliation. */
export function applyAgentTurnDelta(
  current: unknown[],
  event: AgentTurnDelta,
): unknown[] | null {
  const byId = new Map(
    current.flatMap((m) => {
      const r = record(m);
      return r?.overtchatTurnId === event.turnId && typeof r.id === "string"
        ? [[r.id, m] as const]
        : [];
    }),
  );
  for (const m of event.messages) byId.set(record(m)!.id as string, m);
  for (const delta of event.textDeltas) {
    const original = record(byId.get(delta.id));
    if (!original) return null;
    const message = { ...original };
    if (delta.part === undefined) {
      if (
        delta.field !== "content" ||
        typeof message.content !== "string" ||
        message.content.length !== delta.offset
      )
        return null;
      message.content += delta.text;
    } else {
      if (!Array.isArray(message.content) || delta.field === "content")
        return null;
      const content = [...message.content];
      const part = record(content[delta.part]);
      if (
        !part ||
        typeof part[delta.field] !== "string" ||
        (part[delta.field] as string).length !== delta.offset
      )
        return null;
      content[delta.part] = {
        ...part,
        [delta.field]: (part[delta.field] as string) + delta.text,
      };
      message.content = content;
    }
    byId.set(delta.id, message);
  }
  const ordered = event.order.map((id) => byId.get(id));
  return ordered.some((m) => m === undefined) ? null : ordered;
}
