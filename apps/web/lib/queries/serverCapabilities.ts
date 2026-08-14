"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminServerCapability,
  ServerCapabilityInput,
} from "@/lib/capabilities/schema";
import { serverCapabilityKeys } from "@/lib/queries/keys";

export function useServerCapabilities() {
  return useQuery({
    queryKey: serverCapabilityKeys.list(),
    queryFn: async (): Promise<AdminServerCapability[]> => {
      const response = await fetch("/api/server-capabilities");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as {
        capabilities: AdminServerCapability[];
      };
      return body.capabilities;
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
        error?: string;
      };
      if (!response.ok || !body.capability) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      return body.capability;
    },
    onSuccess: (capability) => {
      queryClient.setQueryData<AdminServerCapability[]>(
        serverCapabilityKeys.list(),
        (current) =>
          current?.map((item) =>
            item.id === capability.id ? capability : item,
          ),
      );
    },
  });
}
