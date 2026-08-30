"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { VoiceCapability } from "@overtchat/shared";
import type {
  AdminServerCapability,
  ServerCapabilityInput,
} from "@/lib/capabilities/schema";
import { serverCapabilityKeys } from "@/lib/queries/keys";

export interface AdminServicesSnapshot {
  capabilities: AdminServerCapability[];
  voice: VoiceCapability;
}

export function useServerCapabilities() {
  return useQuery({
    queryKey: serverCapabilityKeys.list(),
    queryFn: async (): Promise<AdminServicesSnapshot> => {
      const response = await fetch("/api/server-capabilities");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as AdminServicesSnapshot;
    },
  });
}

export function useUpdateServerCapability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ServerCapabilityInput) => {
      const response = await fetch(`/api/server-capabilities/${input.id}`, {
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
        throw new Error(body.error ?? `HTTP ${response.status}`);
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
