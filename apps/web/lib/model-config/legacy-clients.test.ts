import { describe, expect, it } from "vitest";
import { CLIENT_HEADER } from "@overtchat/shared";
import type { AdminModelConfig } from "@overtchat/shared/admin-settings";
import {
  adminModelConfigForClient,
  restoreNewerProvider,
} from "./legacy-clients";
import type { ModelConfigInput } from "./schema";

const legacyRequest = new Request("http://server.test/api/model-configs");
const currentRequest = new Request("http://server.test/api/model-configs", {
  headers: { [CLIENT_HEADER]: "mobile/1.20.1" },
});

const openRouter = {
  id: "router",
  providerId: "openrouter",
  displayProvider: "OpenRouter",
  apiFormat: "auto",
  baseUrl: "https://openrouter.ai/api/v1",
} as AdminModelConfig;

function input(overrides: Partial<ModelConfigInput>): ModelConfigInput {
  return {
    providerId: "custom",
    apiFormat: "openai-chat",
    baseUrl: "https://openrouter.ai/api/v1",
    ...overrides,
  } as ModelConfigInput;
}

describe("admin model configs for older clients", () => {
  it("presents a newer provider as a custom Chat Completions endpoint", () => {
    expect(adminModelConfigForClient(legacyRequest, openRouter)).toEqual({
      ...openRouter,
      providerId: "custom",
      apiFormat: "openai-chat",
    });
  });

  it("returns real provider IDs to clients that send the header", () => {
    expect(adminModelConfigForClient(currentRequest, openRouter)).toBe(
      openRouter,
    );
  });

  it("leaves providers older clients know unchanged", () => {
    const deepSeek = {
      ...openRouter,
      providerId: "deepseek",
    } as AdminModelConfig;
    expect(adminModelConfigForClient(legacyRequest, deepSeek)).toBe(deepSeek);
  });
});

describe("saves from older clients", () => {
  it("keeps the stored newer provider when the custom view is saved unchanged", () => {
    expect(
      restoreNewerProvider(legacyRequest, input({ label: "Renamed" }), openRouter),
    ).toMatchObject({
      label: "Renamed",
      providerId: "openrouter",
      apiFormat: "auto",
    });
  });

  it.each([
    ["a changed endpoint", input({ baseUrl: "http://localhost:8000/v1" })],
    ["another API format", input({ apiFormat: "anthropic-messages" })],
    ["another provider", input({ providerId: "openai", apiFormat: "auto" })],
  ])("accepts %s as the administrator's choice", (_name, body) => {
    expect(restoreNewerProvider(legacyRequest, body, openRouter)).toBe(body);
  });

  it("accepts custom from clients that send the header", () => {
    const body = input({});
    expect(restoreNewerProvider(currentRequest, body, openRouter)).toBe(body);
  });

  it("does not change rows stored with a provider older clients know", () => {
    const body = input({});
    expect(
      restoreNewerProvider(legacyRequest, body, {
        providerId: "custom",
        baseUrl: body.baseUrl,
      }),
    ).toBe(body);
  });
});
