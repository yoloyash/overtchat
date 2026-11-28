import { describe, expect, it, vi } from "vitest";
import {
  checkIssuer,
  identityProviderRedirect,
  identityProviderSummary,
  issuerValidation,
  normalizeIssuer,
} from "./identity-provider.js";
import type { InstallationConfig } from "./types.js";

describe("identity provider addresses", () => {
  it("derives the redirect address from the address people open", () => {
    expect(identityProviderRedirect("https://chat.example.com")).toBe(
      "https://chat.example.com/api/auth/callback/oidc",
    );
    expect(identityProviderRedirect("http://192.168.1.20:4718/")).toBe(
      "http://192.168.1.20:4718/api/auth/callback/oidc",
    );
  });

  it("accepts the issuer or its discovery document", () => {
    expect(normalizeIssuer(" https://id.example.com/ ")).toBe(
      "https://id.example.com",
    );
    expect(
      normalizeIssuer(
        "https://id.example.com/realms/home/.well-known/openid-configuration",
      ),
    ).toBe("https://id.example.com/realms/home");
  });

  it("refuses addresses the app's container could not use", () => {
    expect(issuerValidation("https://id.example.com/realms/home")).toBeUndefined();
    expect(issuerValidation("http://192.168.1.5:1411")).toBeUndefined();
    expect(issuerValidation("")).toMatch(/issuer URL/u);
    expect(issuerValidation("id.example.com")).toMatch(/valid URL/u);
    expect(issuerValidation("ftp://id.example.com")).toMatch(/http/u);
    expect(issuerValidation("https://id.example.com/?tenant=1")).toMatch(/\?/u);
    for (const local of [
      "http://localhost:1411",
      "http://127.0.0.1:8081/realms/home",
      "http://[::1]:1411",
    ]) {
      expect(issuerValidation(local)).toMatch(/container/u);
    }
  });
});

describe("reading the provider's configuration", () => {
  const discovery = {
    issuer: "https://id.example.com",
    authorization_endpoint: "https://id.example.com/authorize",
    token_endpoint: "https://id.example.com/token",
  };

  it("asks the discovery address under the issuer", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(discovery));
    expect(await checkIssuer("https://id.example.com/", fetcher)).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(
      "https://id.example.com/.well-known/openid-configuration",
      expect.anything(),
    );
  });

  it("says why a provider couldn't be read", async () => {
    expect(
      await checkIssuer("https://id.example.com", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).toBe("it didn't answer");
    expect(
      await checkIssuer(
        "https://id.example.com",
        async () => new Response("Not found", { status: 404 }),
      ),
    ).toBe("it answered 404");
    expect(
      await checkIssuer(
        "https://id.example.com",
        async () => new Response("<html>", { status: 200 }),
      ),
    ).toBe("the reply isn't an OpenID Connect configuration");
    expect(
      await checkIssuer("https://id.example.com", async () =>
        Response.json({ issuer: "https://id.example.com" }),
      ),
    ).toBe("the reply isn't an OpenID Connect configuration");
  });
});

it("summarizes the choice for the setup review", () => {
  const provider = {
    issuerUrl: "https://id.example.com",
    clientId: "overtchat",
    name: "Pocket ID",
    autoCreateUsers: false,
    disablePasswordLogin: false,
  };
  const config = (identityProvider?: typeof provider) =>
    ({ identityProvider }) as InstallationConfig;
  expect(identityProviderSummary(config())).toBe(
    "Identity provider: set up later",
  );
  expect(identityProviderSummary(config(provider))).toBe(
    "Identity provider: Pocket ID, beside passwords",
  );
  expect(
    identityProviderSummary(config({ ...provider, disablePasswordLogin: true })),
  ).toBe("Identity provider: Pocket ID, passwords off");
});
