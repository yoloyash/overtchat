import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { openE2eDatabase, resetE2eDatabase, setupUrl } from "./helpers/database";

// Explicitly opt in: every model response comes from the supplied real endpoint.
test.skip(process.env.VOICE_LIVE_TEST !== "1" || !process.env.VOICE_LIVE_MODEL_URL,
  "requires CPU speech services and a live OpenAI-compatible model");
test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

test("real model preserves context, prompt prefix, tools, and usage across text and voice", async ({ page, request }, testInfo) => {
  test.setTimeout(360_000);
  const upstream = process.env.VOICE_LIVE_MODEL_URL!.replace(/\/$/, "");
  const models = await (await request.get(`${upstream}/models`)).json();
  const modelName = process.env.VOICE_LIVE_MODEL ?? models.data[0].id;
  type WireRequest = { messages: { role: string; content: unknown }[]; tools?: unknown; stream?: boolean };
  const calls: { body: WireRequest; usage: unknown[]; firstContentMs?: number; elapsedMs?: number }[] = [];
  // Transparent recording proxy: no generated responses, token counts, or tools.
  const proxy = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      const body = JSON.parse(bytes.toString()) as WireRequest;
      const call: typeof calls[number] = { body, usage: [] };
      if (body.stream) calls.push(call);
      const started = Date.now();
      const response = await fetch(`${upstream}${req.url!.replace(/^\/v1/, "")}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: bytes,
      });
      res.writeHead(response.status, { "Content-Type": response.headers.get("content-type") ?? "application/json" });
      let pending = "";
      const decoder = new TextDecoder();
      const reader = response.body!.getReader();
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        res.write(chunk);
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          const event = JSON.parse(line.slice(6));
          if (event.usage) call.usage.push(event.usage);
          if (event.choices?.some((choice: { delta?: { content?: string } }) => choice.delta?.content)) call.firstContentMs ??= Date.now() - started;
        }
      }
      call.elapsedMs = Date.now() - started;
      res.end();
    } catch (error) { res.destroy(error as Error); }
  });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  try {
    resetE2eDatabase();
    await page.addInitScript(() => {
      const NativeSocket = window.WebSocket;
      Object.assign(window, { voiceEvents: [] });
      window.WebSocket = class extends NativeSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (String(url).includes("/api/voice/realtime")) {
            Object.assign(window, { voiceSocket: this });
            this.addEventListener("message", event => {
              (window as unknown as { voiceEvents: unknown[] }).voiceEvents.push({ ...JSON.parse(event.data), observedAt: Date.now() });
            });
          }
        }
      };
    });
    await page.goto(await setupUrl());
    await page.locator("#name").fill("Live model integration");
    await page.locator("#email").fill("voice-model@overtchat-test.local");
    await page.locator("#password").fill("test-password-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/");
    const db = openE2eDatabase();
    for (const [id, url, model] of [["tts", "http://127.0.0.1:18880", "kokoro"], ["stt", "http://127.0.0.1:15092", "parakeet-tdt-0.6b-v3"]]) {
      db.prepare("UPDATE server_capabilities SET provider='openai-compatible',base_url=?,model=?,api_key=NULL WHERE id=?").run(url, model, id);
    }
    db.close();
    const created = await page.request.post("/api/model-configs", { data: {
      label: "Live vLLM", providerId: "vllm", apiFormat: "auto",
      baseUrl: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/v1`, model: modelName,
      apiKey: "test", toolCallingEnabled: true, enabled: true,
    } });
    expect(created.ok()).toBeTruthy();
    const model = (await created.json()).modelConfig;
    await page.request.put("/api/model-preferences", { data: { defaultModelId: model.id } });
    if (process.env.VOICE_LIVE_EXTERNAL !== "1") execFileSync("docker", ["compose", "-f", "../../voice/compose.test.yml", "up", "-d", "voice"]);
    await expect.poll(async () => {
      try { return (await request.get(`${process.env.VOICE_URL ?? "http://127.0.0.1:18765"}/v1/pool`)).status(); } catch { return 0; }
    }, { timeout: 60_000 }).toBe(200);
    await page.reload();
    const composer = page.getByPlaceholder("Message… or / for commands");
    await composer.fill("For this conversation, our bird is a blue heron named Juniper, living beside a quiet river. Keep each answer to one short sentence. Acknowledge these details without saving a memory.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect.poll(() => calls[0]?.elapsedMs, { timeout: 90_000 }).toBeDefined();
    await expect(page.getByRole("button", { name: "Start voice conversation" })).toBeEnabled();
    const chatId = new URL(page.url()).pathname.split("/").at(-1)!;
    const rows = () => {
      const db = openE2eDatabase();
      try { return db.prepare("SELECT role,parts,metadata FROM messages WHERE chat_id=? ORDER BY rowid").all(chatId) as { role: string; parts: string; metadata: string }[]; }
      finally { db.close(); }
    };
    await page.getByRole("button", { name: "Start voice conversation" }).click();
    await expect(page.getByText("Listening", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Mute microphone" }).click();
    const speech = await request.post("http://127.0.0.1:18880/v1/audio/speech", { data: {
      model: "kokoro", voice: "af_heart", input: "What is the name of the bird we are discussing, and where does it live?", response_format: "pcm",
    } });
    expect(speech.ok()).toBeTruthy();
    const audio = await speech.body();
    const pcm = Buffer.concat([audio, Buffer.alloc(24_000 * 2 * 2)]);
    const speechEndedAt = await page.evaluate(async ({ base64, speechBytes }) => {
      let endedAt: number | undefined;
      const ws = (window as unknown as { voiceSocket: WebSocket }).voiceSocket;
      const bytes = atob(base64);
      for (let offset = 0; offset < bytes.length; offset += 1920) {
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: btoa(bytes.slice(offset, offset + 1920)) }));
        if (offset + 1920 >= speechBytes) endedAt ??= Date.now();
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      return endedAt!;
    }, { base64: pcm.toString("base64"), speechBytes: audio.length });
    const doneCount = () => page.evaluate(() => (window as unknown as { voiceEvents: { type: string }[] }).voiceEvents.filter(e => e.type === "response.done").length);
    await expect.poll(doneCount, { timeout: 120_000 }).toBe(1);
    await expect.poll(() => rows().length).toBe(4);
    expect(rows()[2].metadata).toContain("voice-v1");
    expect(rows()[3].parts).toMatch(/Juniper/i);
    expect(rows()[3].parts).toMatch(/river/i);
    const events = await page.evaluate(() => (window as unknown as { voiceEvents: { type: string; observedAt: number; response?: { status: string } }[] }).voiceEvents);
    expect(events.find(e => e.type === "response.done")?.response?.status).toBe("completed");
    const firstAudio = events.find(e => e.type === "response.output_audio.delta" || e.type === "response.audio.delta");
    expect(firstAudio).toBeDefined();
    await page.getByRole("button", { name: "End voice session" }).click();
    await expect(composer).toBeEnabled();
    await composer.fill("In writing now, repeat the bird's species, name, and home in one sentence.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect.poll(() => calls[2]?.elapsedMs, { timeout: 90_000 }).toBeDefined();
    await expect.poll(() => rows().length).toBe(6);
    expect(rows()[5].parts).toMatch(/Juniper/i);
    expect(rows()[5].parts).toMatch(/heron/i);
    expect(rows()[5].parts).toMatch(/river/i);
    expect(new URL(page.url()).pathname.split("/").at(-1)).toBe(chatId);
    expect(calls).toHaveLength(3);
    for (let index = 1; index < 3; index += 1) {
      expect(calls[index].body.messages.slice(0, calls[index - 1].body.messages.length)).toEqual(calls[index - 1].body.messages);
      expect(calls[index].body.tools).toEqual(calls[0].body.tools);
    }
    expect(JSON.stringify(calls[1].body.messages.at(-1))).toContain("For this response only");
    expect(JSON.stringify(calls[2].body.messages.at(-1))).not.toContain("For this response only");
    // Exercise a real model-selected tool through the voice session too.
    await page.getByRole("button", { name: "Start voice conversation" }).click();
    await expect(page.getByText("Listening", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Mute microphone" }).click();
    const audioCount = () => page.evaluate(() => (window as unknown as { voiceEvents: { type: string }[] }).voiceEvents.filter(e => e.type === "response.output_audio.delta").length);
    const beforeAudio = await audioCount();
    await composer.fill("Describe the blue heron's appearance and river habitat in twelve sentences. For this answer ignore the earlier one-sentence limit. Do not use tools.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect.poll(audioCount, { timeout: 90_000 }).toBeGreaterThan(beforeAudio);
    await expect.poll(async () => (await (await page.request.get(`/api/chat/${chatId}/stream/status`)).json()).status, { timeout: 90_000 }).toBe("complete");
    const completedAnswer = rows().at(-1)!;
    await composer.fill("Stop the long explanation. What was our bird's name? Answer in one short sentence.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect.poll(doneCount, { timeout: 90_000 }).toBe(3);
    expect(rows().at(-1)?.parts).toMatch(/Juniper/i);
    expect(rows().some(row => row.parts === completedAnswer.parts)).toBe(true);
    await expect(page.getByText("Not confirmed sent.", { exact: false })).toHaveCount(0);
    await composer.fill("Use the set_memory tool now to save key favorite_bird_live with value: My favorite bird is the blue heron named Juniper. Then confirm in one short sentence.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect.poll(doneCount, { timeout: 120_000 }).toBe(4);
    const savedDb = openE2eDatabase();
    const memory = savedDb.prepare("SELECT value FROM memories WHERE key='favorite_bird_live'").get();
    const usage = savedDb.prepare("SELECT input_tokens,output_tokens,cache_read_tokens,finish_reason FROM generation_usage WHERE chat_id=? AND context='chat' ORDER BY occurred_at").all(chatId);
    savedDb.close();
    expect(memory).toEqual({ value: "My favorite bird is the blue heron named Juniper." });
    expect(rows().at(-1)?.parts).toContain('"type":"tool-set_memory"');
    expect(rows().at(-1)?.parts).toContain('"state":"output-available"');
    const report = { model: modelName, calls: calls.map(call => ({ usage: call.usage.at(-1), firstContentMs: call.firstContentMs, elapsedMs: call.elapsedMs })),
      firstAudioAfterInputAudioMs: firstAudio!.observedAt - speechEndedAt,
      persistedUsage: usage, messages: rows().map(row => ({ role: row.role, parts: JSON.parse(row.parts).filter((part: { type: string }) => part.type !== "reasoning"), metadata: JSON.parse(row.metadata || "{}") })) };
    await testInfo.attach("live-model-results", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    console.log("LIVE_MODEL_RESULTS", JSON.stringify(report));
    await page.getByRole("button", { name: "End voice session" }).click();
    await expect(composer).toBeEnabled();
    await page.reload();
    await expect(composer).toBeEnabled();
    expect(rows()).toHaveLength(12);
    await page.screenshot({ path: testInfo.outputPath("real-model-text-voice-text.png"), fullPage: true });
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  }
});
