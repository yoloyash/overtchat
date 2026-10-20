"use client";

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { modelConfigKeys } from "@/lib/queries/keys";
import type {
  AdminModelConfig,
  ModelConfigInput,
  PublicModelConfig,
} from "@/lib/model-config/schema";
import { apiUrl } from "@/lib/api-url";

export function useModelConfigs() {
  return useQuery({
    queryKey: modelConfigKeys.publicList(),
    queryFn: async (): Promise<PublicModelConfig[]> => {
      const r = await fetch(apiUrl("/api/model-configs"));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as { modelConfigs: PublicModelConfig[] };
      return json.modelConfigs;
    },
  });
}

export const adminModelConfigsQuery = queryOptions({
  queryKey: modelConfigKeys.adminList(),
  queryFn: async (): Promise<AdminModelConfig[]> => {
    const r = await fetch(apiUrl("/api/model-configs?admin=1"));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = (await r.json()) as { modelConfigs: AdminModelConfig[] };
    return json.modelConfigs;
  },
});

export function useAdminModelConfigs() {
  return useQuery(adminModelConfigsQuery);
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: modelConfigKeys.all() });
  qc.invalidateQueries({ queryKey: ["capabilities", "public"] });
}

export function useCreateModelConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ModelConfigInput) => {
      const r = await fetch(apiUrl("/api/model-configs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpdateModelConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: ModelConfigInput;
    }) => {
      const r = await fetch(apiUrl(`/api/model-configs/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteModelConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(apiUrl(`/api/model-configs/${id}`), { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useReorderModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modelIds: string[]) => {
      const response = await fetch(apiUrl("/api/model-configs/order"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelIds }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't save model order");
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: modelConfigKeys.all() }),
  });
}

export function useSetTaskModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modelConfigId: string | null) => {
      const r = await fetch(apiUrl("/api/model-configs/task-model"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelConfigId }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
    },
    onSuccess: (_data, modelConfigId) => {
      qc.setQueryData<AdminModelConfig[]>(
        modelConfigKeys.adminList(),
        (current) =>
          current?.map((model) => ({
            ...model,
            taskModel: model.id === modelConfigId,
          })),
      );
      invalidateAll(qc);
    },
  });
}

export type ModelHealth =
  | { ok: true; elapsedMs: number }
  | { ok: false; error: string; elapsedMs: number };

export function useModelHealth(id: string) {
  return useQuery({
    queryKey: modelConfigKeys.health(id),
    enabled: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<ModelHealth> => {
      const r = await fetch(apiUrl(`/api/model-configs/${id}/health`), {
        method: "POST",
      });
      if (!r.ok) {
        return {
          ok: false,
          error: `HTTP ${r.status}`,
          elapsedMs: 0,
        };
      }
      return (await r.json()) as ModelHealth;
    },
  });
}
