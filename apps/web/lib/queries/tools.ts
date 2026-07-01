"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toolKeys } from "@/lib/queries/keys";
import type {
  AdminMcpServer,
  McpServerInput,
  McpServerTestResult,
  ToolSettings,
  ToolSettingsInput,
} from "@/lib/toolConfig";

export interface ToolCapabilities {
  webSearchEnabled: boolean;
  mcpServersEnabled: boolean;
}

export function useToolSettings() {
  return useQuery({
    queryKey: toolKeys.settings(),
    queryFn: async (): Promise<ToolSettings> => {
      const r = await fetch("/api/tool-settings");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as { settings: ToolSettings };
      return json.settings;
    },
  });
}

export function useToolCapabilities() {
  return useQuery({
    queryKey: toolKeys.capabilities(),
    queryFn: async (): Promise<ToolCapabilities> => {
      const r = await fetch("/api/tools/capabilities");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as ToolCapabilities;
    },
  });
}

export function useMcpServers() {
  return useQuery({
    queryKey: toolKeys.mcpServers(),
    queryFn: async (): Promise<AdminMcpServer[]> => {
      const r = await fetch("/api/mcp-servers");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as { servers: AdminMcpServer[] };
      return json.servers;
    },
  });
}

function invalidateTools(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: toolKeys.all() });
}

export function useUpdateToolSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ToolSettingsInput) => {
      const r = await fetch("/api/tool-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) throw await responseError(r);
    },
    onSuccess: () => invalidateTools(qc),
  });
}

export function useCreateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: McpServerInput) => {
      const r = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) throw await responseError(r);
    },
    onSuccess: () => invalidateTools(qc),
  });
}

export function useUpdateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: McpServerInput;
    }) => {
      const r = await fetch(`/api/mcp-servers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) throw await responseError(r);
    },
    onSuccess: () => invalidateTools(qc),
  });
}

export function useDeleteMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/mcp-servers/${id}`, { method: "DELETE" });
      if (!r.ok) throw await responseError(r);
    },
    onSuccess: () => invalidateTools(qc),
  });
}

export function useTestMcpServer() {
  return useMutation({
    mutationFn: async (input: McpServerInput): Promise<McpServerTestResult> => {
      const r = await fetch("/api/mcp-servers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = (await r.json().catch(() => null)) as
        | McpServerTestResult
        | { error?: string }
        | null;
      if (!r.ok) {
        if (json && "ok" in json) return json;
        throw new Error(json?.error ?? `HTTP ${r.status}`);
      }
      return json as McpServerTestResult;
    },
  });
}

async function responseError(r: Response): Promise<Error> {
  const json = (await r.json().catch(() => ({}))) as { error?: string };
  return new Error(json.error ?? `HTTP ${r.status}`);
}
