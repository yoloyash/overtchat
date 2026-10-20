import { apiError } from "@overtchat/shared";
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
      apiError(response.status, body, response.status === 404
        ? "This agent session or workspace is no longer available."
        : "Could not complete the agent request. Please try again.").message,
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
