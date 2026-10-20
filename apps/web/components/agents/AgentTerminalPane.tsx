"use client";

import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { RotateCcw, Square, X } from "lucide-react";
import {
  AGENT_TERMINAL_MAX_INPUT_CHARS, TERMINAL_STREAM_PROTOCOL, TERMINAL_MAX_BUFFER_BYTES,
  isTerminalViewMessage, type TerminalControl, type AgentTerminalSize,
} from "@overtchat/agent-bridge";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api-url";
import { cn } from "@/lib/utils";

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


export function AgentTerminalPane({ sessionId, active, onClose }: {
  sessionId: string; active: boolean; onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  const sendRef = useRef<(control: TerminalControl) => void>(() => {});
  const resumeRef = useRef<() => void>(() => {});
  const sizeRef = useRef<AgentTerminalSize>({ cols: 80, rows: 24 });
  const [status, setStatus] = useState("Connecting…");
  const [error, setError] = useState("");
  const [exited, setExited] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      cursorBlink: true, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13, lineHeight: 1.15, scrollback: 10_000, theme: terminalTheme(container),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    let disposed = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let fitFrame = 0;
    let ready = false;
    let revision = 0;
    let generation = 0;
    let snapshotGeneration = 0;
    let attempt = 0;
    let connecting = false;
    let exitLabel = "";
    let pendingWrites = 0;
    let restoring = false;
    let restoreBuffer: string[] = [];
    let restoreBytes = 0;
    let request: AbortController | undefined;

    const send = (control: TerminalControl) => {
      if (!ready || socket?.readyState !== WebSocket.OPEN) return;
      const data = JSON.stringify(control);
      if (socket.bufferedAmount + new TextEncoder().encode(data).byteLength > 256 * 1024) {
        setError("Terminal input is congested. Reconnect before typing again.");
        ready = false;
        socket.close();
        return;
      }
      socket.send(data);
    };
    sendRef.current = send;
    const fitTerminal = (claim = false) => {
      if (!activeRef.current || !container.clientWidth || !container.clientHeight) return;
      fit.fit();
      const size = { cols: Math.min(1000, Math.max(2, terminal.cols)), rows: Math.min(1000, Math.max(1, terminal.rows)) };
      if (claim || size.cols !== sizeRef.current.cols || size.rows !== sizeRef.current.rows) {
        sizeRef.current = size;
        send({ type: "resize", size, claim });
      }
    };
    const write = (data: string) => {
      const bytes = new TextEncoder().encode(data).byteLength;
      if (pendingWrites + bytes > TERMINAL_MAX_BUFFER_BYTES) { socket?.close(); return; }
      pendingWrites += bytes;
      terminal.write(data, () => { pendingWrites -= bytes; });
    };
    const dataSubscription = terminal.onData((data) => {
      if (restoring) return;
      for (let offset = 0; offset < data.length;) {
        let end = Math.min(offset + AGENT_TERMINAL_MAX_INPUT_CHARS, data.length);
        if (end < data.length && /[\uD800-\uDBFF]/u.test(data[end - 1])) end -= 1;
        send({ type: "input", data: data.slice(offset, end) });
        offset = end;
      }
    });
    const claim = () => fitTerminal(true);
    container.addEventListener("pointerdown", claim);
    container.addEventListener("focusin", claim);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && (event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyC" && terminal.hasSelection()) {
        void navigator.clipboard?.writeText(terminal.getSelection()).catch(() => setError("Copy failed. Use the browser copy command."));
        return false;
      }
      return true;
    });
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(() => fitTerminal());
    });
    resize.observe(container);
    const theme = new MutationObserver(() => { terminal.options.theme = terminalTheme(container); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });

    const connect = async () => {
      if (disposed) return;
      connecting = true;
      const epoch = ++generation;
      ready = false;
      setStatus(attempt ? "Reconnecting…" : "Connecting…");
      fitTerminal();
      request = new AbortController();
      try {
        const response = await fetch(apiUrl(`/api/agent-sessions/${encodeURIComponent(sessionId)}/terminal`), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sizeRef.current), signal: request.signal,
        });
        if (!response.ok) {
          const value = await response.json().catch(() => null) as { error?: string } | null;
          throw Object.assign(new Error(value?.error ?? `Terminal unavailable (${response.status}).`), { retry: response.status >= 500 });
        }
        const grant = await response.json() as { path: string; ticket: string };
        if (disposed || generation !== epoch) return;
        const url = new URL(apiUrl(grant.path), window.location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        const connection = new WebSocket(url, [TERMINAL_STREAM_PROTOCOL, `ticket.${grant.ticket}`]);
        socket = connection;
        connection.onmessage = (event) => {
          if (disposed || socket !== connection) return;
          let message: unknown;
          try { message = JSON.parse(event.data as string); } catch { connection.close(); return; }
          if (!isTerminalViewMessage(message)) { connection.close(); return; }
          if (message.type === "error") {
            setError(message.message);
            ready = true;
            return;
          }
          if (message.type === "snapshot") {
            const baseline = ++snapshotGeneration;
            ready = false;
            revision = message.snapshot.revision;
            exitLabel = message.snapshot.exited ? `Exited (${message.snapshot.exitCode ?? message.snapshot.signal ?? "unknown"})` : "";
            setExited(message.snapshot.exited);
            restoring = true;
            restoreBuffer = [];
            restoreBytes = 0;
            const snapshot = message.snapshot;
            terminal.write("", () => {
              if (disposed || socket !== connection || baseline !== snapshotGeneration) return;
              terminal.reset();
              terminal.resize(snapshot.cols, snapshot.rows);
              terminal.write(snapshot.data, () => {
                if (disposed || socket !== connection || baseline !== snapshotGeneration) return;
                for (const output of restoreBuffer) write(output);
                restoreBuffer = [];
                restoring = false;
                ready = true;
                attempt = 0;
                setStatus(exitLabel || "Connected");
                setError("");
                fitTerminal(true);
                if (activeRef.current) terminal.focus();
              });
            });
            return;
          }
          if (message.revision !== revision + 1) { connection.close(); return; }
          revision = message.revision;
          if (message.type === "exit") {
            setExited(true);
            exitLabel = `Exited (${message.exitCode ?? message.signal ?? "unknown"})`;
            setStatus(exitLabel);
          } else if (restoring) {
            restoreBytes += new TextEncoder().encode(message.data).byteLength;
            if (restoreBytes > TERMINAL_MAX_BUFFER_BYTES) { connection.close(); return; }
            restoreBuffer.push(message.data);
          } else write(message.data);
        };
        connection.onclose = (event) => {
          if (disposed || socket !== connection) return;
          ready = false;
          setStatus("Disconnected");
          if (event.code === 1008) { setError("Terminal access expired. Reopen the terminal to reconnect."); return; }
          schedule();
        };
      } catch (cause) {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        if (!(cause instanceof Error && "retry" in cause && cause.retry === false)) schedule();
        else setStatus("Unavailable");
      } finally {
        if (generation === epoch) connecting = false;
      }
    };
    const schedule = () => {
      if (disposed || retry) return;
      setStatus("Reconnecting…");
      retry = setTimeout(() => { retry = undefined; void connect(); }, Math.min(250 * 2 ** attempt++, 5000));
    };
    resumeRef.current = () => {
      fitTerminal(true);
      terminal.focus();
      if ((!socket || socket.readyState === WebSocket.CLOSED) && !retry && !connecting) void connect();
    };
    void connect();
    return () => {
      disposed = true;
      ready = false;
      request?.abort();
      if (retry) clearTimeout(retry);
      cancelAnimationFrame(fitFrame);
      socket?.close();
      resize.disconnect();
      theme.disconnect();
      container.removeEventListener("pointerdown", claim);
      container.removeEventListener("focusin", claim);
      dataSubscription.dispose();
      terminal.dispose();
      sendRef.current = () => {};
      resumeRef.current = () => {};
    };
  }, [sessionId]);
  useEffect(() => { if (active) resumeRef.current(); }, [active]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="Workspace terminal">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <span className="text-xs font-medium">Terminal</span>
        <span className={cn("size-1.5 rounded-full", status === "Connected" && !exited ? "bg-emerald-500" : "bg-muted-foreground/60")} aria-hidden="true" />
        <span className="truncate text-[11px] text-muted-foreground" role="status">{error || status}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {!exited && <Button variant="ghost" size="icon-sm" aria-label="Stop terminal" title="Stop terminal" onClick={() => sendRef.current({ type: "kill" })}><Square className="size-3.5" /></Button>}
          <Button variant="ghost" size="icon-sm" aria-label="Restart terminal" title="Restart terminal" onClick={() => sendRef.current({ type: "restart", size: sizeRef.current })}><RotateCcw className="size-3.5" /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close terminal panel" title="Close terminal panel" onClick={onClose}><X className="size-3.5" /></Button>
        </div>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden bg-background p-2" />
    </section>
  );
}
