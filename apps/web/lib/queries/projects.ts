"use client";

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { chatKeys, projectKeys } from "@/lib/queries/keys";
import { apiUrl } from "@/lib/api-url";


export type ProjectListItem = {
  id: string;
  name: string;
  instructions: string | null;
  updatedAt: number;
};

async function fetchProjects(): Promise<ProjectListItem[]> {
  const r = await fetch(apiUrl("/api/projects"));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = (await r.json()) as { projects: ProjectListItem[] };
  return json.projects;
}

/** Null when the project does not exist. */
export async function fetchProject(id: string): Promise<ProjectListItem | null> {
  const r = await fetch(apiUrl(`/api/projects/${id}`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = (await r.json()) as { project: ProjectListItem };
  return json.project;
}

export const projectListQuery = queryOptions({
  queryKey: projectKeys.list(),
  queryFn: fetchProjects,
});

export function projectQuery(id: string) {
  return queryOptions({
    queryKey: projectKeys.detail(id),
    queryFn: async () => {
      const project = await fetchProject(id);
      if (!project) throw new Error("HTTP 404");
      return project;
    },
  });
}

export function useProjects() {
  return useQuery(projectListQuery);
}

export function useProject(id: string) {
  return useQuery(projectQuery(id));
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      instructions?: string | null;
    }): Promise<ProjectListItem> => {
      const r = await fetch(apiUrl("/api/projects"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const json = (await r.json()) as { project: ProjectListItem };
      return json.project;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.list() }),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: {
      name?: string;
      instructions?: string | null;
    }) => {
      const r = await fetch(apiUrl(`/api/projects/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.list() });
      qc.invalidateQueries({ queryKey: projectKeys.detail(id) });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(apiUrl(`/api/projects/${id}`), { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.list() });
      // chat.projectId is set to null on project delete (cascade), so the list shape changes
      qc.invalidateQueries({ queryKey: chatKeys.list() });
    },
  });
}
