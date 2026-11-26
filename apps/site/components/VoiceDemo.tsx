"use client";

import {
  ArrowRight,
  AudioLines,
  Braces,
  Hand,
  Mic2,
  Sparkles,
  Volume2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useInView, usePrefersReducedMotion } from "@/lib/use-motion";

type Phase = "listening" | "thinking" | "speaking";

// The first reply is cut off partway, the way a real conversation gets steered.
const TURNS = [
  {
    you: "Let’s talk through my weekend project. I want a small reading nook by the window.",
    reply:
      "Start with the chair and the light. A comfortable seat angled toward the window gives you daylight without glare. Add a small side table for your book and a warm lamp",
    interrupted: true,
  },
  {
    you: "Keep it simple, and leave room for a plant.",
    reply:
      "Then one compact armchair, a narrow side table, and a floor lamp behind the chair. Put the plant closest to the window.",
    interrupted: false,
  },
].map((turn) => ({
  ...turn,
  youWords: turn.you.split(" "),
  replyWords: turn.reply.split(" "),
}));

const PHASE_LABEL: Record<Phase, string> = {
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

const STAGES: Array<{ phase: Phase; icon: typeof Mic2; name: string; detail: string }> = [
  { phase: "listening", icon: AudioLines, name: "Parakeet", detail: "Speech to text" },
  { phase: "thinking", icon: Braces, name: "Your model", detail: "Local or hosted" },
  { phase: "speaking", icon: Volume2, name: "Kokoro", detail: "Text to speech" },
];

const BARS = Array.from({ length: 27 }, (_, index) => index);

export function VoiceDemo() {
  const reducedMotion = usePrefersReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>(0.4);
  const [turn, setTurn] = useState(0);
  const [phase, setPhase] = useState<Phase>("listening");
  const [words, setWords] = useState(TURNS[0].youWords.length);
  /** What the model had said when it was cut off, shown until it answers again. */
  const [cutOff, setCutOff] = useState<string | null>(null);

  const current = TURNS[turn];
  const active = inView && !reducedMotion;
  const limit =
    phase === "listening" ? current.youWords.length : current.replyWords.length;

  function cutIn() {
    if (phase !== "speaking") return;
    setCutOff(current.replyWords.slice(0, Math.max(words, 1)).join(" "));
    setTurn((turn + 1) % TURNS.length);
    setPhase("listening");
    setWords(0);
  }

  useEffect(() => {
    if (!active) return;
    let delay: number;
    let advance: () => void;

    if (phase === "thinking") {
      delay = 950;
      advance = () => {
        setCutOff(null);
        setPhase("speaking");
        setWords(0);
      };
    } else if (words < limit) {
      delay = phase === "listening" ? 170 : 130;
      advance = () => setWords(words + 1);
    } else if (phase === "listening") {
      delay = 500;
      advance = () => setPhase("thinking");
    } else {
      delay = current.interrupted ? 120 : 2200;
      advance = () => {
        setCutOff(current.interrupted ? current.reply : null);
        setTurn((turn + 1) % TURNS.length);
        setPhase("listening");
        setWords(0);
      };
    }

    const timer = window.setTimeout(advance, delay);
    return () => window.clearTimeout(timer);
  }, [active, current, limit, phase, turn, words]);

  const youText = current.youWords
    .slice(0, phase === "listening" ? words : current.youWords.length)
    .join(" ");
  const replyText =
    phase === "speaking" ? current.replyWords.slice(0, words).join(" ") : "";
  const OrbIcon = phase === "listening" ? Mic2 : phase === "thinking" ? Sparkles : Volume2;

  return (
    <div
      className="voice-console"
      ref={ref}
      role="group"
      aria-label="Realtime voice moving from Parakeet speech recognition through the selected language model to Kokoro speech synthesis"
      data-phase={phase}
      data-active={active ? "" : undefined}
    >
      <div className="voice-console-header">
        <span>
          <span className="voice-live-dot" /> {PHASE_LABEL[phase]}
        </span>
        <small>Realtime voice</small>
      </div>
      <div className="voice-stage">
        <div className="voice-orb">
          <span className="voice-orb-icon" key={phase}>
            <OrbIcon aria-hidden="true" />
          </span>
          <div className="voice-wave" aria-hidden="true">
            {BARS.map((bar) => (
              <span key={bar} />
            ))}
          </div>
        </div>
        <div className="voice-transcript" aria-hidden="true">
          <p className="voice-line">
            <small>You</small>
            <span>{youText}</span>
          </p>
          <p className="voice-line" data-cut={cutOff !== null && phase !== "speaking" ? "" : undefined}>
            <small>Reply</small>
            <span>
              {phase === "speaking"
                ? replyText
                : cutOff !== null
                  ? `${cutOff}…`
                  : ""}
            </span>
          </p>
        </div>
        <button
          type="button"
          className="voice-cut"
          disabled={phase !== "speaking" || !active}
          onClick={cutIn}
        >
          <Hand aria-hidden="true" />
          Cut in
        </button>
      </div>
      <div className="voice-pipeline">
        {STAGES.map((stage, index) => (
          <FragmentWithArrow key={stage.name} first={index === 0}>
            <div data-current={stage.phase === phase ? "" : undefined}>
              <stage.icon aria-hidden="true" />
              <strong>{stage.name}</strong>
              <small>{stage.detail}</small>
            </div>
          </FragmentWithArrow>
        ))}
      </div>
      <div className="voice-console-footer">
        <span>Interruptible</span>
        <span>Search-aware</span>
        <span>Transcript saved</span>
      </div>
    </div>
  );
}

function FragmentWithArrow({
  first,
  children,
}: {
  first: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {!first && <ArrowRight aria-hidden="true" />}
      {children}
    </>
  );
}
