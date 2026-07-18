import "server-only";

const MODEL_LIST_TIMEOUT_MS = 10_000;
const MAX_MODEL_LIST_PAGES = 20;

interface OpenAIModelList {
  data?: Array<{ id?: string }>;
}

interface AnthropicModelList extends OpenAIModelList {
  has_more?: boolean;
  last_id?: string | null;
}

interface GoogleModelList {
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function appendPath(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, "")}`;
}

export async function listOpenAIModels(
  baseUrl: string,
  apiKey: string | null | undefined,
): Promise<string[]> {
  const json = await fetchJson<OpenAIModelList>(appendPath(baseUrl, "models"), {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  return normalizeModelIds(json.data?.map((model) => model.id));
}

export async function listAnthropicModels(
  baseUrl: string,
  apiKey: string | null | undefined,
): Promise<string[]> {
  const modelIds: Array<string | undefined> = [];
  let afterId: string | null = null;

  for (let page = 0; page < MAX_MODEL_LIST_PAGES; page += 1) {
    const url = new URL(appendPath(baseUrl, "models"));
    url.searchParams.set("limit", "1000");
    if (afterId) url.searchParams.set("after_id", afterId);

    const json = await fetchJson<AnthropicModelList>(url.toString(), {
      headers: {
        "anthropic-version": "2023-06-01",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
    });
    modelIds.push(...(json.data?.map((model) => model.id) ?? []));

    if (!json.has_more || !json.last_id || json.last_id === afterId) break;
    afterId = json.last_id;
  }

  return normalizeModelIds(modelIds);
}

export async function listGoogleModels(
  baseUrl: string,
  apiKey: string | null | undefined,
): Promise<string[]> {
  const modelIds: Array<string | undefined> = [];
  let pageToken: string | null = null;

  for (let page = 0; page < MAX_MODEL_LIST_PAGES; page += 1) {
    const url = new URL(appendPath(baseUrl, "models"));
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const json = await fetchJson<GoogleModelList>(url.toString(), {
      headers: apiKey ? { "x-goog-api-key": apiKey } : {},
    });
    modelIds.push(
      ...(json.models ?? [])
        .filter((model) =>
          model.supportedGenerationMethods?.includes("generateContent"),
        )
        .map((model) => model.name?.replace(/^models\//, "")),
    );

    if (!json.nextPageToken || json.nextPageToken === pageToken) break;
    pageToken = json.nextPageToken;
  }

  return normalizeModelIds(modelIds);
}

async function fetchJson<T>(
  url: string,
  init: Omit<RequestInit, "signal">,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    const suffix = detail ? `: ${detail.slice(0, 500)}` : "";
    throw new Error(
      `Upstream ${response.status} ${response.statusText}${suffix}`,
    );
  }
  return (await response.json()) as T;
}

function normalizeModelIds(
  modelIds: Array<string | undefined> | undefined,
): string[] {
  return [...new Set((modelIds ?? []).filter((id): id is string => Boolean(id)))]
    .map((id) => id.replace(/^models\//, ""))
    .sort();
}
