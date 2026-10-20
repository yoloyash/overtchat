import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { applyAgentRuntimeMessageEvent } from "@overtchat/agent-bridge";
import { projectAgentTranscript } from "@overtchat/shared/agent-presentation";
import { PiClient } from "./client";
import { OmpClient } from "../omp/client";
import type { AgentProcess, AgentProcessExit } from "../runtime/process";

type RecordValue = Record<string, unknown>;

class RpcProcess implements AgentProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  private resolveExit!: (exit: AgentProcessExit) => void;
  readonly exit = new Promise<AgentProcessExit>((resolve) => {
    this.resolveExit = resolve;
  });
  history: unknown[] = [];

  constructor() {
    this.stdin.on("data", (chunk) => {
      const command = JSON.parse(chunk.toString()) as RecordValue;
      const data =
        command.type === "get_messages"
          ? { messages: this.history }
          : command.type === "get_entries"
            ? {
                leafId: "native-answer",
                entries: this.history.map((message) => ({
                  id: "native-answer",
                  parentId: null,
                  type: "message",
                  message,
                })),
              }
            : command.type === "get_branch_messages"
              ? { messages: [] }
              : {};
      this.send({
        type: "response",
        id: command.id,
        command: command.type,
        success: true,
        data,
      });
    });
  }

  send(event: RecordValue): void {
    this.stdout.write(`${JSON.stringify(event)}\n`);
  }
  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.resolveExit({ code: null, signal });
    return true;
  }
}

describe.each(["pi", "omp"] as const)(
  "%s assistant message identity",
  (provider) => {
    function setup() {
      const process = new RpcProcess();
      const client =
        provider === "pi"
          ? new PiClient(process)
          : new OmpClient(process, "full");
      process.send({ type: "ready" });
      let messages: unknown[] = [];
      client.onEvent((event) => {
        messages = applyAgentRuntimeMessageEvent(messages, event);
      });
      return {
        process,
        client,
        messages: () => messages,
        replace: (next: unknown[]) => {
          messages = next;
        },
      };
    }

    it.each([
      "A plain draft.",
      "## Draft\n\n**Keep this answer.**\n\n```markdown\n[Download](https://example.com)\n```",
    ])(
      "preserves completed text through a todo continuation, tool call and abort: %s",
      async (text) => {
        const { process, client, messages } = setup();
        try {
          const draft = {
            role: "assistant",
            timestamp: 100,
            content: [{ type: "text", text }],
          };
          process.send({
            type: "message_start",
            message: { ...draft, content: [] },
          });
          process.send({ type: "message_update", message: draft });
          process.send({
            type: "message_end",
            message: { ...draft, stopReason: "stop" },
          });
          const savedDraft = messages()[0];
          process.send({ type: "todo_reminder" });
          process.send({ type: "agent_start" });
          process.send({ type: "turn_start" });
          const continuation = {
            role: "assistant",
            timestamp: 200,
            content: [],
          };
          process.send({ type: "message_start", message: continuation });
          expect(messages()).toHaveLength(2);
          expect(messages()[0]).toEqual(savedDraft);
          const toolMessage = {
            ...continuation,
            content: [
              {
                type: "toolCall",
                id: "bash-1",
                name: "bash",
                arguments: { command: "pwd" },
              },
            ],
          };
          process.send({ type: "message_update", message: toolMessage });
          process.send({
            type: "message_end",
            message: { ...toolMessage, stopReason: "toolUse" },
          });
          process.send({
            type: "message_end",
            message: {
              role: "toolResult",
              toolCallId: "bash-1",
              timestamp: 300,
              content: [{ type: "text", text: "Command aborted" }],
              isError: true,
            },
          });
          process.send({
            type: "message_start",
            message: { role: "assistant", timestamp: 400, content: [] },
          });
          process.send({
            type: "message_end",
            message: {
              role: "assistant",
              timestamp: 400,
              content: [],
              stopReason: "aborted",
              errorMessage: "Request was aborted",
            },
          });
          expect(messages()).toHaveLength(4);
          expect(messages()[0]).toEqual(savedDraft);
          expect(
            projectAgentTranscript(messages()).map((item) => item.type),
          ).toEqual(["assistant_text", "activity", "assistant_error"]);
          expect(projectAgentTranscript(messages())[0]).toMatchObject({ text });
        } finally {
          await client.stop();
        }
      },
    );

    it.each([undefined, 100])(
      "separates lifecycles even with missing or identical timestamps: %s",
      async (timestamp) => {
        const { process, client, messages } = setup();
        try {
          for (const text of ["First", "Second"]) {
            const message = {
              role: "assistant",
              timestamp,
              content: [{ type: "text", text }],
            };
            process.send({
              type: "message_start",
              message: { ...message, content: [] },
            });
            process.send({ type: "message_update", message });
            process.send({ type: "message_end", message });
          }
          expect(messages()).toHaveLength(2);
          const ids = messages().map((message) =>
            Reflect.get(message as object, "id"),
          );
          expect(new Set(ids).size).toBe(2);
          expect(
            projectAgentTranscript(messages()).map(
              (item) => item.type === "assistant_text" && item.text,
            ),
          ).toEqual(["First", "Second"]);
        } finally {
          await client.stop();
        }
      },
    );

    it("keeps a streaming identity through native history refresh and adopts saved IDs on resume", async () => {
      const { process, client, messages, replace } = setup();
      try {
        const message = {
          role: "assistant",
          timestamp: 100,
          content: [{ type: "text", text: "Draft" }],
        };
        process.send({ type: "message_start", message });
        const id = Reflect.get(messages()[0] as object, "id");
        process.history = [{ ...message, entryId: "native-answer" }];
        replace((await client.getMessages()).messages);
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).toMatchObject({ id });
        process.send({
          type: "message_update",
          message: {
            ...message,
            content: [{ type: "text", text: "Draft complete" }],
          },
        });
        process.send({
          type: "message_end",
          message: {
            ...message,
            content: [{ type: "text", text: "Draft complete" }],
          },
        });
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).toMatchObject({
          id,
          content: [{ type: "text", text: "Draft complete" }],
        });
        process.history = [
          {
            ...message,
            entryId: "native-answer",
            content: [{ type: "text", text: "Draft complete" }],
          },
        ];
        replace((await client.getMessages()).messages);
        expect(messages()).toHaveLength(1);
        expect(messages()[0]).toMatchObject({ id: "native-answer" });
        process.send({
          type: "message_start",
          message: { ...message, timestamp: 200, content: [] },
        });
        expect(messages()).toHaveLength(2);
        expect(messages()[0]).toMatchObject({ id: "native-answer" });
      } finally {
        await client.stop();
      }
    });

    it("handles missing start events and clears an interrupted lifecycle on abort", async () => {
      const { process, client, messages } = setup();
      try {
        const message = {
          role: "assistant",
          content: [{ type: "text", text: "Partial" }],
        };
        process.send({ type: "message_update", message });
        await client.abort();
        process.send({
          type: "message_update",
          message: {
            ...message,
            content: [{ type: "text", text: "Next answer" }],
          },
        });
        process.send({
          type: "message_end",
          message: {
            ...message,
            content: [{ type: "text", text: "Next answer" }],
          },
        });
        expect(messages()).toHaveLength(2);
      } finally {
        await client.stop();
      }
    });
  },
);
