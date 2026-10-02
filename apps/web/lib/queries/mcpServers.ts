"use client";

import { apiError } from "@overtchat/shared";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AvailableMcpServer,
  McpServer,
  McpServerHealth,
  McpServerInput,
} from "@/lib/mcp/schema";
import { mcpServerKeys } from "@/lib/queries/keys";
import { apiUrl } from "@/lib/api-url";

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return apiError(response.status, body, "Could not complete the request. Please try again.");
}

export const mcpServersQuery = queryOptions({
  queryKey: mcpServerKeys.adminList(),
  queryFn: async (): Promise<McpServer[]> => {
    const response = await fetch(apiUrl("/api/mcp-servers"));
    if (!response.ok) throw await responseError(response);
    const body = (await response.json()) as { mcpServers: McpServer[] };
    return body.mcpServers;
  },
});

export const availableMcpServersQuery = queryOptions({
  queryKey: mcpServerKeys.availableList(),
  queryFn: async (): Promise<AvailableMcpServer[]> => {
    const response = await fetch(apiUrl("/api/mcp-server-preferences"));
    if (!response.ok) throw await responseError(response);
    const body = (await response.json()) as {
      mcpServers: AvailableMcpServer[];
    };
    return body.mcpServers;
  },
});

export function useMcpServers() {
  return useQuery(mcpServersQuery);
}

export function useAvailableMcpServers() {
  return useQuery(availableMcpServersQuery);
}

export function useMcpServerHealth(id: string) {
  return useQuery({
    queryKey: mcpServerKeys.health(id),
    enabled: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<McpServerHealth> => {
      const response = await fetch(apiUrl(`/api/mcp-servers/${id}/health`), {
        method: "POST",
      });
      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}`,
          elapsedMs: 0,
        };
      }
      return (await response.json()) as McpServerHealth;
    },
  });
}

function invalidateMcpServers(client: ReturnType<typeof useQueryClient>) {
  client.invalidateQueries({ queryKey: mcpServerKeys.all() });
}

export function useCreateMcpServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: McpServerInput) => {
      const response = await fetch(apiUrl("/api/mcp-servers"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as { mcpServer: McpServer }).mcpServer;
    },
    onSuccess: () => invalidateMcpServers(client),
  });
}

export function useUpdateMcpServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: McpServerInput }) => {
      const response = await fetch(apiUrl(`/api/mcp-servers/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as { mcpServer: McpServer }).mcpServer;
    },
    onSuccess: () => invalidateMcpServers(client),
  });
}

export function useDeleteMcpServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(apiUrl(`/api/mcp-servers/${id}`), {
        method: "DELETE",
      });
      if (!response.ok) throw await responseError(response);
    },
    onSuccess: () => invalidateMcpServers(client),
  });
}

export function useSetMcpServerPreference() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const response = await fetch(apiUrl(`/api/mcp-server-preferences/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as { mcpServer: AvailableMcpServer })
        .mcpServer;
    },
    onSuccess: (server) => {
      client.setQueryData<AvailableMcpServer[]>(
        mcpServerKeys.availableList(),
        (current) =>
          current?.map((item) => (item.id === server.id ? server : item)),
      );
    },
  });
}
