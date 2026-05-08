"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { type ApiConfig } from "@/lib/config";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  config: ApiConfig;
  onOpenConfig: () => void;
}

export function ChatArea({ config, onOpenConfig }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const configured = Boolean(config.baseUrl && config.model);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    if (!configured) {
      onOpenConfig();
      return;
    }

    setError("");
    const history: Message[] = [...messages, { role: "user", content: text }];
    setMessages(history);
    setInput("");
    setStreaming(true);

    const assistantIdx = history.length;
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(config.baseUrl.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          stream: true,
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
            if (delta) {
              setMessages((prev) => {
                const next = [...prev];
                next[assistantIdx] = {
                  role: "assistant",
                  content: next[assistantIdx].content + delta,
                };
                return next;
              });
            }
          } catch {
            // malformed chunk — skip
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
      setMessages((prev) => prev.slice(0, assistantIdx));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          {config.model ? (
            <>
              <span className="size-1.5 rounded-full bg-green-500" />
              <span className="truncate font-medium">{config.model}</span>
            </>
          ) : (
            <button
              onClick={onOpenConfig}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              No model configured
            </button>
          )}
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4">
          {messages.length === 0 ? (
            <EmptyState configured={configured} onOpenConfig={onOpenConfig} />
          ) : (
            <div className="space-y-6 py-8">
              {messages.map((m, i) => (
                <MessageBubble
                  key={i}
                  message={m}
                  streaming={streaming && i === messages.length - 1}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="px-4 pb-4">
        <div className="mx-auto max-w-3xl">
          {error && (
            <p className="mb-2 text-sm text-destructive">{error}</p>
          )}
          <div className="flex items-end gap-2 rounded-2xl border bg-background px-3 py-2 shadow-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
            <Textarea
              ref={textareaRef}
              rows={1}
              placeholder={configured ? "Message…" : "Configure an API endpoint to start chatting"}
              className="max-h-48 min-h-8 flex-1 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 md:text-sm"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {streaming ? (
              <Button
                size="icon-sm"
                variant="secondary"
                className="shrink-0 rounded-full"
                onClick={stop}
                aria-label="Stop generating"
              >
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                className="shrink-0 rounded-full"
                disabled={!input.trim()}
                onClick={send}
                aria-label="Send message"
              >
                <ArrowUp />
              </Button>
            )}
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Enter to send, Shift+Enter for newline
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  configured,
  onOpenConfig,
}: {
  configured: boolean;
  onOpenConfig: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Sparkles className="size-5" />
      </div>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        What can I help with?
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {configured
          ? "Ask a question or start a conversation."
          : "Point overtchat at any OpenAI-compatible endpoint to begin."}
      </p>
      {!configured && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onOpenConfig}>
          Configure endpoint
        </Button>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  streaming,
}: {
  message: Message;
  streaming: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  const parts = splitThinking(message.content);

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-full space-y-3 text-sm leading-relaxed">
        {parts.map((part, i) =>
          part.kind === "think" ? (
            <ThinkingBlock key={i} content={part.text} open={streaming && i === parts.length - 1} />
          ) : (
            <div key={i} className="whitespace-pre-wrap">
              {part.text}
            </div>
          ),
        )}
        {streaming && (
          <span className="ml-0.5 inline-block h-[0.9em] w-[2px] animate-pulse bg-foreground align-middle" />
        )}
      </div>
    </div>
  );
}

function ThinkingBlock({ content, open }: { content: string; open: boolean }) {
  const trimmed = content.trim();
  if (!trimmed) return null;
  return (
    <details
      open={open}
      className={cn(
        "group/think rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2",
      )}
    >
      <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground select-none group-open/think:mb-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1 rounded-full bg-muted-foreground/70" />
          Thinking
          <span className="text-muted-foreground/70 group-open/think:hidden">— click to expand</span>
        </span>
      </summary>
      <div className="whitespace-pre-wrap text-xs text-muted-foreground">{trimmed}</div>
    </details>
  );
}

type Part = { kind: "text" | "think"; text: string };

function splitThinking(content: string): Part[] {
  const parts: Part[] = [];
  const regex = /<think>([\s\S]*?)(?:<\/think>|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    if (m.index > last) {
      parts.push({ kind: "text", text: content.slice(last, m.index) });
    }
    parts.push({ kind: "think", text: m[1] });
    last = regex.lastIndex;
  }
  if (last < content.length) {
    parts.push({ kind: "text", text: content.slice(last) });
  }
  return parts.length ? parts : [{ kind: "text", text: content }];
}
