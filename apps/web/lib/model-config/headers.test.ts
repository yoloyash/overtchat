import { describe, expect, it } from "vitest";
import { i18n } from "@overtchat/shared/i18n";
import { ModelHeadersSchema, modelHeadersFromRows } from "./headers";
import { ModelConfigSchema, ModelDiscoverySchema } from "./schema";

function issue(value: unknown): string | undefined {
  const parsed = ModelHeadersSchema.safeParse(value);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

describe("model request headers", () => {
  it("trims names and values and keeps the placeholder as written", () => {
    expect(
      ModelHeadersSchema.parse({
        " x-opencode-session ": " {{CHAT_ID}} ",
        "X-Team": "search platform",
      }),
    ).toEqual({ "x-opencode-session": "{{CHAT_ID}}", "X-Team": "search platform" });
  });

  it("stores no headers as null", () => {
    expect(ModelHeadersSchema.parse({})).toBeNull();
    expect(ModelHeadersSchema.parse(null)).toBeNull();
  });

  it.each([
    [{ "bad name": "x" }, '"bad name" is not a valid request header name'],
    [{ "x:y": "x" }, '"x:y" is not a valid request header name'],
    [{ "": "x" }, "Request header names cannot be empty"],
    [
      { "Content-Type": "text/plain" },
      "The Content-Type request header is set by the app and cannot be changed",
    ],
    [
      { host: "example.com" },
      "The host request header is set by the app and cannot be changed",
    ],
    [
      { "X-Trace": "a", "x-trace": "b" },
      "The x-trace request header is listed twice",
    ],
    [{ "X-Trace": "  " }, "The X-Trace request header needs a value"],
    [
      { "X-Trace": "line\nbreak" },
      "The X-Trace request header value has characters HTTP headers cannot carry",
    ],
    [
      { "X-Trace": "café" },
      "The X-Trace request header value has characters HTTP headers cannot carry",
    ],
    [
      { "X-Trace": "x".repeat(4097) },
      "The X-Trace request header value is too long",
    ],
    [
      Object.fromEntries(
        Array.from({ length: 33 }, (_, index) => [`X-${index}`, "x"]),
      ),
      "A model can send at most 32 request headers",
    ],
  ])("rejects %j", (value, message) => {
    expect(issue(value)).toBe(message);
  });

  it("lets an administrator replace the authentication header", () => {
    expect(ModelHeadersSchema.parse({ Authorization: "Basic abc" })).toEqual({
      Authorization: "Basic abc",
    });
  });

  it("reads editor rows, ignoring unnamed ones", () => {
    expect(
      modelHeadersFromRows(
        [
          { key: " X-A ", value: " 1 " },
          { key: "", value: "left over" },
        ],
        i18n.t,
      ),
    ).toEqual({ headers: { "X-A": "1" } });
    expect(modelHeadersFromRows([], i18n.t)).toEqual({ headers: null });
  });

  it("reports a name entered twice and other invalid rows", () => {
    expect(
      modelHeadersFromRows(
        [
          { key: "X-A", value: "1" },
          { key: "x-a", value: "2" },
        ],
        i18n.t,
      ),
    ).toEqual({
      headers: null,
      error: "The x-a request header is listed twice",
    });
    expect(modelHeadersFromRows([{ key: "X-A", value: "" }], i18n.t)).toEqual({
      headers: null,
      error: "The X-A request header needs a value",
    });
  });
});

describe("model config headers", () => {
  const model = {
    label: "Gateway",
    providerId: "custom",
    apiFormat: "openai-chat",
    baseUrl: "https://gateway.example/v1",
    model: "gateway-model",
  };

  it("leaves headers out when a client does not send them", () => {
    const parsed = ModelConfigSchema.parse(model);
    expect("headers" in parsed).toBe(false);
  });

  it("clears headers on null and an empty object", () => {
    expect(ModelConfigSchema.parse({ ...model, headers: null }).headers).toBeNull();
    expect(ModelConfigSchema.parse({ ...model, headers: {} }).headers).toBeNull();
  });

  it("reports the header problem on save and on discovery", () => {
    const saved = ModelConfigSchema.safeParse({
      ...model,
      headers: { "Content-Length": "1" },
    });
    expect(saved.error?.issues[0]?.message).toBe(
      "The Content-Length request header is set by the app and cannot be changed",
    );
    const discovery = ModelDiscoverySchema.safeParse({
      providerId: "custom",
      apiFormat: "openai-chat",
      baseUrl: "https://gateway.example/v1",
      headers: { "X-Trace": "" },
    });
    expect(discovery.error?.issues[0]?.message).toBe(
      "The X-Trace request header needs a value",
    );
  });
});
