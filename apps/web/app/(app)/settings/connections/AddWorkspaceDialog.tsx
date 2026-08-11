"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  ArrowUp,
  ChevronRight,
  Folder,
  FolderInput,
  FolderPlus,
  Loader2,
  PencilLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";
import {
  useAgentDirectories,
  useCreateAgentWorkspace,
} from "@/lib/queries/agentConnections";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  SettingsActions,
  SettingsNotice,
} from "../_components/SettingsRows";

export function AddWorkspaceDialog({
  connection,
  onClose,
}: {
  connection: AgentConnectionListItem | null;
  onClose: () => void;
}) {
  const [manualEntry, setManualEntry] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [error, setError] = useState("");
  const [browsePath, setBrowsePath] = useState("");
  const mutation = useCreateAgentWorkspace(connection?.id ?? "");
  const directories = useAgentDirectories(
    connection?.id ?? "",
    browsePath,
    connection !== null && !manualEntry,
  );

  function reset() {
    setManualEntry(false);
    setManualPath("");
    setError("");
    setBrowsePath("");
    mutation.reset();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!connection) return;
    const trimmedPath = manualEntry
      ? manualPath.trim()
      : directories.data?.path;
    if (!trimmedPath) {
      setError("Choose a directory.");
      return;
    }
    if (!trimmedPath.startsWith("/")) {
      setError("Enter an absolute directory path.");
      return;
    }
    setError("");
    try {
      const workspace = await mutation.mutateAsync({ path: trimmedPath });
      toast.success({
        title: "Workspace attached",
        description: workspace.path,
      });
      reset();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The workspace could not be attached.",
      );
    }
  }

  return (
    <Dialog.Root
      open={connection !== null}
      onOpenChange={(next) => {
        if (!next && !mutation.isPending) {
          reset();
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Add workspace
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Choose a folder on {connection?.host.name}.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            {manualEntry ? (
              <div className="space-y-1.5">
                <Label htmlFor="agent-workspace-path">Directory path</Label>
                <Input
                  id="agent-workspace-path"
                  value={manualPath}
                  onChange={(event) => {
                    setManualPath(event.target.value);
                    setError("");
                  }}
                  placeholder="/home/user/code/project"
                  className="font-mono"
                  spellCheck={false}
                  autoFocus
                />
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <div className="flex min-h-10 items-center gap-1 border-b bg-muted/20 px-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!directories.data?.parent || directories.isFetching}
                    onClick={() => {
                      const parent = directories.data?.parent;
                      if (parent) {
                        setBrowsePath(parent);
                        setError("");
                      }
                    }}
                    aria-label="Open parent directory"
                    title="Open parent directory"
                  >
                    <ArrowUp />
                  </Button>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-xs"
                    title={directories.data?.path}
                  >
                    {directories.data?.path || "Loading directory"}
                  </span>
                </div>
                <div className="max-h-64 min-h-40 overflow-y-auto p-1">
                  {directories.isFetching && !directories.data ? (
                    <div className="flex h-40 items-center justify-center">
                      <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
                    </div>
                  ) : directories.error ? (
                    <p className="px-3 py-16 text-center text-xs text-destructive">
                      {directories.error instanceof Error
                        ? directories.error.message
                        : "Directory could not be opened."}
                    </p>
                  ) : directories.data?.directories.length === 0 ? (
                    <p className="px-3 py-16 text-center text-xs text-muted-foreground">
                      No subdirectories
                    </p>
                  ) : (
                    directories.data?.directories.map((directory) => (
                      <button
                        key={directory.path}
                        type="button"
                        onClick={() => {
                          setBrowsePath(directory.path);
                          setError("");
                        }}
                        className="flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm motion-colors hover:bg-muted"
                        title={directory.path}
                      >
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">
                          {directory.name}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
            {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
            <SettingsActions className="justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => {
                  if (!manualEntry) {
                    setManualPath(directories.data?.path ?? "");
                  }
                  setManualEntry((current) => !current);
                  setError("");
                }}
              >
                {manualEntry ? <FolderInput /> : <PencilLine />}
                {manualEntry ? "Browse folders" : "Enter path"}
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() => {
                    reset();
                    onClose();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    mutation.isPending ||
                    (manualEntry
                      ? !manualPath.trim()
                      : !directories.data || directories.isFetching)
                  }
                >
                  {mutation.isPending ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <FolderPlus />
                  )}
                  Add workspace
                </Button>
              </div>
            </SettingsActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
