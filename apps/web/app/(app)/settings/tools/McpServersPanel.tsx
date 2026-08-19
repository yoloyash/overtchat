"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Pencil, Plus, Server, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import type {
  McpServer,
  McpServerAvailability,
} from "@/lib/mcp/schema";
import { motionClasses } from "@/lib/motion";
import {
  useDeleteMcpServer,
  useMcpServers,
  useUpdateMcpServer,
} from "@/lib/queries/mcpServers";
import { cn } from "@/lib/utils";
import {
  SettingsNotice,
  SettingsSection,
} from "../_components/SettingsRows";
import { McpHealthBadge } from "./McpHealthBadge";

export function McpServersPanel() {
  const { data: servers = [] } = useMcpServers();
  const updateServer = useUpdateMcpServer();
  const deleteServer = useDeleteMcpServer();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<McpServer | null>(null);
  const [deleteError, setDeleteError] = useState("");

  async function setAvailability(
    server: McpServer,
    availability: McpServerAvailability,
  ) {
    setTogglingId(server.id);
    try {
      await updateServer.mutateAsync({
        id: server.id,
        input: { name: server.name, availability, config: server.config },
      });
    } catch (error) {
      toast.error({
        title: "Failed to change MCP server availability",
        description: getErrorMessage(error, "The server was not changed."),
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
      toast.success({
        title: "MCP server deleted",
        description: pendingDelete.name,
      });
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(getErrorMessage(error, "Failed to delete MCP server"));
    }
  }

  return (
    <>
      <SettingsSection
        title="Manage MCP servers"
        description="Connect external tool servers and choose who can use them. Commands run inside the OvertChat server environment."
        action={
          <Button
            render={<Link href="/settings/tools/mcp/new" />}
            size="sm"
          >
            <Plus /> Add server
          </Button>
        }
      >
        {servers.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No MCP servers configured.
            </p>
          </div>
        ) : (
          servers.map((server) => (
            <div
              key={server.id}
              className={cn(
                "grid gap-3 py-3 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-center",
                server.availability === "disabled" && "opacity-65",
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30">
                  <Server className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium">{server.name}</p>
                    <McpHealthBadge id={server.id} />
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {server.config.transport === "stdio"
                      ? [server.config.command, ...server.config.args].join(" ")
                      : server.config.url}
                  </p>
                  <p className="mt-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {server.config.transport === "stdio"
                      ? "STDIO"
                      : "Streamable HTTP"}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <span className="hidden text-xs text-muted-foreground @2xl:inline">
                  Available to
                </span>
                <Select
                  value={server.availability}
                  disabled={togglingId === server.id}
                  onValueChange={(availability) => {
                    if (!availability) return;
                    void setAvailability(
                      server,
                      availability as McpServerAvailability,
                    );
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-32"
                    aria-label={`Available to for ${server.name}`}
                  >
                    <SelectValue>
                      {server.availability === "everyone"
                        ? "Everyone"
                        : server.availability === "admins"
                          ? "Admins only"
                          : "Disabled"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="everyone">Everyone</SelectItem>
                    <SelectItem value="admins">Admins only</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
                <div className="h-6 w-px bg-border" aria-hidden="true" />
                <Button
                  render={<Link href={`/settings/tools/mcp/${server.id}`} />}
                  variant="outline"
                  size="sm"
                >
                  <Pencil /> Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    setDeleteError("");
                    setPendingDelete(server);
                  }}
                >
                  <Trash2 /> Delete
                </Button>
              </div>
            </div>
          ))
        )}
      </SettingsSection>

      <AlertDialog.Root
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteServer.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop
            className={cn(
              "fixed inset-0 z-40 bg-black/40",
              motionClasses.overlay,
            )}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold">
              Delete MCP server?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {pendingDelete?.name}
              </span>{" "}
              and its configuration will be removed.
            </AlertDialog.Description>
            {deleteError && (
              <SettingsNotice tone="error" className="mt-3 text-xs">
                {deleteError}
              </SettingsNotice>
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
                onClick={() => void confirmDelete()}
              >
                {deleteServer.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
