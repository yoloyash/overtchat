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
const answer = "The blue heron lives near the quiet river.";

test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
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
    res.setHeader("Content-Type", "text/event-stream");
    const send = (delta: unknown, finish: string | null) => res.write(`data: ${JSON.stringify({
      id: "completion", object: "chat.completion.chunk", created: 1, model: "fixture",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`);
    send({ role: "assistant", content: answer }, null);
    send({}, "stop");
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
});
test.afterAll(async () => {
  provider?.closeAllConnections();
  if (provider) await new Promise<void>(resolve => provider.close(() => resolve()));
});

test("CPU speech through app origin: history retry after End, auth, and recovery", async ({ page, request }) => {
  test.setTimeout(240_000);
  resetE2eDatabase();
  prompts = [];
  modelFailure = false;
  await page.addInitScript(() => {
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
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
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
  for (const [id, url, model] of [["tts", "http://127.0.0.1:18880", "kokoro"], ["stt", "http://127.0.0.1:15092", "parakeet-tdt-0.6b-v3"]]) {
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
  execFileSync("docker", ["compose", "-f", "../../voice/compose.test.yml", "up", "-d", "voice"]);
  await expect.poll(async () => {
    try { return (await request.get("http://127.0.0.1:18765/v1/pool")).status(); } catch { return 0; }
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
  let allowSaves = false;
  let failedSaves = 0;
  await page.route("**/api/voice/history", async route => {
    if (!allowSaves) {
      failedSaves += 1;
      await route.fulfill({ status: 503, json: { error: "Temporary test outage" } });
    } else await route.continue();
  });
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
  await expect.poll(() => prompts.length, { timeout: 60_000 }).toBeGreaterThan(0);
  expect(JSON.stringify(prompts[0]).toLowerCase()).toContain("heron");
  await expect.poll(() => page.evaluate(() => (window as unknown as { voiceEvents: { type: string }[] }).voiceEvents.some(e => e.type === "response.done")), { timeout: 60_000 }).toBeTruthy();
  expect(failedSaves).toBeGreaterThan(0);
  await expect(page.getByText(/Retrying automatically/)).toBeVisible();
  await page.getByRole("button", { name: "End voice session" }).click();
  allowSaves = true;
  // The first successful save occurs after the audio component unmounts. It
  // must still mark the parent chat as saved/voice and refresh the sidebar.
  await expect(page.getByRole("listitem").filter({ hasText: "Voice test" }).getByLabel("Voice chat"))
    .toBeVisible({ timeout: 40_000 });
  await expect(page.getByPlaceholder("Resume voice to continue")).toBeDisabled();
  await expect.poll(() => {
    const db = openE2eDatabase();
    const rows = db.prepare("SELECT parts FROM messages WHERE role='assistant'").all();
    db.close();
    return JSON.stringify(rows);
  }).toContain(answer);
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
  await expect.poll(doneCount, { timeout: 30_000 }).toBe(2);
  modelFailure = false;
  await speak();
  await expect.poll(() => prompts.length, { timeout: 30_000 }).toBe(2);
  await expect.poll(doneCount, { timeout: 60_000 }).toBe(3);
  await expect(page.getByRole("alert").filter({ hasText: "voice response failed" })).toHaveCount(0);
  if (process.env.VOICE_LIVE_MODEL_URL) {
    const baseUrl = process.env.VOICE_LIVE_MODEL_URL.replace(/\/$/, "");
    const models = await (await request.get(`${baseUrl}/models`)).json();
    const db = openE2eDatabase();
    db.prepare("UPDATE model_configs SET base_url=?, model=?, provider_id='vllm', api_format='auto' WHERE id=?")
      .run(baseUrl, models.data[0].id, model.id);
    db.close();
    await speak();
    await expect.poll(doneCount, { timeout: 90_000 }).toBe(4);
    const last = await page.evaluate(() => {
      const events = (window as unknown as { voiceEvents: { type: string; response?: { status: string; output: unknown[] } }[] }).voiceEvents;
      return events.filter(e => e.type === "response.done").at(-1)?.response;
    });
    expect(last?.status).toBe("completed");
    expect(JSON.stringify(last?.output)).toMatch(/heron/i);
  }
  await page.getByRole("button", { name: "End voice session" }).click();
  await expect.poll(async () => {
    const pool = await (await request.get("http://127.0.0.1:18765/v1/pool")).json();
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
});
