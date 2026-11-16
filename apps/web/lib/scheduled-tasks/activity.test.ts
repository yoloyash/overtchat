import { describe, expect, it } from "vitest";
import {
  scheduledActivitySignature as activitySignature,
  unreadRunChatIds,
  type ScheduledTaskActivityRun,
} from "@overtchat/shared";
import { chatIdOfPath } from "./activity";

const run = (
  runId: string,
  status: ScheduledTaskActivityRun["status"],
  chatId: string | null,
): ScheduledTaskActivityRun => ({
  runId,
  taskId: "t",
  taskName: "Task",
  chatId,
  status,
  finishedAt: status === "running" ? null : 1,
});

describe("scheduled run activity", () => {
  it("changes its signature when a run starts, ends or is opened, not when order does", () => {
    const first = [run("1", "running", "c1"), run("2", "success", "c2")];
    expect(activitySignature(first)).toBe(activitySignature([...first].reverse()));
    expect(activitySignature(first)).not.toBe(
      activitySignature([run("1", "success", "c1"), run("2", "success", "c2")]),
    );
    expect(activitySignature(first)).not.toBe(activitySignature(first.slice(0, 1)));
    expect(activitySignature([])).toBe("");
  });

  it("counts a chat as unread only once its run has finished", () => {
    expect(
      unreadRunChatIds([
        run("1", "running", "c1"),
        run("2", "success", "c2"),
        run("3", "error", "c3"),
        run("4", "success", "c2"),
        run("5", "error", null),
      ]),
    ).toEqual(new Set(["c2", "c3"]));
    expect(unreadRunChatIds(undefined)).toEqual(new Set());
  });

  it("reads the chat a path shows", () => {
    expect(chatIdOfPath("/chat/abc")).toBe("abc");
    expect(chatIdOfPath("/chat/a%20b")).toBe("a b");
    expect(chatIdOfPath("/chat/%E0%A4%A")).toBe("%E0%A4%A");
    expect(chatIdOfPath("/chat/abc/extra")).toBeNull();
    expect(chatIdOfPath("/scheduled")).toBeNull();
    expect(chatIdOfPath("/")).toBeNull();
  });
});
