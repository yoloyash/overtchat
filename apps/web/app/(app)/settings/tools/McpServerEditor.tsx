"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Plus,
  TestTube2,
  Trash2,
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
  useTestMcpServer,
  useUpdateMcpServer,
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

export function McpServerEditor({ server }: { server?: AdminMcpServer }) {
  const router = useRouter();
  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer();
  const testServer = useTestMcpServer();

  const [draft, setDraft] = useState<Draft>(() =>
    server ? draftFromServer(server) : EMPTY_DRAFT,
  );
  const [formError, setFormError] = useState("");
  const [testResult, setTestResult] = useState<McpServerTestResult | null>(null);

  const isEditing = Boolean(server);
  const busy = createServer.isPending || updateServer.isPending;
  const title = isEditing ? "Edit MCP server" : "Connect to a custom MCP";

  function updateArg(index: number, value: string) {
    const args = [...draft.args];
    args[index] = value;
    setDraft({ ...draft, args });
  }

  function addArg() {
    setDraft({ ...draft, args: [...draft.args, ""] });
  }

  function removeArg(index: number) {
    const args = draft.args.filter((_, i) => i !== index);
    setDraft({ ...draft, args: args.length ? args : [""] });
  }

  function updateEnv(index: number, patch: Partial<EnvRow>) {
    const envRows = draft.envRows.map((row, i) =>
      i === index ? { ...row, ...patch } : row,
    );
    setDraft({ ...draft, envRows });
  }

  function addEnv() {
    setDraft({
      ...draft,
      envRows: [...draft.envRows, { key: "", value: "" }],
    });
  }

  function removeEnv(index: number) {
    const envRows = draft.envRows.filter((_, i) => i !== index);
    setDraft({
      ...draft,
      envRows: envRows.length ? envRows : [{ key: "", value: "" }],
    });
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const input = parseDraft(draft);
    if ("error" in input) {
      setFormError(input.error);
      return;
    }

    try {
      if (server) {
        await updateServer.mutateAsync({ id: server.id, input: input.value });
      } else {
        await createServer.mutateAsync(input.value);
      }
      router.push("/settings/tools");
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

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center gap-2">
        <Button
          render={<Link href="/settings/tools" />}
          variant="ghost"
          size="icon-sm"
          aria-label="Back to tools"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure a stdio MCP server that runs on the web server host.
          </p>
        </div>
        <span className="ml-auto rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
          STDIO
        </span>
      </div>

      <form onSubmit={saveDraft}>
        <div className="overflow-hidden rounded-xl border">
          <ConfigSection label="Name" htmlFor="mcp-name">
            <Input
              id="mcp-name"
              value={draft.name}
              onChange={(e) =>
                setDraft({ ...draft, name: e.currentTarget.value })
              }
              placeholder="MCP server name"
            />
          </ConfigSection>

          <ConfigSection label="Command to launch" htmlFor="mcp-command">
            <Input
              id="mcp-command"
              value={draft.command}
              onChange={(e) =>
                setDraft({ ...draft, command: e.currentTarget.value })
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
                setDraft({ ...draft, cwd: e.currentTarget.value })
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
              onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
              aria-label="Enabled for chats"
            />
          </div>
        </div>

        {formError && (
          <p className="mt-4 text-sm text-destructive">{formError}</p>
        )}
        <TestResult result={testResult} pending={testServer.isPending} />

        <div className="mt-6 flex flex-wrap justify-between gap-2 border-t pt-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || testServer.isPending}
            onClick={testDraft}
          >
            {testServer.isPending ? (
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
              render={<Link href="/settings/tools" />}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Saving..." : isEditing ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </form>
    </div>
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
      args: draft.args.map((arg) => arg.trim()).filter(Boolean),
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
