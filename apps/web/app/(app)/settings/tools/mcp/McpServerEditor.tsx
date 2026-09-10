"use client";

import { ArrowLeft, Globe2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import {
  McpServerInputSchema,
  type McpServer,
  type McpServerConfig,
  type McpServerInput,
} from "@/lib/mcp/schema";
import {
  useCreateMcpServer,
  useUpdateMcpServer,
} from "@/lib/queries/mcpServers";
import {
  SettingsActions,
  SettingsNotice,
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../../_components/SettingsRows";

import { SettingsChoiceGroup } from "../../_components/SettingsChoiceGroup";

type Pair = { id: string; key: string; value: string };
type ValueRow = { id: string; value: string };

function rowId() {
  return crypto.randomUUID();
}

function pairs(value: Record<string, string>): Pair[] {
  const entries = Object.entries(value).map(([key, item]) => ({
    id: rowId(),
    key,
    value: item,
  }));
  return entries.length ? entries : [{ id: rowId(), key: "", value: "" }];
}

function values(items: string[]): ValueRow[] {
  const rows = items.map((value) => ({ id: rowId(), value }));
  return rows.length ? rows : [{ id: rowId(), value: "" }];
}

export function McpServerEditor({ server }: { server?: McpServer }) {
  const router = useRouter();
  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer();
  const existingConfig = server?.config;

  const [name, setName] = useState(server?.name ?? "");
  const [transport, setTransport] = useState<"stdio" | "http">(
    existingConfig?.transport ?? "stdio",
  );
  const [command, setCommand] = useState(
    existingConfig?.transport === "stdio" ? existingConfig.command : "",
  );
  const [args, setArgs] = useState<ValueRow[]>(
    values(existingConfig?.transport === "stdio" ? existingConfig.args : []),
  );
  const [environment, setEnvironment] = useState<Pair[]>(
    pairs(existingConfig?.transport === "stdio" ? existingConfig.env : {}),
  );
  const [passthrough, setPassthrough] = useState<ValueRow[]>(
    values(
      existingConfig?.transport === "stdio"
        ? existingConfig.envPassthrough
        : [],
    ),
  );
  const [cwd, setCwd] = useState(
    existingConfig?.transport === "stdio" ? (existingConfig.cwd ?? "") : "",
  );
  const [url, setUrl] = useState(
    existingConfig?.transport === "http" ? existingConfig.url : "",
  );
  const [headers, setHeaders] = useState<Pair[]>(
    pairs(existingConfig?.transport === "http" ? existingConfig.headers : {}),
  );
  const [envHeaders, setEnvHeaders] = useState<Pair[]>(
    pairs(
      existingConfig?.transport === "http"
        ? (existingConfig.envHeaders ?? {})
        : {},
    ),
  );
  const [bearerTokenEnvVar, setBearerTokenEnvVar] = useState(
    existingConfig?.transport === "http"
      ? (existingConfig.bearerTokenEnvVar ?? "")
      : "",
  );
  const [error, setError] = useState("");
  const saving = createServer.isPending || updateServer.isPending;

  function configFromForm(): McpServerConfig {
    if (transport === "stdio") {
      return {
        transport,
        command,
        args: args.map((row) => row.value).filter((value) => value.length > 0),
        env: Object.fromEntries(
          environment
            .filter((row) => row.key.trim())
            .map((row) => [row.key.trim(), row.value]),
        ),
        envPassthrough: passthrough
          .map((row) => row.value.trim())
          .filter(Boolean),
        ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
      };
    }
    return {
      transport,
      url: url.trim(),
      headers: Object.fromEntries(
        headers
          .filter((row) => row.key.trim())
          .map((row) => [row.key.trim(), row.value]),
      ),
      envHeaders: Object.fromEntries(
        envHeaders
          .filter((row) => row.key.trim())
          .map((row) => [row.key.trim(), row.value.trim()]),
      ),
      ...(bearerTokenEnvVar.trim()
        ? { bearerTokenEnvVar: bearerTokenEnvVar.trim() }
        : {}),
    };
  }

  function validatedInput(): McpServerInput | null {
    const parsed = McpServerInputSchema.safeParse({
      name,
      availability: server?.availability ?? "everyone",
      config: configFromForm(),
    });
    if (parsed.success) return parsed.data;
    setError(
      parsed.error.issues[0]?.message ?? "Check the server configuration.",
    );
    return null;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const input = validatedInput();
    if (!input) return;
    try {
      if (server) {
        await updateServer.mutateAsync({ id: server.id, input });
      } else {
        await createServer.mutateAsync(input);
      }
      toast.success({
        title: server ? "MCP server updated" : "MCP server added",
        description: input.name,
      });
      router.push("/settings/tools");
    } catch (cause) {
      setError(getErrorMessage(cause, "Failed to save MCP server"));
    }
  }

  return (
    <SettingsPage>
      <form onSubmit={save} className="space-y-8">
        <SettingsPageHeader
          leading={
            <Button
              render={<Link href="/settings/tools" />}
              variant="ghost"
              size="icon-sm"
              aria-label="Back to tools"
            >
              <ArrowLeft />
            </Button>
          }
          title={server ? "Edit MCP server" : "Add MCP server"}
          description={
            <a
              href="https://modelcontextprotocol.io/docs"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              MCP documentation <Globe2 className="size-3.5" />
            </a>
          }
        />

        <SettingsSection
          title="Connection"
          description="Name this server and choose how OvertChat connects to it."
        >
          <Field label="Name" htmlFor="mcp-name">
            <Input
              id="mcp-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="MCP server name"
              autoComplete="off"
            />
          </Field>
          <SettingsRow
            title="Transport"
            description="Run a local process or connect to an HTTP server."
          >
            <SettingsChoiceGroup
              label="Transport"
              value={transport}
              onValueChange={(next) => setTransport(next as "stdio" | "http")}
              options={[
                { value: "stdio", label: "STDIO" },
                { value: "http", label: "Streamable HTTP" },
              ]}
            />
          </SettingsRow>
        </SettingsSection>

        {transport === "stdio" ? (
          <SettingsSection
            title="Local process"
            description="Configure the command and environment used to start this server."
          >
            <Field label="Command to launch" htmlFor="mcp-command">
              <Input
                id="mcp-command"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx"
                autoComplete="off"
                className="font-mono"
              />
            </Field>

            <RepeatableValues
              label="Arguments"
              rows={args}
              placeholder="-y"
              addLabel="Add argument"
              onChange={setArgs}
            />

            <RepeatablePairs
              label="Environment variables"
              rows={environment}
              keyPlaceholder="Key"
              valuePlaceholder="Value"
              addLabel="Add environment variable"
              onChange={setEnvironment}
            />

            <RepeatableValues
              label="Environment variable passthrough"
              rows={passthrough}
              placeholder="VARIABLE_NAME"
              addLabel="Add variable"
              onChange={setPassthrough}
            />

            <Field label="Working directory" htmlFor="mcp-cwd">
              <Input
                id="mcp-cwd"
                value={cwd}
                onChange={(event) => setCwd(event.target.value)}
                placeholder="/app"
                autoComplete="off"
                className="font-mono"
              />
            </Field>
          </SettingsSection>
        ) : (
          <SettingsSection
            title="HTTP connection"
            description="Configure the server address and optional authentication."
          >
            <Field label="Server URL" htmlFor="mcp-url">
              <Input
                id="mcp-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
                autoComplete="off"
                className="font-mono"
              />
            </Field>

            <RepeatablePairs
              label="HTTP headers"
              rows={headers}
              keyPlaceholder="Header"
              valuePlaceholder="Value"
              addLabel="Add header"
              onChange={setHeaders}
            />

            <RepeatablePairs
              label="Environment variable HTTP headers"
              rows={envHeaders}
              keyPlaceholder="Header"
              valuePlaceholder="Environment variable"
              addLabel="Add environment header"
              onChange={setEnvHeaders}
            />

            <Field
              label="Bearer token environment variable"
              htmlFor="mcp-bearer-env"
            >
              <Input
                id="mcp-bearer-env"
                value={bearerTokenEnvVar}
                onChange={(event) => setBearerTokenEnvVar(event.target.value)}
                placeholder="MCP_API_TOKEN"
                autoComplete="off"
                className="font-mono"
              />
            </Field>
          </SettingsSection>
        )}

        {error && <SettingsNotice tone="error">{error}</SettingsNotice>}

        <SettingsActions>
          <Button variant="outline" render={<Link href="/settings/tools" />}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : server ? "Save changes" : "Add server"}
          </Button>
        </SettingsActions>
      </form>
    </SettingsPage>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <SettingsRow title={label} htmlFor={htmlFor}>
      {children}
    </SettingsRow>
  );
}

function RepeatableValues({
  label,
  rows,
  placeholder,
  addLabel,
  onChange,
}: {
  label: string;
  rows: ValueRow[];
  placeholder: string;
  addLabel: string;
  onChange(rows: ValueRow[]): void;
}) {
  return (
    <SettingsRow title={label} align="start">
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={row.id} className="flex items-center gap-2">
            <Input
              value={row.value}
              aria-label={`${label} value ${index + 1}`}
              onChange={(event) =>
                onChange(
                  rows.map((item) =>
                    item.id === row.id
                      ? { ...item, value: event.target.value }
                      : item,
                  ),
                )
              }
              placeholder={placeholder}
              autoComplete="off"
              className="font-mono"
            />
            <RemoveButton
              label={`Remove ${label.toLowerCase()} row`}
              disabled={rows.length === 1 && row.value === ""}
              onClick={() =>
                onChange(rows.filter((item) => item.id !== row.id))
              }
            />
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => onChange([...rows, { id: rowId(), value: "" }])}
        >
          <Plus /> {addLabel}
        </Button>
      </div>
    </SettingsRow>
  );
}

