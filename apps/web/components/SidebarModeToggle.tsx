"use client";

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessagesSquare, SquareTerminal } from "lucide-react";
import { useSidebar } from "@/components/sidebar-context";
import type { AgentAttentionCounts } from "@/lib/agents/attention";
import {
  isNeutralSidebarPath,
  SIDEBAR_MODE_HOME,
  sidebarModeForPath,
  type SidebarMode,
} from "@/lib/agents/sidebarMode";
import { cn } from "@/lib/utils";

type SidebarModeMemory = {
  mode: SidebarMode;
  href: Partial<Record<SidebarMode, string>>;
};

// Per tab, so a reload keeps the mode and where each mode was left.
const MEMORY_KEY = "overtchat:sidebar-mode";

function readMemory(): SidebarModeMemory {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(MEMORY_KEY) ?? "null");
    if (value?.mode === "chat" || value?.mode === "agents") {
      const href = typeof value.href === "object" && value.href ? value.href : {};
      return {
        mode: value.mode,
        href: {
          ...(typeof href.chat === "string" ? { chat: href.chat } : {}),
          ...(typeof href.agents === "string" ? { agents: href.agents } : {}),
        },
      };
    }
  } catch {
    // Storage can be unavailable or hold an unrelated value.
  }
  return { mode: "chat", href: {} };
}

// Shared by the desktop sidebar and the mobile drawer.
let memory: SidebarModeMemory | null = null;

function sidebarModeMemory(): SidebarModeMemory {
  memory ??= readMemory();
  return memory;
}

function rememberSidebarMode(mode: SidebarMode, href: string | null) {
  const current = sidebarModeMemory();
  memory = {
    mode,
    href: href === null ? current.href : { ...current.href, [mode]: href },
  };
  try {
    window.sessionStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // The mode still holds for this page load.
  }
}

/** The mode the current page belongs to; settings keep the previous one. */
export function useSidebarMode(): SidebarMode {
  const pathname = useLocation({ select: (location) => location.pathname });
  const href = useLocation({ select: (location) => location.href });
  const [mode, setMode] = useState(() => sidebarModeMemory().mode);
  const derived = sidebarModeForPath(pathname, mode);
  if (derived !== mode) setMode(derived);
  useEffect(() => {
    rememberSidebarMode(derived, isNeutralSidebarPath(pathname) ? null : href);
  }, [derived, href, pathname]);
  return derived;
}

const MODES: {
  mode: SidebarMode;
  labelKey: "sidebar.mode.chat" | "sidebar.mode.agents";
  icon: typeof MessagesSquare;
}[] = [
  { mode: "chat", labelKey: "sidebar.mode.chat", icon: MessagesSquare },
  { mode: "agents", labelKey: "sidebar.mode.agents", icon: SquareTerminal },
];

/** Switches between chats and agents, returning to where each was left. */
export function SidebarModeToggle({
  mode,
  agentCounts,
}: {
  mode: SidebarMode;
  agentCounts: AgentAttentionCounts;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { closeMobile } = useSidebar();
  return (
    <div
      role="group"
      aria-label={t("sidebar.mode.groupLabel")}
      className="mx-2 mb-1 grid shrink-0 grid-cols-2 gap-0.5 rounded-lg bg-sidebar-accent/70 p-0.5"
    >
      {MODES.map(({ mode: option, labelKey, icon: Icon }) => {
        const label = t(labelKey);
        const selected = mode === option;
        const badge =
          option === "agents" && !selected ? agentCounts : null;
        const ariaLabel = badge?.needsYou
          ? t("sidebar.mode.needsYou", { label, count: badge.needsYou })
          : badge?.unread
            ? t("sidebar.mode.unreadToReview", { label, count: badge.unread })
            : label;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            aria-label={ariaLabel}
            onClick={() => {
              if (selected) return;
              closeMobile();
              void navigate({
                href:
                  sidebarModeMemory().href[option] ?? SIDEBAR_MODE_HOME[option],
              });
            }}
            className={cn(
              "relative flex h-7 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground outline-none motion-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:h-9",
              selected && "bg-background text-foreground shadow-sm",
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            <span>{label}</span>
            {badge && badge.needsYou > 0 ? (
              <span
                aria-hidden="true"
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold tabular-nums text-white"
              >
                {badge.needsYou > 9 ? "9+" : badge.needsYou}
              </span>
            ) : badge && badge.unread > 0 ? (
              <span aria-hidden="true" className="size-1.5 rounded-full bg-green-600 dark:bg-green-500" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
