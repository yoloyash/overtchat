"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import {
  CheckCircle2,
  Loader2,
  Plus,
  Server,
  TestTube2,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type {
  AdminMcpServer,
  McpServerInput,
  McpServerTestResult,
} from "@/lib/toolConfig";
import {
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  useTestMcpServer,
  useToolSettings,
  useUpdateMcpServer,
  useUpdateToolSettings,
} from "@/lib/queries/tools";

type Draft = {
  name: string;
  command: string;
  args: string[];
  envRows: EnvRow[];
  cwd: string;
  enabled: boolean;
  sortOrder: number;
};

type EnvRow = { key: string; value: string };

const EMPTY_DRAFT: Draft = {
  name: "",
  command: "",
  args: [""],
  envRows: [{ key: "", value: "" }],
  cwd: "",
  enabled: true,
  sortOrder: 0,
};

export function ToolsPanel() {
  const { data: settings = { webSearchEnabled: true } } = useToolSettings();
  const { data: servers = [] } = useMcpServers();
  const updateSettings = useUpdateToolSettings();
  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer();
  const deleteServer = useDeleteMcpServer();
  const testServer = useTestMcpServer();

  const [editing, setEditing] = useState<AdminMcpServer | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editorOpen, setEditorOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [testResult, setTestResult] = useState<McpServerTestResult | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminMcpServer | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const busy = createServer.isPending || updateServer.isPending;

  function openEditor(server?: AdminMcpServer) {
    setEditing(server ?? null);
    setDraft(server ? draftFromServer(server) : EMPTY_DRAFT);
    setFormError("");
    setTestResult(null);
    setEditorOpen(true);
  }

  async function saveDraft() {
    setFormError("");
    const input = parseDraft(draft);
    if ("error" in input) {
      setFormError(input.error);
      return;
    }

    try {
      if (editing) {
        await updateServer.mutateAsync({ id: editing.id, input: input.value });
      } else {
        await createServer.mutateAsync(input.value);
      }
      setEditorOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save server");
    }
  }

  async function testDraft() {
    setFormError("");
    setTestResult(null);
    const input = parseDraft(draft);
    if ("error" in input) {
      setFormError(input.error);
      return;
    }
    try {
      const result = await testServer.mutateAsync(input.value);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        elapsedMs: 0,
        error: err instanceof Error ? err.message : "Failed to test server",
      });
    }
  }

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
        <Button size="sm" onClick={() => openEditor()}>
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
            <Button variant="ghost" size="sm" onClick={() => openEditor()}>
              <Plus /> Add
            </Button>
          )}
        </div>

        {servers.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-14 text-center">
            <p className="text-sm text-muted-foreground">
              No MCP servers configured yet.
            </p>
            <Button className="mt-4" size="sm" onClick={() => openEditor()}>
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
                onEdit={openEditor}
                onDelete={(target) => {
                  setDeleteError("");
                  setPendingDelete(target);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <EditorDialog
        open={editorOpen}
        editing={editing}
        draft={draft}
        formError={formError}
        busy={busy}
        testPending={testServer.isPending}
        testResult={testResult}
        onOpenChange={(open) => {
          if (!open && !busy) setEditorOpen(false);
        }}
        onDraftChange={setDraft}
        onSave={saveDraft}
        onTest={testDraft}
      />

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
  onEdit,
  onDelete,
}: {
  server: AdminMcpServer;
  disabled: boolean;
  onToggle: (server: AdminMcpServer, enabled: boolean) => void;
  onEdit: (server: AdminMcpServer) => void;
  onDelete: (server: AdminMcpServer) => void;
}) {
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onEdit(server)}
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
      </button>
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

function EditorDialog({
  open,
  editing,
  draft,
  formError,
  busy,
  testPending,
  testResult,
  onOpenChange,
  onDraftChange,
  onSave,
  onTest,
}: {
  open: boolean;
  editing: AdminMcpServer | null;
  draft: Draft;
  formError: string;
  busy: boolean;
  testPending: boolean;
  testResult: McpServerTestResult | null;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: Draft) => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const title = editing ? "Edit MCP server" : "Connect to a custom MCP";

  function updateArg(index: number, value: string) {
    const args = [...draft.args];
    args[index] = value;
    onDraftChange({ ...draft, args });
  }

  function addArg() {
    onDraftChange({ ...draft, args: [...draft.args, ""] });
  }

  function removeArg(index: number) {
    const args = draft.args.filter((_, i) => i !== index);
    onDraftChange({ ...draft, args: args.length ? args : [""] });
  }

  function updateEnv(index: number, patch: Partial<EnvRow>) {
    const envRows = draft.envRows.map((row, i) =>
      i === index ? { ...row, ...patch } : row,
    );
    onDraftChange({ ...draft, envRows });
  }

  function addEnv() {
    onDraftChange({
      ...draft,
      envRows: [...draft.envRows, { key: "", value: "" }],
    });
  }

  function removeEnv(index: number) {
    const envRows = draft.envRows.filter((_, i) => i !== index);
    onDraftChange({
      ...draft,
      envRows: envRows.length ? envRows : [{ key: "", value: "" }],
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 shadow-lg outline-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold tracking-tight">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                Configure a stdio MCP server that runs on the web server host.
              </Dialog.Description>
            </div>
            <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              STDIO
            </span>
          </div>

          <div className="mt-6 overflow-hidden rounded-xl border">
            <ConfigSection label="Name" htmlFor="mcp-name">
              <Input
                id="mcp-name"
                value={draft.name}
                onChange={(e) =>
                  onDraftChange({ ...draft, name: e.currentTarget.value })
                }
                placeholder="MCP server name"
              />
            </ConfigSection>

            <ConfigSection label="Command to launch" htmlFor="mcp-command">
              <Input
                id="mcp-command"
                value={draft.command}
                onChange={(e) =>
                  onDraftChange({ ...draft, command: e.currentTarget.value })
                }
                placeholder="node"
                className="font-mono"
              />
            </ConfigSection>

            <ConfigSection label="Arguments">
              <div className="space-y-2">
                {draft.args.map((arg, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      id={index === 0 ? "mcp-args" : undefined}
                      value={arg}
                      onChange={(e) => updateArg(index, e.currentTarget.value)}
                      placeholder={
                        index === 0
                          ? "/home/user/dev/server/build/index.js"
                          : "Argument"
                      }
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeArg(index)}
                      aria-label={`Remove argument ${index + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={addArg}
                >
                  <Plus /> Add argument
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Each row is one argv entry. Spaces inside a row stay in that
                argument.
              </p>
            </ConfigSection>

            <ConfigSection label="Environment variables">
              <div className="space-y-2">
                {draft.envRows.map((row, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                  >
                    <Input
                      id={index === 0 ? "mcp-env-key" : undefined}
                      value={row.key}
                      onChange={(e) =>
                        updateEnv(index, { key: e.currentTarget.value })
                      }
                      placeholder="Key"
                      className="font-mono"
                    />
                    <Input
                      id={index === 0 ? "mcp-env-value" : undefined}
                      value={row.value}
                      onChange={(e) =>
                        updateEnv(index, { value: e.currentTarget.value })
                      }
                      placeholder="Value"
                      className="font-mono max-sm:col-start-1 max-sm:row-start-2"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1"
                      onClick={() => removeEnv(index)}
                      aria-label={`Remove environment variable ${index + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={addEnv}
                >
                  <Plus /> Add environment variable
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Values are stored in the app database and passed only to this
                server process.
              </p>
            </ConfigSection>

            <ConfigSection label="Working directory" htmlFor="mcp-cwd">
              <Input
                id="mcp-cwd"
                value={draft.cwd}
                onChange={(e) =>
                  onDraftChange({ ...draft, cwd: e.currentTarget.value })
                }
                placeholder="/app"
                className="font-mono"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Use an absolute path on the web server host; shell shortcuts like
                ~ are not expanded.
              </p>
            </ConfigSection>

            <div className="flex items-center justify-between gap-3 bg-muted/15 px-4 py-4">
              <span className="text-sm font-medium text-foreground">
                Enabled for chats
              </span>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(enabled) =>
                  onDraftChange({ ...draft, enabled })
                }
                aria-label="Enabled for chats"
              />
            </div>
          </div>

          {formError && (
            <p className="mt-4 text-sm text-destructive">{formError}</p>
          )}
          <TestResult result={testResult} pending={testPending} />

          <div className="mt-6 flex flex-wrap justify-between gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || testPending}
              onClick={onTest}
            >
              {testPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <TestTube2 />
              )}
              Test
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={onSave}>
                {busy ? "Saving..." : editing ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ConfigSection({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b bg-muted/10 px-4 py-4 last:border-b-0">
      <Label htmlFor={htmlFor} className="mb-3 text-sm font-semibold">
        {label}
      </Label>
      {children}
    </section>
  );
}

function TestResult({
  result,
  pending,
}: {
  result: McpServerTestResult | null;
  pending: boolean;
}) {
  const toolPreview = useMemo(() => {
    if (!result?.ok) return "";
    return result.tools.map((tool) => tool.name).join(", ");
  }, [result]);

  if (pending) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Testing MCP server...
      </div>
    );
  }
  if (!result) return null;
  if (!result.ok) {
    return (
      <div className="mt-4 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        <XCircle className="mt-0.5 size-4 shrink-0" />
        <span>{result.error}</span>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 text-foreground">
        <CheckCircle2 className="size-4 text-emerald-600" />
        Connected in {result.elapsedMs}ms
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {result.tools.length} {result.tools.length === 1 ? "tool" : "tools"}
        {toolPreview ? `: ${toolPreview}` : ""}
      </p>
    </div>
  );
}

function draftFromServer(server: AdminMcpServer): Draft {
  const envRows = Object.entries(server.env).map(([key, value]) => ({
    key,
    value,
  }));
  return {
    name: server.name,
    command: server.command,
    args: server.args.length ? server.args : [""],
    envRows: envRows.length ? envRows : [{ key: "", value: "" }],
    cwd: server.cwd ?? "",
    enabled: server.enabled,
    sortOrder: server.sortOrder,
  };
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

function parseDraft(
  draft: Draft,
): { value: McpServerInput } | { error: string } {
  const name = draft.name.trim();
  const command = draft.command.trim();
  if (!name) return { error: "Name is required" };
  if (!command) return { error: "Command is required" };

  const env = parseEnvRows(draft.envRows);
  if ("error" in env) return env;

  return {
    value: {
      name,
      transport: "stdio",
      command,
      args: draft.args
        .map((arg) => arg.trim())
        .filter(Boolean),
      env: env.value,
      cwd: draft.cwd.trim() || null,
      enabled: draft.enabled,
      sortOrder: draft.sortOrder,
    },
  };
}

function parseEnvRows(
  rows: EnvRow[],
): { value: Record<string, string> } | { error: string } {
  const env: Record<string, string> = {};
  for (const [index, row] of rows.entries()) {
    const key = row.key.trim();
    const value = row.value;
    if (!key && !value.trim()) continue;
    if (!key) {
      return { error: `Environment row ${index + 1} needs a key` };
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return { error: `Environment key ${key || index + 1} is invalid` };
    }
    env[key] = value;
  }
  return { value: env };
}
