#!/usr/bin/env node
import { createInterface } from "node:readline";

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

const tool = {
  name: "echo",
  description: "Echo a message for overtchat e2e tests.",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
    additionalProperties: false,
  },
};

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function result(id, value) {
  if (id !== undefined && id !== null) send({ id, result: value });
}

function error(id, code, message) {
  if (id !== undefined && id !== null) send({ id, error: { code, message } });
}

rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = message;
  if (!method) return;

  switch (method) {
    case "initialize":
      result(id, {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: {
          name: "overtchat-e2e-mcp",
          version: "1.0.0",
        },
      });
      break;
    case "tools/list":
      result(id, { tools: [tool] });
      break;
    case "tools/call":
      result(id, {
        content: [
          {
            type: "text",
            text: String(params?.arguments?.message ?? "echo"),
          },
        ],
      });
      break;
    default:
      if (id !== undefined && id !== null) {
        error(id, -32601, `Method not found: ${method}`);
      }
  }
});
