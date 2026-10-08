import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiError } from "@overtchat/shared";
import type { AdminModelConfig } from "@overtchat/shared/admin-settings";
import { getAuthClient } from "@/lib/auth/client";
import { authFetch, getApiBase } from "@/lib/api";
import { queryKeys } from "./keys";

export async function settingsRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await authFetch(`${getApiBase()}/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (response.status === 204 && response.ok) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw apiError(
      response.status,
      data,
      response.status === 403
        ? "Administrator access is required."
        : response.status === 404
          ? "This setting is unavailable. Check your server version."
          : data?.code === "not_installed"
            ? "This service is not installed. Run overtchat setup on the server."
            : "Couldn’t complete the request.",
      path.startsWith("/server-capabilities/tts")
        ? "tts"
        : path.startsWith("/server-capabilities/stt")
          ? "stt"
          : undefined,
    );
  return data as T;
}
export function useSettingsQuery<T>(path: string, admin = false) {
  const session = getAuthClient().useSession();
  return useQuery({
    queryKey: queryKeys.settings(path),
    queryFn: () => settingsRequest<T>(path),
    enabled: !!session.data && (!admin || session.data.user.role === "admin"),
    gcTime: admin ? 0 : 5 * 60_000,
    retry: false,
  });
}
export function useSettingsMutation<T = unknown>() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      method = "PATCH",
      body,
    }: {
      path: string;
      method?: string;
      body?: unknown;
    }) => settingsRequest<T>(path, method, body),
    retry: false,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.settingsRoot() }),
        client.invalidateQueries({ queryKey: queryKeys.modelConfigs() }),
        client.invalidateQueries({ queryKey: queryKeys.capabilities() }),
      ]);
    },
  });
}

export function useReorderSettingsModels() {
  const client = useQueryClient();
  const key = queryKeys.settings("/model-configs?admin=1");
  return useMutation({
    mutationFn: (modelIds: string[]) =>
      settingsRequest("/model-configs/order", "PUT", { modelIds }),
    retry: false,
    onMutate: async (modelIds) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<{
        modelConfigs: AdminModelConfig[];
      }>(key);
      if (previous) {
        const positions = new Map(modelIds.map((id, index) => [id, index]));
        client.setQueryData(key, {
          ...previous,
          modelConfigs: previous.modelConfigs
            .map((model) => ({
              ...model,
              sortOrder: positions.get(model.id) ?? model.sortOrder,
            }))
            .sort((a, b) => a.sortOrder - b.sortOrder),
        });
      }
      return { previous };
    },
    onError: (_error, _modelIds, context) => {
      if (
        context?.previous &&
        client.getQueryCache().find({ queryKey: key, exact: true })
      ) {
        client.setQueryData(key, context.previous);
      }
    },
    onSettled: async () => {
      // Refresh after failures too: another administrator may have changed the list.
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({ queryKey: queryKeys.modelConfigs() }),
      ]);
    },
  });
}
