"use client";

import { ArrowLeft, Globe2, Plus } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
} from "@/components/settings/SettingsRows";

import { SettingsChoiceGroup } from "@/components/settings/SettingsChoiceGroup";
import {
  RemoveButton,
  RepeatablePairs,
  pairs,
  rowId,
  type Pair,
} from "@/components/settings/RepeatablePairs";

type ValueRow = { id: string; value: string };

function values(items: string[]): ValueRow[] {
  const rows = items.map((value) => ({ id: rowId(), value }));
  return rows.length ? rows : [{ id: rowId(), value: "" }];
}

export function McpServerEditor({ server }: { server?: McpServer }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
      parsed.error.issues[0]?.message ??
        t("tools.mcp.editor.validationFallback"),
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
        title: server
          ? t("tools.mcp.editor.updatedTitle")
          : t("tools.mcp.editor.addedTitle"),
        description: input.name,
      });
      void navigate({ to: "/settings/tools" });
    } catch (cause) {
      setError(getErrorMessage(cause, t("tools.mcp.editor.saveErrorFallback")));
    }
  }

  return (
    <SettingsPage>
      <form onSubmit={save} className="space-y-8">
        <SettingsPageHeader
          leading={
            <Button
              render={<Link to="/settings/tools" />}
              variant="ghost"
              size="icon-sm"
              aria-label={t("tools.mcp.editor.backToTools")}
            >
              <ArrowLeft />
            </Button>
          }
          title={
            server
              ? t("tools.mcp.editor.editTitle")
              : t("tools.mcp.editor.addTitle")
          }
          description={
            <a
              href="https://modelcontextprotocol.io/docs"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              {t("tools.mcp.editor.documentation")}{" "}
              <Globe2 className="size-3.5" />
            </a>
          }
        />

        <SettingsSection
          title={t("tools.mcp.editor.connectionTitle")}
          description={t("tools.mcp.editor.connectionDescription")}
        >
          <Field label={t("tools.mcp.editor.nameLabel")} htmlFor="mcp-name">
            <Input
              id="mcp-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("tools.mcp.editor.namePlaceholder")}
              autoComplete="off"
            />
          </Field>
          <SettingsRow
            title={t("tools.mcp.editor.transportTitle")}
            description={t("tools.mcp.editor.transportDescription")}
          >
            <SettingsChoiceGroup
              label={t("tools.mcp.editor.transportTitle")}
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
            title={t("tools.mcp.editor.localProcessTitle")}
            description={t("tools.mcp.editor.localProcessDescription")}
          >
            <Field
              label={t("tools.mcp.editor.commandLabel")}
              htmlFor="mcp-command"
            >
              <Input
                id="mcp-command"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                // eslint-disable-next-line i18next/no-literal-string -- example command
                placeholder="npx"
                autoComplete="off"
                className="font-mono"
              />
            </Field>

            <RepeatableValues
              label={t("tools.mcp.editor.argumentsLabel")}
              rows={args}
              // eslint-disable-next-line i18next/no-literal-string -- example CLI argument
              placeholder="-y"
              addLabel={t("tools.mcp.editor.addArgument")}
              valueLabel={(index) =>
                t("tools.mcp.editor.argumentValueLabel", { index })
              }
              removeLabel={t("tools.mcp.editor.removeArgumentRow")}
              onChange={setArgs}
            />

            <RepeatablePairs
              label={t("tools.mcp.editor.envVarsLabel")}
              rows={environment}
              keyPlaceholder={t("tools.mcp.editor.keyPlaceholder")}
              valuePlaceholder={t("tools.mcp.editor.valuePlaceholder")}
              addLabel={t("tools.mcp.editor.addEnvVar")}
              removeLabel={t("tools.mcp.editor.removeEnvVarRow")}
              onChange={setEnvironment}
            />

            <RepeatableValues
              label={t("tools.mcp.editor.envPassthroughLabel")}
              rows={passthrough}
              placeholder="VARIABLE_NAME"
              addLabel={t("tools.mcp.editor.addVariable")}
              valueLabel={(index) =>
                t("tools.mcp.editor.passthroughValueLabel", { index })
              }
              removeLabel={t("tools.mcp.editor.removePassthroughRow")}
              onChange={setPassthrough}
            />

            <Field
              label={t("tools.mcp.editor.workingDirectoryLabel")}
              htmlFor="mcp-cwd"
            >
              <Input
                id="mcp-cwd"
                value={cwd}
                onChange={(event) => setCwd(event.target.value)}
                // eslint-disable-next-line i18next/no-literal-string -- example directory path
                placeholder="/app"
                autoComplete="off"
                className="font-mono"
              />
            </Field>
          </SettingsSection>
        ) : (
          <SettingsSection
            title={t("tools.mcp.editor.httpConnectionTitle")}
            description={t("tools.mcp.editor.httpConnectionDescription")}
          >
            <Field
              label={t("tools.mcp.editor.serverUrlLabel")}
              htmlFor="mcp-url"
            >
              <Input
                id="mcp-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                // eslint-disable-next-line i18next/no-literal-string -- example URL
                placeholder="https://example.com/mcp"
                autoComplete="off"
                className="font-mono"
              />
            </Field>

            <RepeatablePairs
              label={t("tools.mcp.editor.httpHeadersLabel")}
              rows={headers}
              keyPlaceholder={t("tools.mcp.editor.headerPlaceholder")}
              valuePlaceholder={t("tools.mcp.editor.valuePlaceholder")}
              addLabel={t("tools.mcp.editor.addHeader")}
              removeLabel={t("tools.mcp.editor.removeHttpHeaderRow")}
              onChange={setHeaders}
            />

            <RepeatablePairs
              label={t("tools.mcp.editor.envHeadersLabel")}
              rows={envHeaders}
              keyPlaceholder={t("tools.mcp.editor.headerPlaceholder")}
              valuePlaceholder={t("tools.mcp.editor.envVarPlaceholder")}
              addLabel={t("tools.mcp.editor.addEnvHeader")}
              removeLabel={t("tools.mcp.editor.removeEnvHeaderRow")}
              onChange={setEnvHeaders}
            />

            <Field
              label={t("tools.mcp.editor.bearerTokenEnvVarLabel")}
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
          <Button variant="outline" render={<Link to="/settings/tools" />}>
            {t("tools.connectors.connectGoogle.cancel")}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving
              ? t("tools.connectors.googleAccess.saving")
              : server
                ? t("tools.mcp.editor.saveChanges")
                : t("tools.mcp.manage.addServer")}
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
  valueLabel,
  removeLabel,
  onChange,
}: {
  label: string;
  rows: ValueRow[];
  placeholder: string;
  addLabel: string;
  valueLabel: (index: number) => string;
  removeLabel: string;
  onChange(rows: ValueRow[]): void;
}) {
  return (
    <SettingsRow title={label} align="start">
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={row.id} className="flex items-center gap-2">
            <Input
              value={row.value}
              aria-label={valueLabel(index + 1)}
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
              label={removeLabel}
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
