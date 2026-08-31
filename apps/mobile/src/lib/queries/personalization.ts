import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Memory,
  MemoryInput,
  Personalization,
  PersonalizationInput,
  PersonalizationSnapshot,
} from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `Request failed (${response.status})`);
}

export function usePersonalization() {
  return useQuery({
    queryKey: queryKeys.personalization(),
    queryFn: async (): Promise<PersonalizationSnapshot> => {
      const response = await authFetch(`${getApiBase()}/api/personalization`);
      if (!response.ok) throw await responseError(response);
      return response.json() as Promise<PersonalizationSnapshot>;
    },
  });
}

export function useUpdatePersonalization() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: PersonalizationInput): Promise<Personalization> => {
      const response = await authFetch(`${getApiBase()}/api/personalization`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw await responseError(response);
      return ((await response.json()) as { personalization: Personalization })
        .personalization;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.personalization() }),
  });
}

function useMemoryMutation<TInput>(
  mutationFn: (input: TInput) => Promise<Memory | void>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.personalization() }),
  });
}

export function useCreateMemory() {
  return useMemoryMutation(async (input: MemoryInput) => {
    const response = await authFetch(`${getApiBase()}/api/memories`, {
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
      const response = await authFetch(`${getApiBase()}/api/memories/${id}`, {
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
    const response = await authFetch(`${getApiBase()}/api/memories/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) throw await responseError(response);
  });
}

export function useClearMemories() {
  return useMemoryMutation(async () => {
    const response = await authFetch(`${getApiBase()}/api/memories`, {
      method: "DELETE",
    });
    if (!response.ok) throw await responseError(response);
  });
}
