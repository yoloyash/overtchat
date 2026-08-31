type SubmissionEcho = {
  id: string;
};

function userMessage(
  record: Record<string, unknown>,
): Record<string, unknown> | null {
  const message = record.message;
  return message && typeof message === "object" && Reflect.get(message, "role") === "user"
    ? (message as Record<string, unknown>)
    : null;
}

/** Correlates provider user-message lifecycle events with submissions that the
 * provider protocol cannot carry an application-defined message id for. */
export class SubmissionEchoTracker {
  private readonly pending: SubmissionEcho[] = [];
  private active: SubmissionEcho | null = null;

  track(id: string | undefined): () => void {
    if (!id) return () => {};
    const echo = { id };
    this.pending.push(echo);
    return () => {
      const index = this.pending.indexOf(echo);
      if (index >= 0) this.pending.splice(index, 1);
    };
  }

  annotate(record: Record<string, unknown>): Record<string, unknown> {
    if (record.type === "prompt_result" && record.agentInvoked === false) {
      this.pending.shift();
      return record;
    }
    if (record.type !== "message_start" && record.type !== "message_end") {
      return record;
    }
    const message = userMessage(record);
    if (!message) return record;
    const echo = this.active ?? this.pending.shift() ?? null;
    if (!echo) return record;
    if (record.type === "message_start") this.active = echo;
    if (record.type === "message_end") this.active = null;
    return {
      ...record,
      message: { ...message, overtchatSubmissionId: echo.id },
    };
  }

  clear(): void {
    this.pending.splice(0, this.pending.length);
    this.active = null;
  }
}
