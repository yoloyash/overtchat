import "./desktop.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createHashHistory } from "@tanstack/react-router";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { ThemeProvider } from "@/components/ThemeProvider";
import { setApiOrigin } from "@/lib/api-url";
import { FONT_STORAGE_KEY, fontCssValueById } from "@/lib/fonts";
import { SIDEBAR_COLLAPSED_ATTRIBUTE, SIDEBAR_COLLAPSED_STORAGE_KEY } from "@/lib/sidebar";
import { ConnectScreen } from "./ConnectScreen";
import { ServerProblemScreen } from "./ServerProblemScreen";
import { shell } from "./shell";

function stored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** What the web app's layout scripts apply before first paint. */
function applyStoredPreferences(): void {
  const root = document.documentElement;
  const theme = localStorage.getItem("theme");
  const dark =
    theme === "dark" ||
    (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.add(dark ? "dark" : "light");
  root.style.colorScheme = dark ? "dark" : "light";

  const font = stored(FONT_STORAGE_KEY);
  const fontValue = typeof font === "string" ? fontCssValueById[font] : undefined;
  if (fontValue) root.style.setProperty("--app-font-sans", fontValue);

  if (stored(SIDEBAR_COLLAPSED_STORAGE_KEY) === true) {
    root.setAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE, "");
  }
}

function render(children: ReactNode): void {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider>{children}</ThemeProvider>
    </StrictMode>,
  );
}

async function start(): Promise<void> {
  applyStoredPreferences();
  const { server, lastAddress } = await shell.boot();
  if (!server) {
    render(
      <AuthFrame>
        <ConnectScreen lastAddress={lastAddress} />
      </AuthFrame>,
    );
    return;
  }
  if (server.problem) {
    render(
      <AuthFrame>
        <ServerProblemScreen origin={server.origin} problem={server.problem} />
      </AuthFrame>,
    );
    return;
  }
  // The UI resolves every request against the server, so set it before loading.
  setApiOrigin(server.origin);
  const { App } = await import("@/spa/App");
  render(<App history={createHashHistory()} />);
}

void start();
