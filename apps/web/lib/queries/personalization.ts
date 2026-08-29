"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Memory,
  MemoryInput,
  Personalization,
  PersonalizationInput,
  PersonalizationSnapshot,
} from "@/lib/personalization/schema";
import { personalizationKeys } from "@/lib/queries/keys";

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `HTTP ${response.status}`);
}

export function usePersonalization() {
  return useQuery({
    queryKey: personalizationKeys.detail(),
    queryFn: async (): Promise<PersonalizationSnapshot> => {
      const response = await fetch("/api/personalization");
      if (!response.ok) throw await responseError(response);
      return response.json() as Promise<PersonalizationSnapshot>;
    },
  });
}

export function useUpdatePersonalization() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: PersonalizationInput): Promise<Personalization> => {
      const response = await fetch("/api/personalization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as { personalization: Personalization })
        .personalization;
    },
    onSuccess: (personalization) => {
      client.setQueryData<PersonalizationSnapshot>(
        personalizationKeys.detail(),
        (current) => (current ? { ...current, personalization } : current),
      );
    },
  });
}

function useMemoryMutation<TInput>(
  mutationFn: (input: TInput) => Promise<Memory | void>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: personalizationKeys.all() }),
  });
}

export function useCreateMemory() {
  return useMemoryMutation(async (input: MemoryInput) => {
    const response = await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw await responseError(response);
    return ((await response.json()) as { memory: Memory }).memory;
  });
}

export function useUpdateMemory() {
  return useMemoryMutation(
    async ({ id, input }: { id: string; input: MemoryInput }) => {
      const response = await fetch(`/api/memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as { memory: Memory }).memory;
    },
  );
}

export function useDeleteMemory() {
  return useMemoryMutation(async (id: string) => {
    const response = await fetch(`/api/memories/${id}`, { method: "DELETE" });
    if (!response.ok) throw await responseError(response);
  });
}

export function useClearMemories() {
  return useMemoryMutation(async () => {
    const response = await fetch("/api/memories", { method: "DELETE" });
    if (!response.ok) throw await responseError(response);
  });
}
