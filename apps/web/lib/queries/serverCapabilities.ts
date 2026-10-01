"use client";

import { apiError } from "@overtchat/shared";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { VoiceCapability } from "@overtchat/shared";
import type {
  AdminServerCapability,
  ServerCapabilityInput,
} from "@/lib/capabilities/schema";
import { serverCapabilityKeys } from "@/lib/queries/keys";
import { apiUrl } from "@/lib/api-url";

export interface AdminServicesSnapshot {
  capabilities: AdminServerCapability[];
  voice: VoiceCapability;
}

export const serverCapabilitiesQuery = queryOptions({
  queryKey: serverCapabilityKeys.list(),
  queryFn: async (): Promise<AdminServicesSnapshot> => {
    const response = await fetch(apiUrl("/api/server-capabilities"));
    if (!response.ok) throw apiError(response.status, await response.json().catch(() => null), "Could not load server services.");
    return (await response.json()) as AdminServicesSnapshot;
  },
});

export function useServerCapabilities() {
  return useQuery(serverCapabilitiesQuery);
}

export function useUpdateServerCapability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ServerCapabilityInput) => {
      const response = await fetch(apiUrl(`/api/server-capabilities/${input.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await response.json().catch(() => ({}))) as {
        capability?: AdminServerCapability;
        voice?: VoiceCapability;
        error?: string;
      };
      if (!response.ok || !body.capability || !body.voice) {
        throw apiError(response.status, body, "Could not complete the service request.");
      }
      return { capability: body.capability, voice: body.voice };
    },
    onSuccess: ({ capability, voice }) => {
      queryClient.setQueryData<AdminServicesSnapshot>(
        serverCapabilityKeys.list(),
        (current) =>
          current
            ? {
                capabilities: current.capabilities.map((item) =>
                  item.id === capability.id ? capability : item,
                ),
                voice,
              }
            : current,
      );
    },
  });
}

export function useTestServerCapability() {
  return useMutation({
    mutationFn: async (
      input: ServerCapabilityInput,
    ): Promise<{ message: string }> => {
      const response = await fetch(apiUrl(`/api/server-capabilities/${input.id}/test`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok || !body.message) {
        throw apiError(
          response.status,
          body,
          "Could not connect to the provider.",
          input.id === "stt" || input.id === "tts" ? input.id : undefined,
        );
      }
      return { message: body.message };
    },
  });
}
