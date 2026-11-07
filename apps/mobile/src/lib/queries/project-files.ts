import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, getApiBase, uploadFile } from "@/lib/api";
import type { AttachmentCategory } from "@/lib/chat/attachments";
import { queryKeys } from "@/lib/queries/keys";

/** A project holds up to this many reference files, matching the server. */
export const MAX_PROJECT_FILES = 50;

export type ProjectFileItem = {
  uploadId: string;
  url: string;
  filename: string;
  mediaType: string;
  category: Exclude<AttachmentCategory, "image">;
  size: number;
  pageCount: number | null;
  truncated: boolean;
  addedAt: number;
  /** The chat that produced the file, when it was saved from one. */
  sourceChat: { id: string; title: string | null } | null;
};

export type PickedProjectFile = { uri: string; name: string; type: string };

async function readError(res: Response, fallback: string): Promise<string> {
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return json.error ?? fallback;
}

async function fetchProjectFiles(projectId: string): Promise<ProjectFileItem[]> {
  const res = await authFetch(`${getApiBase()}/api/projects/${projectId}/files`);
  if (!res.ok) throw new Error(`Failed to load project files (${res.status})`);
  const json = (await res.json()) as { files: ProjectFileItem[] };
  return json.files;
}

/** Idle without a project, such as while the screen is still loading. */
export function useProjectFiles(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.projectFiles(projectId ?? ""),
    enabled: Boolean(projectId),
    queryFn: () => fetchProjectFiles(projectId ?? ""),
    staleTime: 30_000,
  });
}

/** Links an upload (see `uploadFile`) to the project. */
export async function linkProjectFile(
  projectId: string,
  uploadId: string,
): Promise<ProjectFileItem> {
  const res = await authFetch(`${getApiBase()}/api/projects/${projectId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId }),
  });
  if (!res.ok) throw new Error(await readError(res, `HTTP ${res.status}`));
  const json = (await res.json()) as { file: ProjectFileItem };
  return json.file;
}

/** Uploads one picked file through the attachment route, then links it. */
export function useAddProjectFile(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: PickedProjectFile): Promise<ProjectFileItem> => {
      const uploaded = await uploadFile(file);
      const uploadId = uploaded.url.slice(uploaded.url.lastIndexOf("/") + 1);
      return linkProjectFile(projectId, uploadId);
    },
    onSuccess: (file) => {
      queryClient.setQueryData<ProjectFileItem[]>(
        queryKeys.projectFiles(projectId),
        (prev) =>
          prev && !prev.some((item) => item.uploadId === file.uploadId)
            ? [...prev, file]
            : prev,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectFiles(projectId) });
    },
  });
}

export function useRemoveProjectFile(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (uploadId: string) => {
      const res = await authFetch(
        `${getApiBase()}/api/projects/${projectId}/files/${uploadId}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (_, uploadId) => {
      queryClient.setQueryData<ProjectFileItem[]>(
        queryKeys.projectFiles(projectId),
        (prev) => prev?.filter((item) => item.uploadId !== uploadId),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectFiles(projectId) });
    },
  });
}
