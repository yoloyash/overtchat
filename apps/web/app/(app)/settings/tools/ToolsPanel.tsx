"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Plus, Server, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { AdminMcpServer, McpServerInput } from "@/lib/toolConfig";
import {
  useDeleteMcpServer,
  useMcpServers,
  useToolSettings,
  useUpdateMcpServer,
  useUpdateToolSettings,
} from "@/lib/queries/tools";

export function ToolsPanel() {
  const { data: settings = { webSearchEnabled: true } } = useToolSettings();
  const { data: servers = [] } = useMcpServers();
  const updateSettings = useUpdateToolSettings();
  const updateServer = useUpdateMcpServer();
  const deleteServer = useDeleteMcpServer();

  const [pendingDelete, setPendingDelete] = useState<AdminMcpServer | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function toggleServer(server: AdminMcpServer, enabled: boolean) {
    setTogglingId(server.id);
    try {
      await updateServer.mutateAsync({
        id: server.id,
        input: serverToInput({ ...server, enabled }),
      });
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteError("");
    try {
      await deleteServer.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <div className="max-w-3xl space-y-7">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tools</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Built-in web tools and stdio MCP servers available to everyone.
          </p>
        </div>
        <Button render={<Link href="/settings/tools/mcp/new" />} size="sm">
          <Plus /> Add MCP
        </Button>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Built-in tools</h2>
        <div className="flex items-center gap-3 rounded-lg border bg-card px-3.5 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Wrench className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">Web search</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Enables both web_search and fetch_url when users turn on Search.
            </p>
          </div>
          <Switch
            checked={settings.webSearchEnabled}
            disabled={updateSettings.isPending}
            onCheckedChange={(webSearchEnabled) =>
              updateSettings.mutate({ webSearchEnabled })
            }
            aria-label={
              settings.webSearchEnabled
                ? "Disable web search tools"
                : "Enable web search tools"
            }
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold tracking-tight">MCP servers</h2>
          {servers.length > 0 && (
            <Button
              render={<Link href="/settings/tools/mcp/new" />}
              variant="ghost"
              size="sm"
            >
              <Plus /> Add
            </Button>
          )}
        </div>

        {servers.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-14 text-center">
            <p className="text-sm text-muted-foreground">
              No MCP servers configured yet.
            </p>
            <Button
              render={<Link href="/settings/tools/mcp/new" />}
              className="mt-4"
              size="sm"
            >
              <Plus /> Add your first MCP server
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {servers.map((server) => (
              <McpServerRow
                key={server.id}
                server={server}
                disabled={togglingId === server.id}
                onToggle={toggleServer}
                onDelete={(target) => {
                  setDeleteError("");
                  setPendingDelete(target);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <AlertDialog.Root
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next && !deleteServer.isPending) {
            setPendingDelete(null);
            setDeleteError("");
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity" />
          <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg outline-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity">
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              Delete MCP server?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {pendingDelete?.name}
              </span>{" "}
              will no longer be available to chats.
            </AlertDialog.Description>
            {deleteError && (
              <p className="mt-3 text-xs text-destructive">{deleteError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={deleteServer.isPending}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteServer.isPending}
                onClick={confirmDelete}
              >
                {deleteServer.isPending ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

function McpServerRow({
  server,
  disabled,
  onToggle,
  onDelete,
}: {
  server: AdminMcpServer;
  disabled: boolean;
  onToggle: (server: AdminMcpServer, enabled: boolean) => void;
  onDelete: (server: AdminMcpServer) => void;
}) {
  return (
    <li className="group relative">
      <Link
        href={`/settings/tools/mcp/${server.id}`}
        aria-label={`Edit ${server.name}`}
        className={`flex w-full items-center rounded-lg border bg-card px-3.5 py-3 pr-28 text-left transition-colors hover:border-ring/40 hover:bg-accent/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 ${server.enabled ? "" : "opacity-60"}`}
      >
        <div className="mr-2.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Server className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {server.name}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              stdio
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <span className="truncate">{server.command}</span>
            {server.args.length > 0 && (
              <span className="truncate">
                {server.args.map((arg) => JSON.stringify(arg)).join(" ")}
              </span>
            )}
          </div>
        </div>
      </Link>
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        <Switch
          checked={server.enabled}
          disabled={disabled}
          onCheckedChange={(next) => onToggle(server, next)}
          aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
        />
        <button
          type="button"
          onClick={() => onDelete(server)}
          aria-label={`Delete ${server.name}`}
          className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 group-hover:opacity-100"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </li>
  );
}

function serverToInput(server: AdminMcpServer): McpServerInput {
  return {
    name: server.name,
    transport: "stdio",
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: server.cwd,
    enabled: server.enabled,
    sortOrder: server.sortOrder,
  };
}
