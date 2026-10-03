import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConnectorClient } from "../src/client.ts";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
process.env.OVERTCHAT_CONNECTOR_STATE = path.join(
  config.directory,
  "state.json",
);
process.env.OVERTCHAT_CONNECTOR_TIMELINES = path.join(
  config.directory,
  "timelines",
);
process.env.OVERTCHAT_CONNECTOR_LOCK = path.join(config.directory, "lock");
const client = await ConnectorClient.create(config);
const timelines = Reflect.get(client, "timelines");
const enqueue = (payload) =>
  Reflect.get(client, "enqueue").call(client, payload);
const canonical = config.snapshot;
const SESSION_ID = canonical.sessionId;
const subscriptions = new Map();
let queuedMessage = "";
await timelines.openSession(SESSION_ID, "native-session", canonical);
const daemon = Reflect.get(client, "daemon");
// The provider is deterministic; connector journal, HTTP proxy, broker, SSE and UI are real.
Reflect.set(daemon, "handleRequest", async (request) => {
  switch (request.type) {
    case "open_session":
      return { sync: await timelines.sync(SESSION_ID, request.after) };
    case "session_history":
      return timelines.history(SESSION_ID, request.before);
    case "subscribe_session": {
      const subscribed = await timelines.subscribe(
        SESSION_ID,
        request.after,
        (envelope) =>
          enqueue({
            type: "session_event",
            sessionId: SESSION_ID,
            subscriptionId: request.subscriptionId,
            envelope,
          }),
      );
      subscriptions.get(request.subscriptionId)?.();
      subscriptions.set(request.subscriptionId, subscribed.unsubscribe);
      return { subscribed: true, sync: subscribed.sync };
    }
    case "unsubscribe_session":
      subscriptions.get(request.subscriptionId)?.();
      subscriptions.delete(request.subscriptionId);
      return { subscribed: false };
    case "git_status":
      return { isGit: false, files: [], branch: null };
    case "session_command": {
      if (request.command.type === "queue") {
        queuedMessage = request.command.message;
        await timelines.commit(SESSION_ID, {
          epoch: "provider",
          sequence: 1,
          type: "runtime_event",
          data: {
            type: "overtchat_queue_update",
            queuedMessages: [
              { id: "queued-steer", message: queuedMessage, status: "pending" },
            ],
          },
        });
        return {};
      }
      if (request.command.type !== "steer_queued_message") return {};
      await timelines.commit(SESSION_ID, {
        epoch: "provider",
        sequence: 2,
        type: "runtime_event",
        data: { type: "overtchat_queue_update", queuedMessages: [] },
      });
      await timelines.commit(SESSION_ID, {
        epoch: "provider",
        sequence: 1,
        type: "runtime_event",
        data: {
          type: "overtchat_turn_delta",
          turnId: "turn-34",
          order: ["user-34", "answer-34", "steer-user", "steer-answer"],
          textDeltas: [],
          messages: [
            {
              id: "steer-user",
              role: "user",
              content: queuedMessage,
              overtchatTurnId: "turn-34",
              timestamp: 71,
            },
            {
              id: "steer-answer",
              role: "assistant",
              content: [{ type: "text", text: "Steer accepted" }],
              overtchatTurnId: "turn-34",
              timestamp: 72,
            },
          ],
        },
      });
      await timelines.commit(SESSION_ID, {
        epoch: "provider",
        sequence: 2,
        type: "runtime_event",
        data: {
          type: "overtchat_turn_delta",
          turnId: "turn-34",
          order: ["user-34", "answer-34", "steer-user", "steer-answer"],
          messages: [],
          textDeltas: [
            {
              id: "steer-answer",
              part: 0,
              field: "text",
              offset: 14,
              text: " and streamed",
            },
          ],
        },
      });
      return {};
    }
    default:
      return {};
  }
});
const journal = Reflect.get(client, "journal");
for (let index = 0; index < 10; index++)
  journal.enqueue({
    type: "response",
    requestId: `stale-${index}`,
    success: true,
    data: "x".repeat(6_565_400),
  });
journal.enqueue({
  type: "response",
  requestId: "single-oversized",
  success: true,
  data: "x".repeat(11 * 1024 * 1024),
});
await journal.flush();
const running = client.run();

let stopping = false;
process.on("SIGTERM", async () => {
  if (stopping) return;
  stopping = true;
  for (const unsubscribe of subscriptions.values()) unsubscribe();
  await client.stop();
  await running;
  process.exit(0);
});
while (!stopping) {
  if (Reflect.get(client, "journal").eventBatch().length === 0) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
console.log("transport-fixture-ready");
await running;
