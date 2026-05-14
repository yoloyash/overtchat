"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { modelConfigKeys } from "@/lib/queries/keys";
import type {
  AdminModelConfig,
  ModelConfigInput,
  PublicModelConfig,
} from "@/lib/config";

export function useModelConfigs() {
  return useQuery({
    queryKey: modelConfigKeys.publicList(),
    queryFn: async (): Promise<PublicModelConfig[]> => {
      const r = await fetch("/api/model-configs");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as { modelConfigs: PublicModelConfig[] };
      return json.modelConfigs;
    },
  });
}

export function useAdminModelConfigs() {
  return useQuery({
    queryKey: modelConfigKeys.adminList(),
    queryFn: async (): Promise<AdminModelConfig[]> => {
      const r = await fetch("/api/model-configs?admin=1");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as { modelConfigs: AdminModelConfig[] };
      return json.modelConfigs;
    },
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: modelConfigKeys.all() });
}

export function useCreateModelConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ModelConfigInput) => {
      const r = await fetch("/api/model-configs", {
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
      const r = await fetch(`/api/model-configs/${id}`, {
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
      const r = await fetch(`/api/model-configs/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => invalidateAll(qc),
  });
}
