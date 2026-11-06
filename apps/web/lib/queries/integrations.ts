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
 * Starts a sign-in for the chosen integrations and resolves to the provider
 * page the user approves it on. Each call replaces the user's pending sign-in.
 */
export async function startIntegrationAuthorization(
  provider: IntegrationProvider,
  integrations: readonly IntegrationId[],
): Promise<string> {
  const response = await fetch(
    apiUrl(`/api/integration-accounts/${provider}/authorization`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ integrations }),
    },
  );
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { url: string }).url;
}

/** Finishes a sign-in and resolves to the provider's integrations. */
export function useConnectIntegrationAccount(provider: IntegrationProvider) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (redirectUrl: string): Promise<Integration[]> => {
      const response = await fetch(
        apiUrl(`/api/integration-accounts/${provider}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ redirectUrl }),
        },
      );
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as { integrations: Integration[] })
        .integrations;
    },
    onSuccess: (integrations) =>
      client.setQueryData<Integration[]>(integrationKeys.list(), (current) =>
        current?.map(
          (item) => integrations.find(({ id }) => id === item.id) ?? item,
        ),
      ),
  });
}

export function useSetIntegrationAlwaysOn(id: IntegrationId) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (alwaysOn: boolean): Promise<Integration> => {
      const response = await fetch(apiUrl(`/api/integrations/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alwaysOn }),
      });
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as { integration: Integration })
        .integration;
    },
    onSuccess: (integration) =>
      client.setQueryData<Integration[]>(integrationKeys.list(), (current) =>
        current?.map((item) =>
          item.id === integration.id ? integration : item,
        ),
      ),
  });
}

/** Sends a draft a model saved in the user's Gmail. */
export function useSendGmailDraft() {
  return useMutation({
    mutationFn: async (
      draftId: string,
    ): Promise<{ at: string; threadId: string | null }> => {
      const response = await fetch(
        apiUrl(`/api/integrations/gmail/drafts/${encodeURIComponent(draftId)}/send`),
        { method: "POST" },
      );
      if (!response.ok) throw await responseError(response);
      return (
        (await response.json()) as {
          sent: { at: string; threadId: string | null };
        }
      ).sent;
    },
  });
}

export function useDisconnectIntegrationAccount(provider: IntegrationProvider) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await fetch(
        apiUrl(`/api/integration-accounts/${provider}`),
        { method: "DELETE" },
      );
      if (!response.ok) throw await responseError(response);
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: integrationKeys.list() }),
  });
}