function RepeatablePairs({
  label,
  rows,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  onChange,
}: {
  label: string;
  rows: Pair[];
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  onChange(rows: Pair[]): void;
}) {
  return (
    <SettingsRow title={label} align="start">
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div
            key={row.id}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"
          >
            <Input
              value={row.key}
              aria-label={`${label} key ${index + 1}`}
              onChange={(event) =>
                onChange(
                  rows.map((item) =>
                    item.id === row.id
                      ? { ...item, key: event.target.value }
                      : item,
                  ),
                )
              }
              placeholder={keyPlaceholder}
              autoComplete="off"
              className="font-mono"
            />
            <Input
              value={row.value}
              aria-label={`${label} value ${index + 1}`}
              onChange={(event) =>
                onChange(
                  rows.map((item) =>
                    item.id === row.id
                      ? { ...item, value: event.target.value }
                      : item,
                  ),
                )
              }
              placeholder={valuePlaceholder}
              autoComplete="off"
              className="font-mono"
            />
            <RemoveButton
              label={`Remove ${label.toLowerCase()} row`}
              disabled={rows.length === 1 && row.key === "" && row.value === ""}
              onClick={() =>
                onChange(rows.filter((item) => item.id !== row.id))
              }
            />
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() =>
            onChange([...rows, { id: rowId(), key: "", value: "" }])
          }
        >
          <Plus /> {addLabel}
        </Button>
      </div>
    </SettingsRow>
  );
}

function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="text-muted-foreground hover:text-destructive"
    >
      <Trash2 />
    </Button>
  );
}
