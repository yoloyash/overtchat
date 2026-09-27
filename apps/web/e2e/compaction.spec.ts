import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { resetE2eDatabase } from "./helpers/database";

type Message = { role: string; content?: string; tool_call_id?: string; tool_calls?: { id: string }[] };
let server: Server;
let baseUrl: string;
let prompts: Message[][];
let summaryCalls: number;
let toolCalls: number;
let outputLimits: unknown[];
const reference = "Reference material for project Cedar. ".repeat(2000);

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/mcp") {
      if (body.id === undefined) { res.writeHead(202).end(); return; }
      let result;
      if (body.method === "initialize") result = {
        protocolVersion: body.params.protocolVersion,
        capabilities: { tools: {} }, serverInfo: { name: "compaction-fixture", version: "1" },
      };
      else if (body.method === "tools/list") result = { tools: [{
        name: "lookup", description: "Read the project reference",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      }] };
      else if (body.method === "tools/call") {
        toolCalls++;
        result = { content: [{ type: "text", text: `Code ORCHID-47, launch Tuesday. ${reference}` }] };
      } else result = {};
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      return;
    }
    if (!body.stream) {
      summaryCalls++;
      res.end(JSON.stringify({
        id: randomUUID(), object: "chat.completion", created: 1, model: "fixture",
        choices: [{ index: 0, message: { role: "assistant", content: "Project Cedar, code ORCHID-47, launch Tuesday. Reference reviewed." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }));
      return;
    }
    prompts.push(body.messages);
    outputLimits.push(body.max_tokens);
    const toolName = body.tools?.find((tool: { function: { name: string } }) => tool.function.name.includes("lookup"))?.function.name;
    const call = prompts.length <= 2;
    res.setHeader("Content-Type", "text/event-stream");
    const send = (delta: unknown, finish: string | null) => res.write(`data: ${JSON.stringify({
      id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`);
    send(call ? {
      role: "assistant", tool_calls: [{ index: 0, id: `call-${prompts.length}`, type: "function", function: { name: toolName, arguments: "{}" } }],
    } : { role: "assistant", content: "Cedar launches Tuesday with code ORCHID-47." }, null);
    send({}, call ? "tool_calls" : "stop");
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test("compacts large MCP results between real tool-loop steps without limiting replies", async ({ page }) => {
  resetE2eDatabase();
  prompts = []; summaryCalls = 0; toolCalls = 0; outputLimits = [];
  await page.goto("/signup");
  await page.locator("#name").fill("Compaction Tester");
  await page.locator("#email").fill("compaction@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  const api = page.request;
  const modelResponse = await api.post("/api/model-configs", { data: {
    label: "Compaction fixture", providerId: "custom", apiFormat: "openai-chat",
    baseUrl: `${baseUrl}/v1`, model: "compaction-fixture", apiKey: "test",
    contextWindow: 8192, toolCallingEnabled: true, enabled: true,
  } });
  expect(modelResponse.ok()).toBeTruthy();
  const model = (await modelResponse.json()).modelConfig;
  const mcpResponse = await api.post("/api/mcp-servers", { data: {
    name: "Compaction reference", availability: "everyone",
    config: { transport: "http", url: `${baseUrl}/mcp` },
  } });
  expect(mcpResponse.ok()).toBeTruthy();
  const mcp = (await mcpResponse.json()).mcpServer;
  try {
    // An existing title keeps non-streaming requests exclusive to summarization.
    const title = "Tool compaction verification";
    const imported = await api.post("/api/import", { multipart: { file: {
      name: "fixture.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ format: "overtchat", chats: [{ title, messages: [
        { role: "user", parts: [{ type: "text", text: "We are investigating Cedar." }] },
        { role: "assistant", parts: [{ type: "text", text: "Ready." }] },
      ] }] })),
    } } });
    expect(imported.ok()).toBeTruthy();
    const chat = (await (await api.get("/api/chats")).json()).chats.find((c: { title: string }) => c.title === title);
    await page.addInitScript(id => localStorage.setItem("overtchat_selected_model", JSON.stringify(id)), model.id);
    await page.goto(`/chat/${chat.id}`);
    await page.getByPlaceholder("Message…").fill("Use lookup twice, then tell me the launch details.");
    await page.getByLabel("Send message").click();
    await expect(page.getByText("Cedar launches Tuesday with code ORCHID-47.", { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("status").filter({ hasText: /^Auto compacted$/ })).toBeVisible();
    expect(toolCalls).toBe(2);
    expect(prompts).toHaveLength(3);
    expect(summaryCalls).toBeGreaterThan(0);
    expect(outputLimits).toEqual([undefined, undefined, undefined]);
    for (const prompt of prompts.slice(1)) {
      const pending = new Set<string>();
      for (const message of prompt) {
        for (const call of message.tool_calls ?? []) pending.add(call.id);
        if (message.role === "tool") {
          expect(pending.has(message.tool_call_id!)).toBeTruthy();
          pending.delete(message.tool_call_id!);
        }
      }
      expect(pending.size).toBe(0);
      expect(JSON.stringify(prompt).length).toBeLessThan(reference.length);
      expect(JSON.stringify(prompt)).toContain("ORCHID-47");
    }
    const saved = (await (await api.get(`/api/chat/${chat.id}/messages`)).json()).messages;
    expect(JSON.stringify(saved)).toContain(reference);
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: /^Auto compacted$/ })).toBeVisible();
  } finally {
    await api.delete(`/api/mcp-servers/${mcp.id}`);
  }
});
