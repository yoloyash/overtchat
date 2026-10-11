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
