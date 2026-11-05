"use client";

import { apiError } from "@overtchat/shared";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiUrl } from "@/lib/api-url";
import type {
  Integration,
  IntegrationId,
  IntegrationOauthClient,
  IntegrationOauthClientInput,
  IntegrationProvider,
} from "@/lib/integrations/schema";
import { integrationKeys } from "@/lib/queries/keys";

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return apiError(
    response.status,
    body,
    "Could not complete the request. Please try again.",
  );
}

export const integrationsQuery = queryOptions({
  queryKey: integrationKeys.list(),
  queryFn: async (): Promise<Integration[]> => {
    const response = await fetch(apiUrl("/api/integrations"));
    if (!response.ok) throw await responseError(response);
    return ((await response.json()) as { integrations: Integration[] })
      .integrations;
  },
});

export function useIntegrations() {
  return useQuery(integrationsQuery);
}

export function integrationOauthClientQuery(provider: IntegrationProvider) {
  return queryOptions({
    queryKey: integrationKeys.oauthClient(provider),
    queryFn: async (): Promise<IntegrationOauthClient> => {
      const response = await fetch(
        apiUrl(`/api/integration-oauth-clients/${provider}`),
      );
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as { client: IntegrationOauthClient })
        .client;
    },
  });
}

export function useIntegrationOauthClient(
  provider: IntegrationProvider,
  enabled: boolean,
) {
  return useQuery({ ...integrationOauthClientQuery(provider), enabled });
}

export function useSaveIntegrationOauthClient(provider: IntegrationProvider) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: IntegrationOauthClientInput) => {
      const response = await fetch(
        apiUrl(`/api/integration-oauth-clients/${provider}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) throw await responseError(response);
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: integrationKeys.all() }),
  });
}

export function useDeleteIntegrationOauthClient(provider: IntegrationProvider) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await fetch(
        apiUrl(`/api/integration-oauth-clients/${provider}`),
        { method: "DELETE" },
      );
      if (!response.ok) throw await responseError(response);
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: integrationKeys.all() }),
  });
}

/**
 * Starts a sign-in and resolves to the provider page the user approves it on.
 * Each call replaces the user's pending sign-in for this integration.
 */
export async function startIntegrationAuthorization(
  id: IntegrationId,
): Promise<string> {
  const response = await fetch(apiUrl(`/api/integrations/${id}/authorization`), {
    method: "POST",
  });
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { url: string }).url;
}

function storeIntegration(
  client: ReturnType<typeof useQueryClient>,
  integration: Integration,
) {
  client.setQueryData<Integration[]>(integrationKeys.list(), (current) =>
    current?.map((item) => (item.id === integration.id ? integration : item)),
  );
}

export function useConnectIntegration(id: IntegrationId) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (redirectUrl: string): Promise<Integration> => {
      const response = await fetch(
        apiUrl(`/api/integrations/${id}/connection`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ redirectUrl }),
        },
      );
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as { integration: Integration })
        .integration;
    },
    onSuccess: (integration) => storeIntegration(client, integration),
  });
}

export function useSetIntegrationAlwaysOn(id: IntegrationId) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (alwaysOn: boolean): Promise<Integration> => {
      const response = await fetch(
        apiUrl(`/api/integrations/${id}/connection`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alwaysOn }),
        },
      );
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as { integration: Integration })
        .integration;
    },
    onSuccess: (integration) => storeIntegration(client, integration),
  });
}

export function useDisconnectIntegration(id: IntegrationId) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await fetch(
        apiUrl(`/api/integrations/${id}/connection`),
        { method: "DELETE" },
      );
      if (!response.ok) throw await responseError(response);
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: integrationKeys.list() }),
  });
}
