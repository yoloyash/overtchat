import { z } from "zod";
import { recordOf, type TaskList, type TodoParser } from "../pi/todo-messages";

const phasesSchema = z.array(z.object({
  name: z.string(),
  tasks: z.array(z.object({
    id: z.string().optional(), content: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "blocked", "abandoned"]),
    blocker: z.string().optional(),
  })),
}));

export function parseOmpTodoPhases(value: unknown, id: string): TaskList | null {
  const phases = phasesSchema.safeParse(value);
  if (!phases.success) return null;
  return { type: "taskList", id, items: phases.data.flatMap((phase, phaseIndex) =>
    phase.tasks.flatMap((task, taskIndex) => task.status === "abandoned" ? [] : [{
      id: task.id ?? `${phaseIndex}:${taskIndex}`,
      step: task.status === "blocked"
        ? `${task.content} (blocked${task.blocker ? `: ${task.blocker}` : ""})` : task.content,
      status: task.status === "blocked" ? "pending" : task.status,
    }])),
  };
}

export const parseOmpTodos: TodoParser = (details, id) =>
  parseOmpTodoPhases(recordOf(details)?.phases, id);

type Message = Record<string, unknown>;

export function taskListOf(message: unknown): Record<string, unknown> | undefined {
  const content = recordOf(message)?.content;
  if (!Array.isArray(content)) return undefined;
  return content.map(recordOf).find((part) => part?.type === "taskList") ?? undefined;
}

function withTaskList(message: Message, update: Partial<TaskList>): Message {
  return { ...message, content: (message.content as unknown[]).map((part) =>
    recordOf(part)?.type === "taskList" ? { ...recordOf(part), ...update } : part) };
}

/** OMP reports every todo change as a full snapshot. Like the other adapters'
 * per-turn plans, each turn shows one task card under one stable ID: the
 * newest snapshot carries it, and the snapshot it supersedes is re-emitted
 * empty, which keeps its todo call hidden without rendering a stale card. */
export class OmpTurnTasks {
  private id: string | undefined;
  private carrier: Message | undefined;

  startTurn(): void {
    this.id = undefined;
    this.carrier = undefined;
  }

  /** A native todo result. Returns the superseded carrier, if any, to emit first. */
  add(message: unknown): { superseded?: Message; message: unknown } {
    const record = recordOf(message);
    const tasks = taskListOf(record);
    if (!record || !tasks) return { message };
    this.id ??= String(tasks.id);
    const previous = this.carrier;
    this.carrier = withTaskList(record, { id: this.id });
    const same = previous?.role === record.role && (record.role === "toolResult"
      ? previous?.toolCallId === record.toolCallId : previous?.id === record.id);
    return previous && !same
      ? { superseded: withTaskList(previous, { items: [] }), message: this.carrier }
      : { message: this.carrier };
  }

  /** Native current state updates this turn's card in place, or starts it. */
  refresh(tasks: TaskList): Message {
    this.id ??= tasks.id;
    this.carrier = this.carrier
      ? withTaskList(this.carrier, { items: tasks.items })
      : { role: "assistant", id: tasks.id, content: [{ ...tasks, id: this.id }] };
    return this.carrier;
  }
}
