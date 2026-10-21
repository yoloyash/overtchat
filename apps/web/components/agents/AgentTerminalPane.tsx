"use client";

import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Ellipsis,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  RotateCcw,
  Search,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Menu } from "@base-ui/react/menu";
import { ContextMenu } from "@base-ui/react/context-menu";
import { readText, writeText } from "clipboard-polyfill";
import { UpdateActionTooltip } from "@/components/UpdateActionTooltip";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  terminalFont,
  terminalTheme,
  terminalWebUrl,
} from "./terminal-presentation";
import {
  AGENT_TERMINAL_MAX_INPUT_CHARS,
  TERMINAL_STREAM_PROTOCOL,
  TERMINAL_MAX_BUFFER_BYTES,
  isTerminalViewMessage,
  type TerminalControl,
  type AgentTerminalSize,
} from "@overtchat/agent-bridge";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api-url";
import { cn } from "@/lib/utils";

const menuClass =
  "z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none";
const itemClass =
  "flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-xs outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-40 [&_svg]:size-3.5";

export function AgentTerminalPane({
  sessionId,
  active,
  hostLabel,
  workspacePath,
  expanded,
  onToggleExpanded,
  onAddToChat,
  onClose,
}: {
  sessionId: string;
  active: boolean;
  hostLabel: string;
  workspacePath: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onAddToChat?: (selection: string) => void;
  onClose: () => void;
}) {
  const terminalRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuDestinationRef = useRef<"terminal" | "find" | "chat">("terminal");
  const [hasSelection, setHasSelection] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [matches, setMatches] = useState({ resultIndex: -1, resultCount: 0 });
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
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
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: terminalFont(container),
      fontSize: 13,
      lineHeight: 1.3,
      scrollback: 10_000,
      theme: terminalTheme(container),
      allowProposedApi: true,
      linkHandler: { activate: (_event, uri) => openLink(uri) },
    });
    const openLink = (uri: string) => {
      const url = terminalWebUrl(uri);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    };
    terminalRef.current = terminal;
    const search = new SearchAddon({ highlightLimit: 1000 });
    searchRef.current = search;
    terminal.loadAddon(search);
    terminal.loadAddon(new WebLinksAddon((_event, uri) => openLink(uri)));
    const selectionSubscription = terminal.onSelectionChange(() =>
      setHasSelection(terminal.hasSelection()),
    );
    const searchSubscription = search.onDidChangeResults((results) => {
      setMatches(results);
      setHasSelection(terminal.hasSelection());
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
      if (
        socket.bufferedAmount + new TextEncoder().encode(data).byteLength >
        256 * 1024
      ) {
        setError("Terminal input is congested. Reconnect before typing again.");
        ready = false;
        socket.close();
        return;
      }
      socket.send(data);
    };
    sendRef.current = send;
    const fitTerminal = (claim = false) => {
      if (
        !activeRef.current ||
        !container.clientWidth ||
        !container.clientHeight
      )
        return;
      fit.fit();
      const size = {
        cols: Math.min(1000, Math.max(2, terminal.cols)),
        rows: Math.min(1000, Math.max(1, terminal.rows)),
      };
      if (
        claim ||
        size.cols !== sizeRef.current.cols ||
        size.rows !== sizeRef.current.rows
      ) {
        sizeRef.current = size;
        send({ type: "resize", size, claim });
      }
    };
    const write = (data: string) => {
      const bytes = new TextEncoder().encode(data).byteLength;
      if (pendingWrites + bytes > TERMINAL_MAX_BUFFER_BYTES) {
        socket?.close();
        return;
      }
      pendingWrites += bytes;
      terminal.write(data, () => {
        pendingWrites -= bytes;
      });
    };
    const dataSubscription = terminal.onData((data) => {
      if (restoring) return;
      for (let offset = 0; offset < data.length; ) {
        let end = Math.min(
          offset + AGENT_TERMINAL_MAX_INPUT_CHARS,
          data.length,
        );
        if (end < data.length && /[\uD800-\uDBFF]/u.test(data[end - 1]))
          end -= 1;
        send({ type: "input", data: data.slice(offset, end) });
        offset = end;
      }
    });
    const claim = () => fitTerminal(true);
    container.addEventListener("pointerdown", claim);
    container.addEventListener("focusin", claim);
    terminal.attachCustomKeyEventHandler((event) => {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      if (event.type === "keydown" && !event.altKey) {
        if (
          (mac ? event.metaKey : event.ctrlKey && event.shiftKey) &&
          event.code === "KeyF"
        ) {
          event.preventDefault();
          setFindOpen(true);
          return false;
        }
        if (
          (mac ? event.metaKey : event.ctrlKey && event.shiftKey) &&
          event.code === "KeyC" &&
          terminal.hasSelection()
        ) {
          event.preventDefault();
          void writeText(terminal.getSelection()).catch(() =>
            toast.error("Copy failed. Use your system copy shortcut."),
          );
          return false;
        }
      }
      return true;
    });
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(() => fitTerminal());
    });
    resize.observe(container);
    const refreshAppearance = () => {
      if (disposed) return;
      terminal.options.theme = terminalTheme(container);
      terminal.options.fontFamily = terminalFont(container);
      fitTerminal();
    };
    void document.fonts.ready.then(refreshAppearance);
    document.fonts.addEventListener("loadingdone", refreshAppearance);
    const theme = new MutationObserver(refreshAppearance);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const connect = async () => {
      if (disposed) return;
      connecting = true;
      const epoch = ++generation;
      ready = false;
      setStatus(attempt ? "Reconnecting…" : "Connecting…");
      fitTerminal();
      request = new AbortController();
      try {
        const response = await fetch(
          apiUrl(
            `/api/agent-sessions/${encodeURIComponent(sessionId)}/terminal`,
          ),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sizeRef.current),
            signal: request.signal,
          },
        );
        if (!response.ok) {
          const value = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw Object.assign(
            new Error(
              value?.error ?? `Terminal unavailable (${response.status}).`,
            ),
            { retry: response.status >= 500 },
          );
        }
        const grant = (await response.json()) as {
          path: string;
          ticket: string;
        };
        if (disposed || generation !== epoch) return;
        const url = new URL(apiUrl(grant.path), window.location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        const connection = new WebSocket(url, [
          TERMINAL_STREAM_PROTOCOL,
          `ticket.${grant.ticket}`,
        ]);
        socket = connection;
        connection.onmessage = (event) => {
          if (disposed || socket !== connection) return;
          let message: unknown;
          try {
            message = JSON.parse(event.data as string);
          } catch {
            connection.close();
            return;
          }
          if (!isTerminalViewMessage(message)) {
            connection.close();
            return;
          }
          if (message.type === "error") {
            setError(message.message);
            ready = true;
            return;
          }
          if (message.type === "snapshot") {
            const baseline = ++snapshotGeneration;
            ready = false;
            revision = message.snapshot.revision;
            exitLabel = message.snapshot.exited
              ? `Exited (${message.snapshot.exitCode ?? message.snapshot.signal ?? "unknown"})`
              : "";
            setExited(message.snapshot.exited);
            restoring = true;
            restoreBuffer = [];
            restoreBytes = 0;
            const snapshot = message.snapshot;
            terminal.write("", () => {
              if (
                disposed ||
                socket !== connection ||
                baseline !== snapshotGeneration
              )
                return;
              terminal.reset();
              terminal.resize(snapshot.cols, snapshot.rows);
              terminal.write(snapshot.data, () => {
                if (
                  disposed ||
                  socket !== connection ||
                  baseline !== snapshotGeneration
                )
                  return;
                for (const output of restoreBuffer) write(output);
                restoreBuffer = [];
                restoring = false;
                ready = true;
                attempt = 0;
                setStatus(exitLabel || "Connected");
                setError("");
                fitTerminal(true);
                if (
                  activeRef.current &&
                  !searchInputRef.current &&
                  !document.querySelector("[data-terminal-menu]")
                )
                  terminal.focus();
              });
            });
            return;
          }
          if (message.revision !== revision + 1) {
            connection.close();
            return;
          }
          revision = message.revision;
          if (message.type === "exit") {
            setExited(true);
            exitLabel = `Exited (${message.exitCode ?? message.signal ?? "unknown"})`;
            setStatus(exitLabel);
          } else if (restoring) {
            restoreBytes += new TextEncoder().encode(message.data).byteLength;
            if (restoreBytes > TERMINAL_MAX_BUFFER_BYTES) {
              connection.close();
              return;
            }
            restoreBuffer.push(message.data);
          } else write(message.data);
        };
        connection.onclose = (event) => {
          if (disposed || socket !== connection) return;
          ready = false;
          setStatus("Disconnected");
          if (event.code === 1008) {
            setError(
              "Terminal access expired. Reopen the terminal to reconnect.",
            );
            return;
          }
          schedule();
        };
      } catch (cause) {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        if (
          !(cause instanceof Error && "retry" in cause && cause.retry === false)
        )
          schedule();
        else setStatus("Unavailable");
      } finally {
        if (generation === epoch) connecting = false;
      }
    };
    const schedule = () => {
      if (disposed || retry) return;
      setStatus("Reconnecting…");
      retry = setTimeout(
        () => {
          retry = undefined;
          void connect();
        },
        Math.min(250 * 2 ** attempt++, 5000),
      );
    };
    resumeRef.current = () => {
      fitTerminal(true);
      terminal.focus();
      if (
        (!socket || socket.readyState === WebSocket.CLOSED) &&
        !retry &&
        !connecting
      )
        void connect();
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
      selectionSubscription.dispose();
      searchSubscription.dispose();
      document.fonts.removeEventListener("loadingdone", refreshAppearance);
      terminalRef.current = null;
      searchRef.current = null;
      terminal.dispose();
      sendRef.current = () => {};
      resumeRef.current = () => {};
    };
  }, [sessionId]);
  useEffect(() => {
    if (active) resumeRef.current();
  }, [active]);

  useEffect(() => {
    if (!findOpen || !active) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [findOpen, active]);

  useEffect(() => {
    // Invalidate cached matches when the query or case option changes.
    searchRef.current?.clearDecorations();
    if (!findOpen || !query) return;
    searchRef.current?.findNext(query, {
      incremental: true,
      caseSensitive: matchCase,
      decorations: searchDecorations(),
    });
  }, [query, matchCase, findOpen, status]);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  function searchDecorations() {
    const dark = document.documentElement.classList.contains("dark");
    return {
      matchBackground: dark ? "#495b32" : "#dbe6c9",
      matchOverviewRuler: "#829665",
      activeMatchBackground: dark ? "#687f49" : "#bbcf9e",
      activeMatchBorder: "#829665",
      activeMatchColorOverviewRuler: "#829665",
    };
  }
  function find(direction: "next" | "previous") {
    const options = {
      caseSensitive: matchCase,
      decorations: searchDecorations(),
    };
    if (direction === "next") searchRef.current?.findNext(query, options);
    else searchRef.current?.findPrevious(query, options);
  }
  function closeFind() {
    searchRef.current?.clearDecorations();
    setFindOpen(false);
    terminalRef.current?.focus();
  }
  function openFind() {
    menuDestinationRef.current = "find";
    setFindOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }
  async function copy() {
    const selection = terminalRef.current?.getSelection();
    if (!selection) return;
    try {
      await writeText(selection);
      setCopied(true);
    } catch {
      toast.error("Copy failed. Use your system copy shortcut.");
    }
  }
  async function paste() {
    const terminal = terminalRef.current;
    try {
      const text = await readText();
      if (terminal && terminalRef.current === terminal) {
        terminal.paste(text);
        terminal.focus();
      }
    } catch {
      toast.error(
        "Clipboard access is unavailable. Use your system paste shortcut.",
      );
    }
  }
  function addToChat() {
    const selection = terminalRef.current?.getSelection();
    if (!selection || !onAddToChat) return;
    menuDestinationRef.current = "chat";
    onAddToChat(selection);
  }
  function menuOpenChanged(open: boolean) {
    if (!open) return;
    menuDestinationRef.current = "terminal";
    setHasSelection(terminalRef.current?.hasSelection() ?? false);
  }
  const menuFocus = () =>
    menuDestinationRef.current === "chat"
      ? false
      : menuDestinationRef.current === "find"
        ? searchInputRef.current
        : (terminalRef.current?.textarea ?? false);
  const connected = status === "Connected" && !exited;
  const busy = status === "Connecting…" || status === "Reconnecting…";
  const canControl = connected || status.startsWith("Exited");
  const actions = (
    <>
      <Menu.Item
        className={itemClass}
        disabled={!hasSelection}
        onClick={() => void copy()}
      >
        <Copy />
        Copy selection
      </Menu.Item>
      <Menu.Item
        className={itemClass}
        disabled={!connected}
        onClick={() => void paste()}
      >
        Paste
      </Menu.Item>
      <Menu.Item
        className={itemClass}
        onClick={() => terminalRef.current?.selectAll()}
      >
        Select all
      </Menu.Item>
      <Menu.Item
        className={itemClass}
        disabled={!hasSelection || !onAddToChat}
        onClick={addToChat}
      >
        <MessageSquarePlus />
        Add to chat
      </Menu.Item>
      <Menu.Separator className="my-1 h-px bg-border" />
      <Menu.Item className={itemClass} onClick={openFind}>
        <Search />
        Find in terminal
      </Menu.Item>
    </>
  );
  const actionButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
  ) => (
    <UpdateActionTooltip content={label}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        onClick={onClick}
        className="text-muted-foreground"
      >
        {icon}
      </Button>
    </UpdateActionTooltip>
  );

  return (
    <section
      className="relative flex h-full min-h-0 flex-col bg-background"
      aria-label="Workspace terminal"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-muted/25 px-3">
        <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">Terminal</span>
        <span className="text-muted-foreground/50" aria-hidden="true">
          /
        </span>
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={`${hostLabel} · ${workspacePath}`}
        >
          {hostLabel}
        </span>
        <span className="mx-1 h-3 w-px bg-border" aria-hidden="true" />
        {busy ? (
          <Loader2
            className="size-3 animate-spin motion-reduce:animate-none text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              error
                ? "bg-destructive"
                : connected
                  ? "bg-emerald-500"
                  : "bg-muted-foreground/60",
            )}
            aria-hidden="true"
          />
        )}
        <span
          className={cn(
            "truncate text-[11px] text-muted-foreground",
            connected && "sr-only",
          )}
          role="status"
        >
          {status}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {copied && (
            <Check
              className="mr-1 size-3.5 text-emerald-600"
              aria-label="Copied"
            />
          )}
          {exited && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                sendRef.current({ type: "restart", size: sizeRef.current })
              }
            >
              <RotateCcw className="size-3" />
              Restart terminal
            </Button>
          )}
          {actionButton(
            "Find in terminal",
            <Search className="size-3.5" />,
            openFind,
          )}
          {actionButton(
            expanded ? "Restore terminal size" : "Expand terminal",
            expanded ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            ),
            onToggleExpanded,
          )}
          <Menu.Root onOpenChange={menuOpenChanged}>
            <UpdateActionTooltip content="Terminal actions">
              <Menu.Trigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Terminal actions"
                    className="text-muted-foreground"
                  />
                }
              >
                <Ellipsis className="size-3.5" />
              </Menu.Trigger>
            </UpdateActionTooltip>
            <Menu.Portal>
              <Menu.Positioner align="end" sideOffset={6} className="z-50">
                <Menu.Popup
                  data-terminal-menu
                  className={menuClass}
                  finalFocus={menuFocus}
                >
                  {actions}
                  <Menu.Separator className="my-1 h-px bg-border" />
                  <Menu.Item
                    className={itemClass}
                    disabled={!canControl}
                    onClick={() =>
                      sendRef.current({
                        type: "restart",
                        size: sizeRef.current,
                      })
                    }
                  >
                    <RotateCcw />
                    Restart terminal
                  </Menu.Item>
                  <Menu.Item
                    className={cn(itemClass, "text-destructive")}
                    disabled={!connected}
                    onClick={() => sendRef.current({ type: "kill" })}
                  >
                    <Square />
                    Stop terminal
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          {actionButton(
            "Close terminal panel",
            <X className="size-3.5" />,
            onClose,
          )}
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}
      {findOpen && (
        <div
          role="search"
          aria-label="Find terminal output"
          className="absolute top-12 right-3 z-30 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-lg border bg-popover px-2 py-1.5 shadow-lg"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeFind();
            }
            if (
              event.key === "Enter" &&
              event.target === searchInputRef.current
            ) {
              event.preventDefault();
              find(event.shiftKey ? "previous" : "next");
            }
          }}
        >
          <Search className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            aria-label="Find terminal output"
            placeholder="Find in terminal…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-7 min-w-0 max-w-72 text-xs"
          />
          <span
            aria-live="polite"
            className="min-w-16 text-center text-[11px] text-muted-foreground"
          >
            {query
              ? matches.resultCount
                ? `${matches.resultIndex + 1} / ${matches.resultCount}${matches.resultCount >= 1000 ? "+" : ""}`
                : "No matches"
              : ""}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Match case"
            aria-pressed={matchCase}
            onClick={() => setMatchCase(!matchCase)}
            className={cn("text-xs", matchCase && "bg-accent")}
          >
            Aa
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Previous match"
            disabled={!query || !matches.resultCount}
            onClick={() => find("previous")}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Next match"
            disabled={!query || !matches.resultCount}
            onClick={() => find("next")}
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close terminal search"
            onClick={closeFind}
          >
            <X />
          </Button>
        </div>
      )}
      <ContextMenu.Root onOpenChange={menuOpenChanged}>
        <ContextMenu.Trigger
          className="min-h-0 flex-1 overflow-hidden"
          render={<div />}
        >
          <div
            ref={containerRef}
            className="h-full overflow-hidden bg-background px-3 py-2.5"
          />
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="z-50">
            <ContextMenu.Popup
              data-terminal-menu
              className={menuClass}
              finalFocus={menuFocus}
            >
              {actions}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </section>
  );
}
