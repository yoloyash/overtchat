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
import { Textarea } from "@/components/ui/textarea";
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
  argsText: string;
  envText: string;
  cwd: string;
  enabled: boolean;
  sortOrder: number;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  command: "",
  argsText: "",
  envText: "",
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
  const title = editing ? "Edit MCP server" : "Add MCP server";
  const envPlaceholder = "GITHUB_TOKEN=...\nAPI_KEY=...";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 shadow-lg outline-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity">
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {title}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Stdio servers run as child processes on the web server host.
          </Dialog.Description>

          <div className="mt-5 grid gap-4">
            <Field label="Name" htmlFor="mcp-name">
              <Input
                id="mcp-name"
                value={draft.name}
                onChange={(e) =>
                  onDraftChange({ ...draft, name: e.currentTarget.value })
                }
                placeholder="GitHub"
              />
            </Field>

            <Field label="Command" htmlFor="mcp-command">
              <Input
                id="mcp-command"
                value={draft.command}
                onChange={(e) =>
                  onDraftChange({ ...draft, command: e.currentTarget.value })
                }
                placeholder="npx"
                className="font-mono"
              />
            </Field>

            <Field label="Arguments" htmlFor="mcp-args">
              <Textarea
                id="mcp-args"
                value={draft.argsText}
                onChange={(e) =>
                  onDraftChange({ ...draft, argsText: e.currentTarget.value })
                }
                placeholder={"-y\n@modelcontextprotocol/server-github"}
                className="min-h-24 font-mono text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                One argument per line. Spaces inside a line stay in that argument.
              </p>
            </Field>

            <Field label="Environment" htmlFor="mcp-env">
              <Textarea
                id="mcp-env"
                value={draft.envText}
                onChange={(e) =>
                  onDraftChange({ ...draft, envText: e.currentTarget.value })
                }
                placeholder={envPlaceholder}
                className="min-h-24 font-mono text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                One KEY=value pair per line. Values are stored in the app database.
              </p>
            </Field>

            <Field label="Working directory" htmlFor="mcp-cwd">
              <Input
                id="mcp-cwd"
                value={draft.cwd}
                onChange={(e) =>
                  onDraftChange({ ...draft, cwd: e.currentTarget.value })
                }
                placeholder="/app"
                className="font-mono"
              />
            </Field>

            <label className="flex items-center gap-3 text-sm">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(enabled) =>
                  onDraftChange({ ...draft, enabled })
                }
              />
              Enabled for chats
            </label>
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

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-2">
        {label}
      </Label>
      {children}
    </div>
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
  return {
    name: server.name,
    command: server.command,
    argsText: server.args.join("\n"),
    envText: Object.entries(server.env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
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

  const env = parseEnv(draft.envText);
  if ("error" in env) return env;

  return {
    value: {
      name,
      transport: "stdio",
      command,
      args: draft.argsText
        .split(/\r?\n/)
        .map((arg) => arg.trim())
        .filter(Boolean),
      env: env.value,
      cwd: draft.cwd.trim() || null,
      enabled: draft.enabled,
      sortOrder: draft.sortOrder,
    },
  };
}

function parseEnv(text: string): { value: Record<string, string> } | { error: string } {
  const env: Record<string, string> = {};
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) {
      return { error: `Environment line ${index + 1} must be KEY=value` };
    }
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return { error: `Environment key ${key || index + 1} is invalid` };
    }
    env[key] = line.slice(eq + 1);
  }
  return { value: env };
}
