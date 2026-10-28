"use client";

import {
  Check,
  CircleAlert,
  CircleDot,
  Loader2,
  MessageCircleQuestion,
  ShieldQuestion,
} from "lucide-react";
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

/** A session's state as a small icon; idle sessions show nothing. */
export function AgentSessionStatusIcon({
  state,
  className,
}: {
  state: AgentSessionState;
  className?: string;
}) {
  const iconClass = cn("size-3.5 shrink-0", className);
  switch (state) {
    case "approval":
      return <ShieldQuestion aria-hidden="true" className={cn(iconClass, "text-amber-500")} />;
    case "question":
      return <MessageCircleQuestion aria-hidden="true" className={cn(iconClass, "text-amber-500")} />;
    case "failed":
      return <CircleAlert aria-hidden="true" className={cn(iconClass, "text-destructive")} />;
    case "working":
      return (
        <Loader2
          aria-hidden="true"
          className={cn(iconClass, "text-muted-foreground", motionClasses.spinner)}
        />
      );
    case "unread":
      return (
        <span aria-hidden="true" className={cn("flex items-center justify-center", iconClass)}>
          <span className="size-2 rounded-full bg-emerald-500" />
        </span>
      );
    case "idle":
      return null;
  }
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
