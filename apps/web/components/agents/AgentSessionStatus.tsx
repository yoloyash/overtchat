"use client";

import { Check, CircleAlert, CircleDot, CircleX } from "lucide-react";
import type {
  AgentProviderId,
  AgentSessionListItem,
} from "@overtchat/agent-bridge";
import {
  agentSessionHasUnseenTurn,
  type AgentSessionState,
} from "@/lib/agents/attention";
import { AGENT_PROVIDER_VISUALS } from "@/lib/agents/providerVisuals";
import { useSetAgentSessionRead } from "@/lib/queries/agentSessionRead";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

const STATE_LABELS: Record<AgentSessionState, string> = {
  approval: "Needs approval",
  question: "Has a question",
  failed: "Failed",
  working: "Working",
  unread: "Finished",
  idle: "",
};

export function agentSessionStateLabel(state: AgentSessionState): string {
  return STATE_LABELS[state];
}

/**
 * A session's state in the slot before its title. Every state fills the slot,
 * idle with a faint dot, so titles line up whatever their sessions are doing.
 */
export function AgentSessionStatusIcon({
  state,
  className,
}: {
  state: AgentSessionState;
  className?: string;
}) {
  const box = cn("flex size-3 shrink-0 items-center justify-center", className);
  switch (state) {
    case "approval":
    case "question":
      return <CircleAlert aria-hidden="true" className={cn(box, "text-amber-500")} />;
    case "failed":
      return <CircleX aria-hidden="true" className={cn(box, "text-red-500 dark:text-red-400")} />;
    case "working":
      return <AgentWorkingRing className={box} />;
    case "unread":
      return (
        <span aria-hidden="true" className={box}>
          <span className="size-1.5 rounded-full bg-green-600 dark:bg-green-500" />
        </span>
      );
    case "idle":
      return (
        <span aria-hidden="true" className={box}>
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
        </span>
      );
  }
}

/** A dot with a quarter arc turning around it: the one state that moves. */
function AgentWorkingRing({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative", className)}>
      <span className="absolute inset-0 rounded-full border-[1.5px] border-blue-500/30 dark:border-blue-400/30" />
      <span
        className={cn(
          "absolute inset-0 rounded-full border-[1.5px] border-transparent border-t-blue-500/90 [animation-duration:900ms] dark:border-t-blue-400/90",
          motionClasses.spinner,
        )}
      />
      <span className="size-1.5 rounded-full bg-blue-500 dark:bg-blue-400" />
    </span>
  );
}

/** Whether a session has a finished turn its owner can mark read or unread. */
export function agentSessionCanToggleRead(
  session: AgentSessionListItem,
  state: AgentSessionState,
): boolean {
  return (
    session.lastTurn != null &&
    state !== "working" &&
    state !== "approval" &&
    state !== "question"
  );
}

/** Marks a row's finished turn read or unread; shown when the row is hovered. */
export function AgentSessionReadToggle({
  session,
  state,
  title,
}: {
  session: AgentSessionListItem;
  state: AgentSessionState;
  title: string;
}) {
  const setRead = useSetAgentSessionRead();
  if (!agentSessionCanToggleRead(session, state)) return null;
  const unseen = agentSessionHasUnseenTurn(session);
  return (
    <button
      type="button"
      onClick={() => setRead.mutate({ sessionId: session.id, read: unseen })}
      aria-label={unseen ? `Mark ${title} as read` : `Mark ${title} as unread`}
      title={unseen ? "Mark as read" : "Mark as unread"}
      className="absolute inset-0 flex items-center justify-center rounded text-muted-foreground opacity-0 motion-opacity hover:bg-sidebar-border/60 hover:text-foreground focus-visible:opacity-100 group-has-[:focus-visible]:opacity-100 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:none)]:hidden"
    >
      {unseen ? (
        <Check aria-hidden="true" className="size-3.5" />
      ) : (
        <CircleDot aria-hidden="true" className="size-3" />
      )}
    </button>
  );
}

export function AgentProviderLogo({
  provider,
  className,
}: {
  provider: AgentProviderId;
  className?: string;
}) {
  const icon = AGENT_PROVIDER_VISUALS[provider];
  return (
    <span
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-sm opacity-80",
        icon.darkSurface && "bg-zinc-950/90",
        className,
      )}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon.icon} alt="" className="size-2.5 object-contain" />
    </span>
  );
}
