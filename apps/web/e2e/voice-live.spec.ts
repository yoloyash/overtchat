import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase } from "./helpers/database";

// Opt-in: docs/development.md describes the isolated CPU services and environment.
test.skip(process.env.VOICE_LIVE_TEST !== "1", "requires the isolated CPU voice stack");
test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });
let provider: Server;
let providerUrl: string;
let prompts: unknown[] = [];
let modelFailure = false;
let toolMode = false;
let delayedResponse = false;
let longResponse = false;
let citationResponse = false;
let speechInputs: string[] = [];
const citedAnswer = "The blue heron lives near water.\\ue200\\ue202turn0search12\\ue201 It hunts fishturn1search0.";
const spokenCitedAnswer = "The blue heron lives near water. It hunts fish.";
const longAnswer = "The blue heron moves slowly beside the river. It watches the water carefully and waits for a fish. ".repeat(12).trim();
const voiceUrl = process.env.VOICE_URL ?? "http://127.0.0.1:18765";
let providerTools: unknown[] = [];
const answer = "The blue heron lives near the quiet river.";

test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url?.startsWith("/tts/")) {
      speechInputs.push(body.input);
      try {
        const response = await fetch(`http://127.0.0.1:18880/${req.url.slice(5)}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        res.writeHead(response.status, { "Content-Type": response.headers.get("content-type") ?? "application/octet-stream" });
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(502).end();
      }
      return;
    }
    if (!body.stream) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "title", object: "chat.completion", created: 1, model: "fixture",
        choices: [{ index: 0, message: { role: "assistant", content: "Voice test" }, finish_reason: "stop" }] }));
      return;
    }
    if (modelFailure) {
      res.writeHead(503).end(JSON.stringify({ error: { message: "Synthetic model outage" } }));
      return;
    }
    prompts.push(body.messages);
    providerTools = body.tools ?? [];
    res.setHeader("Content-Type", "text/event-stream");
    const send = (delta: unknown, finish: string | null) => res.write(`data: ${JSON.stringify({
      id: "completion", object: "chat.completion.chunk", created: 1, model: "fixture",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`);
    if (toolMode && body.messages.at(-1)?.role !== "tool") {
      send({ role: "assistant", tool_calls: [{ index: 0, id: "memory-call", type: "function",
        function: { name: "set_memory", arguments: JSON.stringify({ key: "favorite_bird", value: "My favorite bird is the blue heron." }) },
      }] }, null);
      send({}, "tool_calls");
      res.end("data: [DONE]\n\n");
    } else if (delayedResponse) {
      send({ role: "assistant", content: "I will begin a longer answer. " }, null);
      const timer = setTimeout(() => { send({ content: "This should be cancelled." }, null); send({}, "stop"); res.end("data: [DONE]\n\n"); }, 20_000);
      res.on("close", () => clearTimeout(timer));
    } else if (citationResponse) {
      for (const content of citedAnswer) send({ content }, null);
      send({}, "stop");
      res.end("data: [DONE]\n\n");
    } else {
      send({ role: "assistant", content: longResponse ? longAnswer : answer }, null);
      send({}, "stop");
      res.end("data: [DONE]\n\n");
    }
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
});
test.afterAll(async () => {
  provider?.closeAllConnections();
  if (provider) await new Promise<void>(resolve => provider.close(() => resolve()));
});

test("CPU speech through app origin: text to voice to text, canonical history, auth, and recovery", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  resetE2eDatabase();
  prompts = [];
  modelFailure = false;
  toolMode = false;
  delayedResponse = false;
  longResponse = false;
  citationResponse = false;
  speechInputs = [];
  await page.addInitScript(() => {
    Object.assign(window, { playbackEvents: [] });
    const NativeWorklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        if (name === "overtchat-audio-playback") {
          const post = this.port.postMessage.bind(this.port);
          Object.defineProperty(this.port, "postMessage", { value: (data: { kind: string }, transfer: Transferable[] = []) => {
            (window as unknown as { playbackEvents: { kind: string; at: number }[] }).playbackEvents.push({ kind: data.kind, at: Date.now() });
            post(data, transfer);
          } });
        }
      }
    };
    const NativeSocket = window.WebSocket;
    Object.assign(window, { voiceEvents: [], voiceSent: [] });
    class ObservedSocket extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes("/api/voice/realtime")) {
          Object.assign(window, { voiceSocket: this });
          this.addEventListener("message", event => {
            (window as unknown as { voiceEvents: unknown[] }).voiceEvents.push(JSON.parse(event.data));
          });
        }
      }
      send(data: string | Blob | BufferSource) {
        if (typeof data === "string") {
          const event = JSON.parse(data);
          if (event.type !== "input_audio_buffer.append") {
            (window as unknown as { voiceSent: unknown[] }).voiceSent.push(event);
          }
        }
        super.send(data);
      }
    }
    window.WebSocket = ObservedSocket;
  });
  await page.goto("/signup");
  await page.locator("#name").fill("Voice integration");
  await page.locator("#email").fill("voice-live@overtchat-test.local");
  await page.locator("#password").fill("test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/");
  for (const [id, url, model] of [["tts", providerUrl.replace(/\/v1$/, "/tts"), "kokoro"], ["stt", "http://127.0.0.1:15092", "parakeet-tdt-0.6b-v3"]]) {
    const db = openE2eDatabase();
    db.prepare("UPDATE server_capabilities SET provider='openai-compatible', base_url=?, model=?, api_key=NULL WHERE id=?").run(url, model, id);
    db.close();
  }
  const modelResponse = await page.request.post("/api/model-configs", { data: {
    label: "Voice integration", providerId: "custom", apiFormat: "openai-chat", baseUrl: providerUrl,
    model: "voice-test", apiKey: "test", toolCallingEnabled: false, enabled: true,
  } });
  expect(modelResponse.ok()).toBeTruthy();
  const model = (await modelResponse.json()).modelConfig;
  await page.request.put("/api/model-preferences", { data: { defaultModelId: model.id } });
  if (process.env.VOICE_LIVE_EXTERNAL !== "1") execFileSync("docker", ["compose", "-f", "../../voice/compose.test.yml", "up", "-d", "voice"]);
  await expect.poll(async () => {
    try { return (await request.get(`${voiceUrl}/v1/pool`)).status(); } catch { return 0; }
  }, { timeout: 60_000 }).toBe(200);
  await page.reload();
  const microphone = await page.evaluate(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      return "ok";
    } catch (error) { return String(error); }
  });
  expect(microphone).toBe("ok");
  const composer = page.getByPlaceholder("Message… or / for commands");
  await composer.fill("Remember that we are discussing the blue heron.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start voice conversation" })).toBeEnabled();
  const originalChatId = new URL(page.url()).pathname.split("/").at(-1);
  expect(prompts).toHaveLength(1);
  let historyPosts = 0;
  page.on("request", request => { if (request.url().endsWith("/api/voice/history")) historyPosts += 1; });
  await page.getByRole("button", { name: "Start voice conversation" }).click();
  await expect(page.getByText("Listening", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Mute microphone" }).click();
  // Real synthesized speech is paced into the browser's existing socket. The
  // real worklet still receives/plays output; the synthetic mic is kept silent.
  const speech = await request.post("http://127.0.0.1:18880/v1/audio/speech", { data: {
    model: "kokoro", voice: "af_heart", input: "Please tell me about the blue heron.", response_format: "pcm",
  } });
  expect(speech.ok()).toBeTruthy();
  const pcm = Buffer.concat([await speech.body(), Buffer.alloc(24_000 * 2 * 2)]);
  const speak = () => page.evaluate(async base64 => {
    const ws = (window as unknown as { voiceSocket: WebSocket }).voiceSocket;
    const bytes = atob(base64);
    for (let offset = 0; offset < bytes.length; offset += 1920) {
      ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: btoa(bytes.slice(offset, offset + 1920)) }));
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }, pcm.toString("base64"));
  await speak();
  await expect.poll(() => prompts.length, { timeout: 60_000 }).toBe(2);
  expect(JSON.stringify(prompts[1]).toLowerCase()).toContain("heron");
  await expect.poll(() => page.evaluate(() => (window as unknown as { voiceEvents: { type: string }[] }).voiceEvents.some(e => e.type === "response.done")), { timeout: 60_000 }).toBeTruthy();
  expect(historyPosts).toBe(0);
  const system = (prompt: unknown) => (prompt as { role: string }[]).filter(message => message.role === "system");
  expect(system(prompts[1])).toEqual(system(prompts[0]));
  expect(JSON.stringify(prompts[1])).toContain("Remember that we are discussing");
  expect(JSON.stringify(prompts[1])).toContain("For this response only");
  await page.getByRole("button", { name: "End voice session" }).click();
  await expect(composer).toBeEnabled();
  await composer.fill("Now explain its habitat in writing.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => prompts.length).toBe(3);
  expect(system(prompts[2])).toEqual(system(prompts[1]));
  expect(JSON.stringify((prompts[2] as unknown[]).at(-1))).not.toContain("For this response only");
  expect(JSON.stringify(prompts[2])).toContain("For this response only");
  await expect(page.getByRole("button", { name: "Start voice conversation" })).toBeEnabled();
  expect(new URL(page.url()).pathname.split("/").at(-1)).toBe(originalChatId);
  await expect.poll(() => {
    const db = openE2eDatabase();
    const rows = db.prepare("SELECT role, metadata FROM messages WHERE chat_id=? ORDER BY rowid").all(originalChatId);
    db.close();
    return rows;
  }).toMatchObject([
    { role: "user" }, { role: "assistant" }, { role: "user", metadata: expect.stringContaining("voice-v1") },
    { role: "assistant" }, { role: "user" }, { role: "assistant" },
  ]);
  await page.reload();
  await expect(page.getByText(answer, { exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "Start voice conversation" }).click();
  await expect(page.getByText("Listening", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Mute microphone" }).click();
  const doneCount = () => page.evaluate(() => (window as unknown as { voiceEvents: { type: string }[] }).voiceEvents.filter(e => e.type === "response.done").length);
  const setStt = (url: string) => {
    const db = openE2eDatabase();
    db.prepare("UPDATE server_capabilities SET base_url=? WHERE id='stt'").run(url);
    db.close();
  };
  setStt("http://127.0.0.1:1");
  await speak();
  await expect(page.getByRole("alert").filter({ hasText: "could not be transcribed" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Listening", { exact: true })).toBeVisible();
  setStt("http://127.0.0.1:15092");
  modelFailure = true;
  await speak();
  await expect(page.getByRole("alert").filter({ hasText: "voice response failed" })).toBeVisible({ timeout: 30_000 });
  await expect.poll(doneCount, { timeout: 30_000 }).toBe(1);
  modelFailure = false;
  await speak();
  await expect.poll(() => prompts.length, { timeout: 30_000 }).toBe(4);
  await expect.poll(doneCount, { timeout: 60_000 }).toBe(2);
  await expect(page.getByRole("alert").filter({ hasText: "voice response failed" })).toHaveCount(0);
  // Tools execute in the normal server loop. The realtime browser sends no
  // function_call_output and the canonical assistant keeps the rich tool part.
  const toolsDb = openE2eDatabase();
  toolsDb.prepare("UPDATE model_configs SET tool_calling_enabled=1 WHERE id=?").run(model.id);
  toolsDb.close();
  toolMode = true;
  await composer.fill("Remember that my favorite bird is the blue heron.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(doneCount, { timeout: 60_000 }).toBe(3);
  expect(JSON.stringify(providerTools)).toContain("set_memory");
  const savedDb = openE2eDatabase();
  expect(savedDb.prepare("SELECT key,value FROM memories").all()).toEqual([
    { key: "favorite_bird", value: "My favorite bird is the blue heron." },
  ]);
  const toolAnswer = savedDb.prepare("SELECT parts FROM messages WHERE chat_id=? AND role='assistant' ORDER BY rowid DESC LIMIT 1").get(originalChatId) as { parts: string };
  savedDb.close();
  expect(JSON.parse(toolAnswer.parts)).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "tool-set_memory", state: "output-available", output: expect.objectContaining({ ok: true }) }),
  ]));
  const clientToolReplies = await page.evaluate(() => JSON.stringify((window as unknown as { voiceSent: unknown[] }).voiceSent));
  expect(clientToolReplies).not.toContain("function_call_output");
  await page.screenshot({ path: testInfo.outputPath("unified-voice.png"), fullPage: true });
  toolMode = false;

  delayedResponse = true;
  await composer.fill("Give me a long description of the bird.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/chat/${originalChatId}/stream/status`)).json()).active).toBe(true);
  await expect(page.getByText("I will begin a longer answer.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop assistant" }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/chat/${originalChatId}/stream/status`)).json()).status).toBe("aborted");
  delayedResponse = false;
  await expect.poll(doneCount, { timeout: 30_000 }).toBe(4);

  // Sending text cancels a still-generating answer and retains its partial text.
  delayedResponse = true;
  await composer.fill("Begin another long answer for interruption.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/chat/${originalChatId}/stream/status`)).json()).active).toBe(true);
  const oldStream = (await (await page.request.get(`/api/chat/${originalChatId}/stream/status`)).json()).streamId;
  await expect(page.getByText("I will begin a longer answer.", { exact: true })).toHaveCount(2);
  delayedResponse = false;
  await composer.fill("Stop that answer and tell me where the bird lives.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(doneCount, { timeout: 30_000 }).toBe(6);
  const interruptedDb = openE2eDatabase();
  expect(interruptedDb.prepare("SELECT status FROM chat_generations WHERE id=?").get(oldStream)).toEqual({ status: "aborted" });
  interruptedDb.close();
  await expect(page.getByText("I will begin a longer answer.", { exact: true })).toHaveCount(2);
  await expect(page.getByText("This should be cancelled.", { exact: false })).toHaveCount(0);

  // A completed model answer can still have many seconds of speech buffered.
  longResponse = true;
  const audioCount = () => page.evaluate(() => (window as unknown as { playbackEvents: { kind: string }[] }).playbackEvents.filter(event => event.kind === "audio").length);
  const beforeAudio = await audioCount();
  await composer.fill("Give me a long answer to listen to.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(audioCount, { timeout: 60_000 }).toBeGreaterThan(beforeAudio);
  await expect.poll(async () => (await (await page.request.get(`/api/chat/${originalChatId}/stream/status`)).json()).status).toBe("complete");
  const completedStream = (await (await page.request.get(`/api/chat/${originalChatId}/stream/status`)).json()).streamId;
  const clears = () => page.evaluate(() => (window as unknown as { playbackEvents: { kind: string }[] }).playbackEvents.filter(event => event.kind === "clear").length);
  const beforeClear = await clears();
  longResponse = false;
  // Typing alone does not interrupt playback.
  await composer.fill("Enough detail. Give me the short answer.");
  expect(await clears()).toBe(beforeClear);
  await page.getByRole("button", { name: "Send message" }).click();
  expect(await clears()).toBeGreaterThan(beforeClear);
  await expect.poll(doneCount, { timeout: 60_000 }).toBe(8);
  const completedDb = openE2eDatabase();
  expect(completedDb.prepare("SELECT status FROM chat_generations WHERE id=?").get(completedStream)).toEqual({ status: "complete" });
  const savedLongAnswer = completedDb.prepare("SELECT parts FROM messages WHERE id=(SELECT response_message_id FROM chat_generations WHERE id=?)").get(completedStream) as { parts: string };
  expect(savedLongAnswer.parts).toContain(longAnswer);
  completedDb.close();
  await expect(page.getByRole("button", { name: "End voice session" })).toBeVisible();
  await expect(page.getByText("Not confirmed sent.", { exact: false })).toHaveCount(0);

  // Inspect the actual input reaching real Kokoro, including citations split
  // across provider deltas, while canonical history retains the rich answer.
  citationResponse = true;
  speechInputs = [];
  const beforeCitedAudio = await audioCount();
  await composer.fill("Describe the bird with citations.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(doneCount, { timeout: 60_000 }).toBe(9);
  expect(await audioCount()).toBeGreaterThan(beforeCitedAudio);
  expect(speechInputs.join(" ").replace(/\s+/g, " ").trim()).toBe(spokenCitedAnswer);
  const citedDb = openE2eDatabase();
  const savedCitedAnswer = citedDb.prepare("SELECT parts FROM messages WHERE chat_id=? AND role='assistant' ORDER BY rowid DESC LIMIT 1").get(originalChatId) as { parts: string };
  citedDb.close();
  expect(JSON.parse(savedCitedAnswer.parts)).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "text", text: citedAnswer }),
  ]));
  citationResponse = false;

  await page.getByRole("button", { name: "End voice session" }).click();
  await expect.poll(async () => {
    const pool = await (await request.get(`${voiceUrl}/v1/pool`)).json();
    return pool.size - pool.in_use;
  }).toBe(1);
  const invalid = await page.evaluate(() => new Promise<number>(resolve => {
    const ws = new WebSocket(`${location.origin.replace("http", "ws")}/api/voice/realtime`, ["realtime", "openai-insecure-api-key.invalid"]);
    ws.onclose = event => resolve(event.code);
  }));
  expect(invalid).not.toBe(1000);
  const grantResponse = await page.request.post("/api/voice/session", { data: {
    chatId: "binding-test", modelConfigId: model.id,
  } });
  expect(grantResponse.ok()).toBeTruthy();
  const grant = await grantResponse.json();
  const binding = await page.evaluate(token => new Promise<string>(resolve => {
    const ws = new WebSocket(`${location.origin.replace("http", "ws")}/api/voice/realtime`, ["realtime", `openai-insecure-api-key.${token}`]);
    ws.onopen = () => ws.send(JSON.stringify({ type: "session.update", session: { type: "realtime", model: "overtchat" } }));
    ws.onmessage = message => {
      const event = JSON.parse(message.data);
      if (event.type === "error") { resolve(event.error.type); ws.close(); }
    };
  }), grant.token);
  expect(binding).toBe("invalid_session_model");
  await page.request.delete("/api/voice/session", { data: { sessionId: grant.sessionId } });
});
