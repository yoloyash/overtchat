"use client";

import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { RotateCcw, Square, X } from "lucide-react";
import {
  AGENT_TERMINAL_MAX_INPUT_CHARS,
  type AgentTerminalEvent,
  type AgentTerminalSize,
  type AgentTerminalSnapshot,
} from "@overtchat/agent-bridge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "error";

let terminalControlSequence = 0;

function createTerminalControlId(): string {
  terminalControlSequence += 1;
  return `${Date.now().toString(36)}-${terminalControlSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function terminalTheme(element: HTMLElement) {
  const styles = getComputedStyle(element);
  return {
    background: styles.getPropertyValue("--background").trim(),
    foreground: styles.getPropertyValue("--foreground").trim(),
    cursor: styles.getPropertyValue("--foreground").trim(),
    cursorAccent: styles.getPropertyValue("--background").trim(),
    selectionBackground: styles.getPropertyValue("--accent").trim(),
    black: "#18181b",
    brightBlack: "#71717a",
    red: "#ef4444",
    brightRed: "#f87171",
    green: "#84a75b",
    brightGreen: "#a3c778",
    yellow: "#d6a84b",
    brightYellow: "#f0c96b",
    blue: "#60a5fa",
    brightBlue: "#93c5fd",
    magenta: "#c084fc",
    brightMagenta: "#d8b4fe",
    cyan: "#22d3ee",
    brightCyan: "#67e8f9",
    white: "#d4d4d8",
    brightWhite: "#fafafa",
  };
}

function readSnapshot(value: unknown): AgentTerminalSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Partial<AgentTerminalSnapshot>;
  return typeof snapshot.sessionId === "string" &&
    Number.isSafeInteger(snapshot.revision) &&
    typeof snapshot.data === "string" &&
    Number.isSafeInteger(snapshot.cols) &&
    Number.isSafeInteger(snapshot.rows) &&
    typeof snapshot.exited === "boolean" &&
    (snapshot.exitCode === null || Number.isSafeInteger(snapshot.exitCode)) &&
    (snapshot.signal === null || Number.isSafeInteger(snapshot.signal))
    ? (snapshot as AgentTerminalSnapshot)
    : null;
}

function readEvent(
  value: unknown,
  type: "output" | "exit",
): AgentTerminalEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (event.type !== type || !Number.isSafeInteger(event.revision)) return null;
  if (type === "output") {
    return typeof event.data === "string"
      ? { type, revision: Number(event.revision), data: event.data }
      : null;
  }
  return (event.exitCode === null || Number.isSafeInteger(event.exitCode)) &&
    (event.signal === null || Number.isSafeInteger(event.signal))
    ? {
        type,
        revision: Number(event.revision),
        exitCode: event.exitCode === null ? null : Number(event.exitCode),
        signal: event.signal === null ? null : Number(event.signal),
      }
    : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function responseError(response: Response): Promise<string> {
  const value = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  return typeof value?.error === "string"
    ? value.error
    : `Terminal request failed (${response.status}).`;
}

export function AgentTerminalPane({
  sessionId,
  active,
  onClose,
}: {
  sessionId: string;
  active: boolean;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<AgentTerminalSize>({ cols: 80, rows: 24 });
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState("");
  const [exited, setExited] = useState(false);
  const [exitLabel, setExitLabel] = useState("");
  const controlUrl = `/api/agent-sessions/${encodeURIComponent(sessionId)}/terminal`;

  useEffect(() => {
    if (!active || !containerRef.current) return;
    const container = containerRef.current;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily:
        getComputedStyle(container)
          .getPropertyValue("--font-geist-mono")
          .trim() || "ui-monospace, monospace",
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 10_000,
      theme: terminalTheme(container),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let preflightTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let inputTimer: ReturnType<typeof setTimeout> | undefined;
    let revision = 0;
    let hasSnapshot = false;
    let inputBuffer = "";
    let inputChain = Promise.resolve();
    let lastSize = sizeRef.current;
    const controlId = createTerminalControlId();

    const post = async (body: unknown) => {
      const response = await fetch(controlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          body && typeof body === "object"
            ? { ...body, controlId }
            : body,
        ),
      });
      if (!response.ok) throw new Error(await responseError(response));
      return response;
    };

    const flushInput = () => {
      inputTimer = undefined;
      const data = inputBuffer;
      inputBuffer = "";
      if (!data) return;
      for (
        let offset = 0;
        offset < data.length;
        offset += AGENT_TERMINAL_MAX_INPUT_CHARS
      ) {
        const chunk = data.slice(
          offset,
          offset + AGENT_TERMINAL_MAX_INPUT_CHARS,
        );
        inputChain = inputChain.then(() =>
          post({ type: "input", data: chunk }).then(() => undefined),
        );
      }
      inputChain = inputChain.catch((cause) => {
        if (disposed) return;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    };

    const dataDisposable = terminal.onData((data) => {
      inputBuffer += data;
      if (!inputTimer) inputTimer = setTimeout(flushInput, 8);
    });

    const dimensions = () => ({
      cols: Math.max(2, terminal.cols || 80),
      rows: Math.max(1, terminal.rows || 24),
    });

    const applyFit = (notify: boolean) => {
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      const next = dimensions();
      if (next.cols === lastSize.cols && next.rows === lastSize.rows) return;
      lastSize = next;
      sizeRef.current = next;
      if (!notify || !hasSnapshot) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        void post({ type: "resize", size: lastSize }).catch((cause) => {
          if (!disposed)
            setError(cause instanceof Error ? cause.message : String(cause));
        });
      }, 60);
    };

    const reconnect = () => {
      if (disposed || reconnectTimer) return;
      source?.close();
      setStatus("reconnecting");
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, 250);
    };

    const acceptEvent = (event: AgentTerminalEvent) => {
      if (!hasSnapshot || event.revision !== revision + 1) {
        reconnect();
        return;
      }
      revision = event.revision;
      if (event.type === "output") {
        terminal.write(event.data);
        return;
      }
      setExited(true);
      setExitLabel(
        event.signal !== null
          ? `Exited from signal ${event.signal}`
          : `Exited with code ${event.exitCode ?? "unknown"}`,
      );
    };

    const connect = () => {
      if (disposed) return;
      source?.close();
      hasSnapshot = false;
      revision = 0;
      setStatus("connecting");
      setError("");
      const size = dimensions();
      lastSize = size;
      sizeRef.current = size;
      source = new EventSource(
        `${controlUrl}/events?cols=${size.cols}&rows=${size.rows}&controlId=${encodeURIComponent(controlId)}`,
      );
      source.onopen = () => {
        if (!disposed) setStatus(hasSnapshot ? "connected" : "connecting");
      };
      source.addEventListener("terminal-snapshot", (message) => {
        const snapshot = readSnapshot(
          parseJson((message as MessageEvent<string>).data),
        );
        if (!snapshot || snapshot.sessionId !== sessionId) {
          reconnect();
          return;
        }
        revision = snapshot.revision;
        hasSnapshot = true;
        setExited(snapshot.exited);
        setExitLabel(
          snapshot.exited
            ? snapshot.signal !== null
              ? `Exited from signal ${snapshot.signal}`
              : `Exited with code ${snapshot.exitCode ?? "unknown"}`
            : "",
        );
        terminal.reset();
        terminal.write(snapshot.data, () => {
          if (disposed) return;
          applyFit(true);
          terminal.focus();
        });
        setStatus("connected");
      });
      source.addEventListener("terminal-output", (message) => {
        const event = readEvent(
          parseJson((message as MessageEvent<string>).data),
          "output",
        );
        if (event) acceptEvent(event);
        else reconnect();
      });
      source.addEventListener("terminal-exit", (message) => {
        const event = readEvent(
          parseJson((message as MessageEvent<string>).data),
          "exit",
        );
        if (event) acceptEvent(event);
        else reconnect();
      });
      source.onerror = () => {
        if (!disposed) setStatus("reconnecting");
      };
    };

    const resizeObserver = new ResizeObserver(() => applyFit(true));
    resizeObserver.observe(container);
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = terminalTheme(container);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    applyFit(false);
    const preflight = async () => {
      try {
        const response = await fetch(controlUrl, { cache: "no-store" });
        if (!response.ok) {
          const message = await responseError(response);
          if (response.status === 503 && !disposed) {
            setStatus("reconnecting");
            setError(message);
            preflightTimer = setTimeout(() => void preflight(), 1_000);
            return;
          }
          throw new Error(message);
        }
        if (!disposed) connect();
      } catch (cause) {
        if (disposed) return;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void preflight();

    return () => {
      disposed = true;
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (preflightTimer) clearTimeout(preflightTimer);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (inputTimer) clearTimeout(inputTimer);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
    };
  }, [active, controlUrl, sessionId]);

  async function runControl(type: "restart" | "kill") {
    setError("");
    try {
      const response = await fetch(controlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          type === "restart" ? { type, size: sizeRef.current } : { type },
        ),
      });
      if (!response.ok) throw new Error(await responseError(response));
      if (type === "restart") {
        setExited(false);
        setExitLabel("");
        setStatus("reconnecting");
      }
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label="Workspace terminal"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <span className="text-xs font-medium">Terminal</span>
        <span
          className={cn(
            "size-1.5 rounded-full",
            status === "connected" && !exited
              ? "bg-emerald-500"
              : status === "error"
                ? "bg-destructive"
                : "bg-muted-foreground/60",
          )}
          aria-hidden="true"
        />
        <span className="truncate text-[11px] text-muted-foreground">
          {error ||
            exitLabel ||
            (status === "connected" ? "Connected" : "Reconnecting…")}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {!exited && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Stop terminal"
              title="Stop terminal"
              onClick={() => void runControl("kill")}
            >
              <Square className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Restart terminal"
            title="Restart terminal"
            onClick={() => void runControl("restart")}
          >
            <RotateCcw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close terminal panel"
            title="Close terminal panel"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden bg-background p-2"
      />
    </section>
  );
}
