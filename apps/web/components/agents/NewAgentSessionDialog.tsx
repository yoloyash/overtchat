"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import type {
  AgentProviderId,
  AgentWorkspaceListItem,
} from "@overtchat/agent-bridge";
import { useSidebar } from "@/components/sidebar-context";
import { AGENT_PROVIDER_VISUALS } from "@/lib/agents/providerVisuals";
import { newAgentSessionHref } from "@/lib/agents/sessionDraft";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type NewAgentSessionTarget = {
  workspace: AgentWorkspaceListItem;
  provider: AgentProviderId;
  providerLabel: string;
};

export function NewAgentSessionDialog({
  open,
  onOpenChange,
  targets,
  machineLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: NewAgentSessionTarget[];
  machineLabel: string;
}) {
  const router = useRouter();
  const { closeMobile } = useSidebar();
  const workspace = targets[0]!.workspace;

  function selectAgent(target: NewAgentSessionTarget) {
    onOpenChange(false);
    closeMobile();
    router.push(newAgentSessionHref(target.workspace.id, target.provider));
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            "fixed inset-0 z-40 bg-black/40",
            motionClasses.overlay,
          )}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Choose an agent
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            New session in{" "}
            <span className="font-medium text-foreground">
              {workspace.name}
            </span>
            <span aria-hidden="true"> · </span>
            {machineLabel}
          </Dialog.Description>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {targets.map((target) => {
              const icon = AGENT_PROVIDER_VISUALS[target.provider];
              return (
                <button
                  key={target.provider}
                  type="button"
                  aria-label={`Start ${target.providerLabel} session`}
                  onClick={() => selectAgent(target)}
                  className="flex min-h-16 items-center gap-3 rounded-lg border p-3 text-left outline-none motion-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-md border bg-background",
                      icon.darkSurface && "bg-zinc-950",
                    )}
                  >
                    <Image
                      src={icon.icon}
                      alt=""
                      className="size-5 object-contain"
                    />
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {target.providerLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
