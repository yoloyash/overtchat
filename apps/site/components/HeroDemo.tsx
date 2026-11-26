"use client";

import {
  Activity,
  ArrowUp,
  AudioLines,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Globe,
  LibraryBig,
  MessagesSquare,
  Mic,
  PanelLeft,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Share2,
  SquareTerminal,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { HeroDemoCard } from "@/components/HeroDemoCard";
import {
  HERO_CHAT_START,
  HERO_CHATS,
  HERO_SCENARIOS,
  type HeroChatId,
} from "@/lib/hero-scenarios";
import { useInView, usePrefersReducedMotion } from "@/lib/use-motion";

/** How long a finished answer stays up before the next example plays. */
const DWELL_MS = 7000;

type Phase = "typing" | "thinking" | "tool" | "streaming" | "done";

/**
 * `instant` shows a finished answer, `send` starts from a sent message, and
 * `full` also types the prompt into the composer first.
 */
type Mode = "instant" | "send" | "full";

interface Run {
  id: string;
  mode: Mode;
  key: number;
}

/** `modelIcon` is rendered by the page so the icon set stays out of this bundle. */
export function HeroDemo({ modelIcon }: { modelIcon: ReactNode }) {
  const reducedMotion = usePrefersReducedMotion();
  const [run, setRun] = useState<Run>({
    id: HERO_CHAT_START.savings,
    mode: "instant",
    key: 0,
  });
  const [phase, setPhase] = useState<Phase>("done");
  const [typed, setTyped] = useState(0);
  const [shown, setShown] = useState(
    HERO_SCENARIOS[HERO_CHAT_START.savings].blocks.length,
  );
  const [autoplay, setAutoplay] = useState(true);
  const [engaged, setEngaged] = useState(false);
  const [windowRef, inView] = useInView<HTMLDivElement>();

  const scenario = HERO_SCENARIOS[run.id];
  const chat = HERO_CHATS.find((entry) => entry.id === scenario.chatId)!;

  const start = useCallback(
    (id: string, requested: Mode) => {
      const next = HERO_SCENARIOS[id];
      if (!next) return;
      const mode = reducedMotion ? "instant" : requested;
      setRun((current) => ({ id, mode, key: current.key + 1 }));
      setTyped(0);
      setShown(mode === "instant" ? next.blocks.length : 0);
      setPhase(
        mode === "instant" ? "done" : mode === "full" ? "typing" : "thinking",
      );
    },
    [reducedMotion],
  );

  // Play the current run: type, send, think, then stream the card block by block.
  useEffect(() => {
    if (run.mode === "instant") return;
    const current = HERO_SCENARIOS[run.id];
    const timers: number[] = [];
    let cancelled = false;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });

    void (async () => {
      if (run.mode === "full") {
        await wait(450);
        for (let length = 1; length <= current.prompt.length; length += 1) {
          if (cancelled) return;
          setTyped(length);
          await wait(length % 7 === 0 ? 46 : 20);
        }
        await wait(420);
        if (cancelled) return;
        setPhase("thinking");
      }
      await wait(950);
      if (cancelled) return;
      if (current.tool) {
        setPhase("tool");
        await wait(1300);
        if (cancelled) return;
      }
      setPhase("streaming");
      for (let count = 1; count <= current.blocks.length; count += 1) {
        if (cancelled) return;
        setShown(count);
        await wait(count === 1 ? 380 : 520);
      }
      if (!cancelled) setPhase("done");
    })();

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [run]);

  const counting =
    autoplay && !reducedMotion && inView && !engaged && phase === "done";

  useEffect(() => {
    if (!counting) return;
    const timer = window.setTimeout(() => {
      const index = HERO_CHATS.findIndex((entry) => entry.id === scenario.chatId);
      const next = HERO_CHATS[(index + 1) % HERO_CHATS.length];
      start(HERO_CHAT_START[next.id], "full");
    }, DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [counting, scenario.chatId, start]);

  function openChat(id: HeroChatId) {
    setAutoplay(false);
    start(HERO_CHAT_START[id], "send");
  }

  function leaveFocus(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setEngaged(false);
  }

  const typing = phase === "typing";
  const composerText = typing ? scenario.prompt.slice(0, typed) : "";

  return (
    <div className="demo" role="group" aria-label="Interactive OvertChat demo">
      <div className="demo-glow" aria-hidden="true" />
      <div
        className="demo-window"
        ref={windowRef}
        onPointerEnter={() => setEngaged(true)}
        onPointerLeave={() => setEngaged(false)}
        onFocus={() => setEngaged(true)}
        onBlur={leaveFocus}
      >
        <aside className="demo-sidebar">
          <div aria-hidden="true">
            <div className="demo-sidebar-header">
              <span className="demo-brand">overtchat</span>
              <PanelLeft />
            </div>
            <div className="demo-mode">
              <span data-active="">
                <MessagesSquare /> Chat
              </span>
              <span>
                <SquareTerminal /> Agents
              </span>
            </div>
            <div className="demo-nav">
              <span><Pencil /> New chat</span>
              <span><Search /> Search chats</span>
              <span><LibraryBig /> Library</span>
              <span><Activity /> Activity</span>
            </div>
            <p className="demo-sidebar-label">Projects</p>
            <div className="demo-nav">
              <span><ChevronRight /> Workbench</span>
              <span><ChevronRight /> Home lab</span>
            </div>
            <p className="demo-sidebar-label">Today</p>
          </div>
          <div className="demo-chats">
            {HERO_CHATS.map((entry) => (
              <button
                type="button"
                key={entry.id}
                aria-pressed={entry.id === chat.id}
                onClick={() => openChat(entry.id)}
              >
                {entry.title}
              </button>
            ))}
          </div>
          <div className="demo-profile" aria-hidden="true">
            <span>M</span>
            <strong>Maya</strong>
            <ChevronUp />
          </div>
        </aside>

        <section className="demo-chat">
          <header className="demo-chat-header">
            <strong key={chat.id}>{chat.title}</strong>
            <Share2 aria-hidden="true" />
          </header>

          <div
            className="demo-messages"
            key={run.key}
            data-animate={run.mode === "instant" ? undefined : ""}
            aria-live="off"
          >
            {!typing && <p className="demo-user">{scenario.prompt}</p>}
            {phase === "thinking" && (
              <p className="demo-thinking">
                <span aria-hidden="true"><i /><i /><i /></span>
                Thinking
              </p>
            )}
            {scenario.tool && !typing && phase !== "thinking" && (
              <p
                className="demo-tool"
                data-running={phase === "tool" ? "" : undefined}
              >
                <Globe aria-hidden="true" />
                {phase === "tool" ? scenario.tool.running : scenario.tool.done}
              </p>
            )}
            <HeroDemoCard
              blocks={scenario.blocks}
              shown={shown}
              animate={run.mode !== "instant"}
              onFollowUp={(followUp) => {
                setAutoplay(false);
                start(followUp.next, "send");
              }}
              onInteract={() => setAutoplay(false)}
            />
          </div>

          <div className="demo-composer" aria-hidden="true">
            <p data-empty={composerText ? undefined : ""}>
              {composerText || "Message… or / for commands"}
              {typing && <span className="demo-caret" />}
            </p>
            <div className="demo-composer-row">
              <span className="demo-composer-icon"><Plus /></span>
              <span className="demo-model">
                {modelIcon}
                Qwen3.8 Flash · SGLang
                <ChevronDown />
              </span>
              <span className="demo-composer-icon demo-composer-mic"><Mic /></span>
              <span className="demo-send" data-ready={composerText ? "" : undefined}>
                {composerText ? <ArrowUp /> : <AudioLines />}
              </span>
            </div>
          </div>
        </section>
      </div>

      <div className="demo-controls">
        {!reducedMotion && (
          <button
            type="button"
            className="demo-playback"
            aria-label={autoplay ? "Pause the demo" : "Play the demo"}
            title={autoplay ? "Pause the demo" : "Play the demo"}
            onClick={() => setAutoplay((current) => !current)}
          >
            {autoplay ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </button>
        )}
        {HERO_CHATS.map((entry) => (
          <button
            type="button"
            className="demo-tab"
            key={entry.id}
            aria-pressed={entry.id === chat.id}
            onClick={() => openChat(entry.id)}
          >
            {entry.tab}
            {entry.id === chat.id && counting && (
              <span
                className="demo-tab-progress"
                style={{ animationDuration: `${DWELL_MS}ms` }}
                aria-hidden="true"
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
