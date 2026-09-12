import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { NOW, USER, seedDemo, agentSnapshot } from "./fixtures";

const output = process.env.MEDIA_OUTPUT!;
const baseURL = process.env.MEDIA_BASE_URL!;

async function installFixtures(context: BrowserContext) {
  await context.route("**/api/capabilities", (route) => route.fulfill({ json: { capabilities: {
    search: { provider: "bundled", available: true, bundledInstalled: true },
    stt: { provider: "bundled", available: true, bundledInstalled: true },
    tts: { provider: "bundled", available: true, bundledInstalled: true },
    voice: { available: true, installed: true, unavailableReason: null },
  } } }));
  await context.route("**/api/voice/session", (route) => route.fulfill({ json: {
    token: "demo-voice-ticket", chatId: "voice", endpoint: "/api/voice/realtime", voice: "af_heart", tools: [],
  } }));
  await context.routeWebSocket("**/api/voice/realtime*", (socket) => {
    const session = { id: "demo-voice", object: "realtime.session", model: "demo-voice-ticket" };
    socket.send(JSON.stringify({ type: "session.created", event_id: "created", session }));
    socket.onMessage((message) => {
      const event = JSON.parse(String(message));
      if (event.type === "session.update") {
        socket.send(JSON.stringify({ type: "session.updated", event_id: "updated", session: { ...session, ...event.session } }));
      }
    });
  });
  await context.route(/\/api\/agent-sessions\/demo-agent(?:\?.*)?$/, (route) => route.fulfill({ json: { snapshot: agentSnapshot } }));
  // A fulfilled SSE response closes immediately. Keep the fixture transport open,
  // as a healthy connector does, using the same approach as agent-runtime e2e tests.
  await context.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    class DemoEventSource extends EventTarget {
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      readyState = 1;
      constructor(url: string | URL, options?: EventSourceInit) {
        super();
        if (!String(url).includes("/api/agent-sessions/demo-agent/events")) {
          return new NativeEventSource(url, options);
        }
        window.setTimeout(() => this.onopen?.(new Event("open")), 0);
      }
      close() { this.readyState = 2; }
    }
    Object.assign(window, { EventSource: DemoEventSource });
  });
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => {
      image.loading = "eager";
      return image.decode();
    }));
  });
  await page.mouse.move(0, 0);
  await expect(page.locator("body")).not.toContainText("Application error");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function saveFrame(page: Page, name: string) {
  await settle(page);
  const raw = await page.screenshot({ animations: "disabled", caret: "hide" });
  const presentation = await page.context().newPage();
  // Load the app's actual generated fonts and design tokens, including future changes.
  const style = await page.evaluate(() => ({
    sheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map((el) => (el as HTMLLinkElement).href),
    className: document.documentElement.className,
  }));
  await presentation.goto(`${baseURL}/login`);
  await presentation.setContent(await fs.readFile(path.join(__dirname, "presentation.html"), "utf8"));
  await presentation.evaluate(async ({ sheets, className }) => {
    document.documentElement.className = className;
    await Promise.all(sheets.map((href) => new Promise<void>((resolve, reject) => {
      const link = document.createElement("link"); link.rel = "stylesheet"; link.href = href; document.head.append(link);
      link.onload = () => resolve(); link.onerror = () => reject(new Error(`Could not load ${href}`));
    })));
  }, style);
  const viewport = page.viewportSize()!;
  await presentation.setViewportSize({ width: viewport.width + 48, height: viewport.height + 48 });
  await presentation.evaluate((src) => {
    const frame = document.createElement("div"); frame.id = "frame";
    const image = document.createElement("img"); image.id = "capture"; image.src = src;
    frame.append(image); document.body.replaceChildren(frame);
  }, `data:image/png;base64,${raw.toString("base64")}`);
  await settle(presentation);
  await presentation.locator("#frame").screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
  if (name === "chat") {
    await presentation.setViewportSize({ width: 800, height: 156 });
    await presentation.evaluate(() => {
      const banner = document.createElement("div"); banner.id = "banner"; banner.textContent = "overtchat";
      document.body.replaceChildren(banner);
    });
    await settle(presentation);
    await presentation.locator("#banner").screenshot({ path: path.join(output, "banner.png"), animations: "disabled" });
  }
  await presentation.close();
}

test("capture the real app with reproducible editorial fixtures", async ({ browser }) => {
  const bootstrap = await browser.newContext({ baseURL });
  const signup = await bootstrap.request.post("/api/auth/sign-up/email", { data: USER, headers: { Origin: baseURL } });
  expect(signup.ok(), await signup.text()).toBe(true);
  seedDemo(process.env.MEDIA_DATABASE!);
  const storageState = await bootstrap.storageState();
  await bootstrap.close();

  for (const theme of ["dark"] as const) {
    const context = await browser.newContext({
      baseURL, storageState, viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2,
      colorScheme: theme, reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block",
    });
    const failures: string[] = [];
    context.on("page", (page) => page.on("pageerror", (error) => failures.push(error.message)));
    // Captures never call an LLM, speech provider, search engine, or agent executable.
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseURL || ["data:", "blob:"].includes(url.protocol)) return route.continue();
      // Normalize demo favicons with the app's icon library; no third-party artwork or live fetch.
      if (url.hostname === "www.google.com" && url.pathname === "/s2/favicons") {
        const body = await route.request().frame().locator("svg.lucide-globe").first().evaluate((svg) => {
          const icon = svg.cloneNode(true) as SVGElement;
          icon.setAttribute("color", getComputedStyle(svg).color);
          return icon.outerHTML;
        });
        return route.fulfill({ contentType: "image/svg+xml", body });
      }
      failures.push(`Unexpected external request: ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await context.addInitScript(({ theme }) => {
      if (location.protocol === "http:" || location.protocol === "https:") {
        localStorage.setItem("theme", theme);
        localStorage.setItem("overtchat_web_search_enabled", "true");
      }
    }, { theme });
    await installFixtures(context);
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    await page.goto("/chat/local-ai");
    await expect(page.getByText("Keep It Simple", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("Message… or / for commands")).toBeVisible();
    await saveFrame(page, "chat");

    await page.goto("/chat/search");
    await expect(page.getByText("Three building blocks for your setup:", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "3 Sources" }).click();
    await saveFrame(page, "search");

    await page.goto("/chat/voice");
    await page.getByRole("button", { name: "Start voice conversation" }).click();
    await expect(page.getByRole("button", { name: "Mute microphone", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
    await expect(page.getByText("Listening", { exact: true })).toBeVisible();
    await saveFrame(page, "voice");
    await page.getByRole("button", { name: "End voice session" }).click();

    await page.goto("/agents/demo-agent");
    await expect(page.getByTestId("agent-composer")).toBeVisible();
    await expect(page.getByText("The reading list is ready.", { exact: false })).toBeVisible();
    await expect(page.getByText("Reconnecting", { exact: true })).not.toBeVisible();
    await saveFrame(page, "agent-connections");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/chat/local-ai");
    await expect(page.getByPlaceholder("Message… or / for commands")).toBeVisible();
    await saveFrame(page, "mobile-web");
    expect(failures, "No page errors or unexpected external requests").toEqual([]);
    await context.close();
  }
});
