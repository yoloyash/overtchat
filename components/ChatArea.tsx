"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { cjk } from "@streamdown/cjk";
import { ArrowUp, Globe, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type ApiConfig } from "@/lib/config";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { ModelPicker } from "@/components/ModelPicker";
import {
  ToolCall,
  type FetchUrlPart,
  type WebSearchPart,
} from "@/components/ToolCall";

const SEARCH_STORAGE_KEY = "overtchat_search_enabled";

interface Props {
  config: ApiConfig;
  onConfigChange: (config: ApiConfig) => void;
  chatId?: string;
  initialMessages?: UIMessage[];
}

const PLUGINS = { code, math, cjk };

export function ChatArea({
  config,
  onConfigChange,
  chatId,
  initialMessages,
}: Props) {
  const router = useRouter();
  const configured = Boolean(config.baseUrl && config.model);

  const [searchEnabled, setSearchEnabled] = useLocalStorage<boolean>(
    SEARCH_STORAGE_KEY,
    false,
  );

  const chatIdRef = useRef<string | undefined>(chatId);

  const [transport] = useState(
    // chatIdRef is only read inside the fetch closure at network-call time,
    // never during render. The lazy initializer runs once at mount.
    // eslint-disable-next-line react-hooks/refs
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        fetch: async (input, init) => {
          const res = await fetch(input, init);
          const id = res.headers.get("X-Chat-Id");
          if (id && !chatIdRef.current) {
            chatIdRef.current = id;
            window.history.replaceState(null, "", `/chat/${id}`);
          }
          return res;
        },
      }),
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
    messages: initialMessages,
    onFinish: () => router.refresh(),
  });

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);

  const streaming = status === "streaming" || status === "submitted";

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  function submit() {
    const text = input.trim();
    if (!text || streaming) return;
    if (!configured) {
      router.push("/settings");
      return;
    }
    sendMessage(
      { text },
      {
        body: {
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          searchEnabled,
          chatId: chatIdRef.current,
        },
      },
    );
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center border-b px-3">
        <ModelPicker
          config={config}
          onChange={onConfigChange}
        />
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain"
      >
        {messages.length === 0 ? (
          <EmptyState configured={configured} />
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pt-10 pb-8">
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                streaming={streaming && i === messages.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pb-6">
        <div className="mx-auto max-w-3xl">
          {error && (
            <p className="mb-2 text-sm text-destructive">{error.message}</p>
          )}
          <div className="flex flex-col gap-2 rounded-3xl border bg-background px-3 py-2.5 shadow-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
            <Textarea
              ref={textareaRef}
              rows={1}
              placeholder={configured ? "Message…" : "Configure an API endpoint to start chatting"}
              className="max-h-48 min-h-6 resize-none border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0 md:text-sm"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 rounded-full px-3",
                  searchEnabled &&
                    "bg-accent text-foreground hover:bg-accent",
                )}
                onClick={() => setSearchEnabled(!searchEnabled)}
                aria-label={searchEnabled ? "Disable web search" : "Enable web search"}
                aria-pressed={searchEnabled}
              >
                <Globe />
                <span className="text-xs">Search</span>
              </Button>
              {streaming ? (
                <Button
                  size="icon-sm"
                  variant="secondary"
                  className="shrink-0 rounded-full"
                  onClick={() => stop()}
                  aria-label="Stop generating"
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button
                  size="icon-sm"
                  className="shrink-0 rounded-full"
                  disabled={!input.trim()}
                  onClick={submit}
                  aria-label="Send message"
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ configured }: { configured: boolean }) {
  return (
    <div className="flex h-full min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Sparkles className="size-5" />
      </div>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        What can I help with?
      </h1>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        {configured
          ? "Ask a question or start a conversation."
          : "Point overtchat at any OpenAI-compatible endpoint to begin."}
      </p>
      {!configured && (
        <Button render={<Link href="/settings" />} variant="outline" className="mt-5">
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
  message: UIMessage;
  streaming: boolean;
}) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap text-secondary-foreground">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-full space-y-3 text-sm leading-relaxed">
        {message.parts.map((part, i) => {
          if (part.type === "reasoning") {
            return (
              <ThinkingBlock
                key={i}
                content={part.text}
                open={streaming && part.state !== "done"}
              />
            );
          }
          if (part.type === "text") {
            return (
              <Streamdown
                key={i}
                className="font-serif space-y-3 text-[15px] leading-relaxed"
                plugins={PLUGINS}
                isAnimating={streaming}
              >
                {part.text}
              </Streamdown>
            );
          }
          if (part.type === "tool-web_search") {
            return <ToolCall key={i} part={part as unknown as WebSearchPart} />;
          }
          if (part.type === "tool-fetch_url") {
            return <ToolCall key={i} part={part as unknown as FetchUrlPart} />;
          }
          return null;
        })}
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
