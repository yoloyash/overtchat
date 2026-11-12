"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { writeText as clipboardWriteText } from "clipboard-polyfill";
import { ContextMenu } from "@base-ui/react/context-menu";
import { useRouter } from "@tanstack/react-router";
import {
  Check,
  CircleDot,
  Copy,
  ExternalLink,
  Hash,
  Pencil,
  SquarePen,
} from "lucide-react";
import {
  agentProviderMetadata,
  type AgentProviderId,
} from "@overtchat/agent-bridge";
import { RenameAgentSessionDialog } from "@/components/agents/AgentSessionDialogs";
import { useSidebar } from "@/components/sidebar-context";
import { toast } from "@/components/ui/toast";
import {
  agentSessionCanToggleRead,
  agentSessionHasUnseenTurn,
  type AgentAttentionItem,
} from "@/lib/agents/attention";
import { agentSessionDisplayTitle } from "@/lib/agents/sidebar";
import { desktopBridge } from "@/lib/desktop";
import { motionClasses } from "@/lib/motion";
import { useSetAgentSessionRead } from "@/lib/queries/agentSessionRead";
import { useAgentSessionCommand } from "@/lib/queries/agentSessions";
import { cn } from "@/lib/utils";

const itemClass =
  "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 outline-none motion-colors data-[highlighted]:bg-accent";
const iconClass = "size-3.5 shrink-0 text-muted-foreground";

/**
 * A session's row, as the `<li>` it is, with the session's actions on a right
 * click, a long press or the keyboard's menu key.
 */
export function AgentSessionRowMenu({
  entry,
  className,
  children,
}: {
  entry: AgentAttentionItem;
  className?: string;
  children: ReactNode;
}) {
  // Inside the phone drawer the menu has to portal into it; see AccountMenu.
  const { drawerRef } = useSidebar();
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={<li className={className} />}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal container={drawerRef}>
        <ContextMenu.Positioner
          className="z-50 outline-none"
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}
        >
          <ContextMenu.Popup
            aria-label="Session actions"
            className={cn(
              "w-56 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            {/* Mounted only while the menu is open, so rows stay cheap. */}
            <MenuItems entry={entry} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function MenuItems({ entry }: { entry: AgentAttentionItem }) {
  const router = useRouter();
  const { closeMobile } = useSidebar();
  const setRead = useSetAgentSessionRead();
  const { item, group, state } = entry;
  const { session, provider } = item;
  const unseen = agentSessionHasUnseenTurn(session);

  async function copy(value: string, label: string) {
    try {
      await clipboardWriteText(value);
      toast.success({ title: `${label} copied` });
    } catch {
      toast.error({
        title: `Could not copy ${label[0].toLowerCase()}${label.slice(1)}`,
      });
    }
  }

  return (
    <>
      {agentSessionCanToggleRead(session, state) && (
        <ContextMenu.Item
          onClick={() => setRead.mutate({ sessionId: session.id, read: unseen })}
          className={itemClass}
        >
          {unseen ? (
            <Check aria-hidden="true" className={iconClass} />
          ) : (
            <CircleDot aria-hidden="true" className={iconClass} />
          )}
          {unseen ? "Mark as read" : "Mark as unread"}
        </ContextMenu.Item>
      )}
      {agentProviderMetadata(provider).capabilities.renameSession !== false && (
        <ContextMenu.Item
          onClick={() => {
            closeMobile();
            setRenameTarget({
              sessionId: session.id,
              provider,
              name: agentSessionDisplayTitle(session) ?? "",
            });
          }}
          className={itemClass}
        >
          <Pencil aria-hidden="true" className={iconClass} />
          Rename session
        </ContextMenu.Item>
      )}
      <ContextMenu.Item
        onClick={() => {
          closeMobile();
          void router.navigate({
            to: "/agents/new",
            search: { workspaceId: item.workspaceId, provider },
          });
        }}
        className={itemClass}
      >
        <SquarePen aria-hidden="true" className={iconClass} />
        <span className="truncate">New session in {group.name}</span>
      </ContextMenu.Item>
      <ContextMenu.Separator className="my-1 h-px bg-border" />
      <ContextMenu.Item
        onClick={() => void copy(group.path, "Workspace path")}
        className={itemClass}
      >
        <Copy aria-hidden="true" className={iconClass} />
        Copy workspace path
      </ContextMenu.Item>
      {session.providerSessionId && (
        <ContextMenu.Item
          onClick={() => void copy(session.providerSessionId, "Session ID")}
          className={itemClass}
        >
          <Hash aria-hidden="true" className={iconClass} />
          Copy session ID
        </ContextMenu.Item>
      )}
      {/* The browser's own menu had this. The desktop app's did not, and its
          windows only open pages the server serves. */}
      {!desktopBridge() && (
        <>
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <ContextMenu.Item
            onClick={() =>
              window.open(
                router.buildLocation({
                  to: "/agents/$id",
                  params: { id: session.id },
                }).href,
                "_blank",
                "noopener,noreferrer",
              )
            }
            className={itemClass}
          >
            <ExternalLink aria-hidden="true" className={iconClass} />
            Open in new tab
          </ContextMenu.Item>
        </>
      )}
    </>
  );
}

type RenameTarget = {
  sessionId: string;
  provider: AgentProviderId;
  name: string;
};

let renameTarget: RenameTarget | null = null;
const renameListeners = new Set<() => void>();

function setRenameTarget(next: RenameTarget | null) {
  renameTarget = next;
  for (const listener of renameListeners) listener();
}

function subscribeToRenameTarget(listener: () => void) {
  renameListeners.add(listener);
  return () => {
    renameListeners.delete(listener);
  };
}

/**
 * The rename dialog for whichever row asked for it, mounted once for the
 * page. A row cannot own it: the row leaves its list when a finished turn
 * files it under another group, and the phone drawer closes under the dialog.
 */
export function AgentSessionRenameHost() {
  const target = useSyncExternalStore(
    subscribeToRenameTarget,
    () => renameTarget,
    () => null,
  );
  return target ? (
    <RenameFromRow
      key={target.sessionId}
      target={target}
      onClose={() => setRenameTarget(null)}
    />
  ) : null;
}

/**
 * The name lives in the agent's own session, so renaming goes through the
 * connector, which starts the session if it is idle.
 */
function RenameFromRow({
  target,
  onClose,
}: {
  target: RenameTarget;
  onClose: () => void;
}) {
  const command = useAgentSessionCommand(target.sessionId);
  const [error, setError] = useState("");
  const providerLabel = agentProviderMetadata(target.provider).label;
  return (
    <RenameAgentSessionDialog
      providerLabel={providerLabel}
      open
      initialName={target.name}
      pending={command.isPending}
      error={error}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={(name) => {
        setError("");
        command.mutate(
          { type: "set_session_name", name },
          {
            onSuccess: () => {
              toast.success({ title: "Session renamed" });
              onClose();
            },
            onError: (cause) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : `${providerLabel} command failed.`,
              ),
          },
        );
      }}
    />
  );
}
