import { authFetch, getApiBase } from "@/lib/api";
import { AgentHttpError } from "./stream";

export async function agentFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await authFetch(`${getApiBase()}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new AgentHttpError(
      body?.error ??
        (response.status === 401
          ? "Your session expired. Sign in again."
          : response.status === 403
            ? "Agent Connections are not available for this account."
            : response.status === 404
              ? "This agent session or workspace is no longer available."
              : `Request failed (${response.status}).`),
      response.status,
    );
  }
  return response;
}

export async function agentJson<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await agentFetch(path, {
    signal,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  return response.json() as Promise<T>;
}
