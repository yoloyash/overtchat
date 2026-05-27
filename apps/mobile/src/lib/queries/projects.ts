import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "@/lib/queries/keys";

export type ProjectListItem = {
  id: string;
  name: string;
  instructions: string | null;
  updatedAt: number;
};

async function fetchProjects(): Promise<ProjectListItem[]> {
  const res = await authFetch(`${getApiBase()}/api/projects`);
  if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
  const json = (await res.json()) as { projects: ProjectListItem[] };
  return json.projects;
}

async function fetchProject(id: string): Promise<ProjectListItem> {
  const res = await authFetch(`${getApiBase()}/api/projects/${id}`);
  if (!res.ok) throw new Error(`Failed to load project (${res.status})`);
  const json = (await res.json()) as { project: ProjectListItem };
  return json.project;
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: fetchProjects,
    staleTime: 30_000,
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: queryKeys.project(id),
    queryFn: () => fetchProject(id),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      instructions?: string | null;
    }): Promise<ProjectListItem> => {
      const res = await authFetch(`${getApiBase()}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Failed to create (${res.status})`);
      }
      const json = (await res.json()) as { project: ProjectListItem };
      return json.project;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.projects() }),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: {
      name?: string;
      instructions?: string | null;
    }) => {
      const res = await authFetch(`${getApiBase()}/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Failed to update (${res.status})`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects() });
      qc.invalidateQueries({ queryKey: queryKeys.project(id) });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`${getApiBase()}/api/projects/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed to delete (${res.status})`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects() });
      // chat.projectId flips to null on cascade; the chats list shape changes.
      qc.invalidateQueries({ queryKey: queryKeys.chats() });
    },
  });
}
