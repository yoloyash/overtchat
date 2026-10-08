import type { AgentTextDelta, AgentTurnDelta } from "@overtchat/agent-bridge";

type Message = {
  id: string;
  content?: string | Array<Record<string, unknown>>;
} & Record<string, unknown>;

/** Only newly appended text crosses the wire while an item streams. */
export function codexTurnDelta(
  turnId: string,
  previous: unknown[],
  next: unknown[],
): AgentTurnDelta {
  const old = new Map((previous as Message[]).map((m) => [m.id, m]));
  const messages: unknown[] = [];
  const textDeltas: AgentTextDelta[] = [];
  for (const message of next as Message[]) {
    const baseline = old.get(message.id);
    if (baseline && JSON.stringify(baseline) === JSON.stringify(message))
      continue;
    const deltas: AgentTextDelta[] = [];
    const comparable = structuredClone(message);
    if (
      baseline &&
      typeof baseline.content === "string" &&
      typeof message.content === "string" &&
      message.content.startsWith(baseline.content)
    ) {
      comparable.content = baseline.content;
      if (message.content.length > baseline.content.length)
        deltas.push({
          id: message.id,
          field: "content",
          offset: baseline.content.length,
          text: message.content.slice(baseline.content.length),
        });
    } else if (
      baseline &&
      Array.isArray(baseline.content) &&
      Array.isArray(message.content) &&
      baseline.content.length === message.content.length
    ) {
      comparable.content = message.content.map((part, index) => {
        const base = (baseline.content as Array<Record<string, unknown>>)[
          index
        ]!;
        const copy = { ...part };
        for (const field of ["text", "thinking"] as const) {
          if (
            typeof base[field] === "string" &&
            typeof part[field] === "string" &&
            (part[field] as string).startsWith(base[field] as string)
          ) {
            copy[field] = base[field];
            if ((part[field] as string).length > (base[field] as string).length)
              deltas.push({
                id: message.id,
                part: index,
                field,
                offset: (base[field] as string).length,
                text: (part[field] as string).slice(
                  (base[field] as string).length,
                ),
              });
          }
        }
        return copy;
      });
    }
    if (
      baseline &&
      deltas.length &&
      JSON.stringify(comparable) === JSON.stringify(baseline)
    )
      textDeltas.push(...deltas);
    else messages.push(message);
  }
  return {
    type: "overtchat_turn_delta",
    turnId,
    order: (next as Message[]).map((m) => m.id),
    messages,
    textDeltas,
  };
}
