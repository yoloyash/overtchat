import { z } from "zod";
import type { TodoParser } from "./todo-messages";

const exampleTodo = z.object({
  action: z.enum(["list", "add", "toggle", "clear"]),
  nextId: z.number().int(),
  todos: z.array(z.object({ id: z.number().int(), text: z.string(), done: z.boolean() })),
  error: z.string().optional(),
});
const rpivTodo = z.object({
  action: z.enum(["create", "update", "list", "get", "delete", "clear"]),
  params: z.record(z.string(), z.unknown()),
  nextId: z.number().int(),
  tasks: z.array(z.object({
    id: z.number().int(), subject: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "deleted"]),
  })),
  error: z.string().optional(),
});

/** Pi has no common todo contract. Recognize only these extension schemas. */
export const parsePiTodos: TodoParser = (details, id) => {
  const example = exampleTodo.safeParse(details);
  if (example.success) {
    if (example.data.error) return null;
    return { type: "taskList", id, items: example.data.todos.map((todo) => ({
      id: String(todo.id), step: todo.text, status: todo.done ? "completed" : "pending",
    })) };
  }
  const rpiv = rpivTodo.safeParse(details);
  if (!rpiv.success || rpiv.data.error) return null;
  return { type: "taskList", id, items: rpiv.data.tasks.flatMap((task) =>
    task.status === "deleted" ? [] : [{ id: String(task.id), step: task.subject, status: task.status }]),
  };
};
