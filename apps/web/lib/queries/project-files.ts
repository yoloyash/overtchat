"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api-url";
import { projectKeys } from "@/lib/queries/keys";
import type { ProjectFileItem } from "@/lib/project-files";

export type { ProjectFileItem } from "@/lib/project-files";

async function readError(r: Response, fallback: string): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

export function useProjectFiles(projectId: string) {
  return useQuery({
    queryKey: projectKeys.files(projectId),
    queryFn: async (): Promise<ProjectFileItem[]> => {
      const r = await fetch(apiUrl(`/api/projects/${projectId}/files`));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as { files: ProjectFileItem[] };
      return json.files;
    },
  });
}

/** Links an already uploaded file (an upload URL or ID) to the project. */
export async function linkProjectFile(
  projectId: string,
  upload: { uploadId: string; sourceChatId?: string | null },
): Promise<ProjectFileItem> {
  const r = await fetch(apiUrl(`/api/projects/${projectId}/files`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(upload),
  });
  if (!r.ok) throw new Error(await readError(r, `HTTP ${r.status}`));
  const json = (await r.json()) as { file: ProjectFileItem };
  return json.file;
}

/** Uploads one file through the attachment route, then links it. */
export function useAddProjectFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<ProjectFileItem> => {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch(apiUrl("/api/uploads"), { method: "POST", body: form });
      if (!r.ok) throw new Error(await readError(r, `Upload failed (${r.status})`));
      const json = (await r.json()) as { url: string };
      const uploadId = json.url.slice(json.url.lastIndexOf("/") + 1);
      return linkProjectFile(projectId, { uploadId });
    },
    onSuccess: (file) => {
      qc.setQueryData<ProjectFileItem[]>(projectKeys.files(projectId), (prev) =>
        prev && !prev.some((item) => item.uploadId === file.uploadId)
          ? [...prev, file]
          : prev,
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: projectKeys.files(projectId) });
    },
  });
}

/** Removes a file from the project; the upload itself stays. */
export async function unlinkProjectFile(projectId: string, uploadId: string): Promise<void> {
  const r = await fetch(apiUrl(`/api/projects/${projectId}/files/${uploadId}`), {
    method: "DELETE",
  });
  if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
}

export function useRemoveProjectFile(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uploadId: string) => unlinkProjectFile(projectId, uploadId),
    onSuccess: (_, uploadId) => {
      qc.setQueryData<ProjectFileItem[]>(projectKeys.files(projectId), (prev) =>
        prev?.filter((item) => item.uploadId !== uploadId),
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: projectKeys.files(projectId) });
    },
  });
}
