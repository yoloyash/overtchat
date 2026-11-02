import { describe, expect, it } from "vitest";
import {
  CloudError,
  checkNameAvailability,
  claimName,
  fetchAccount,
  linkServer,
  requestDeviceCode,
  signOut,
  waitForApproval,
  type DeviceAuthorization,
} from "./cloud.js";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function server(responses: Array<[number, unknown]>) {
  const calls: Call[] = [];
  const fetch = (async (url: URL, init: RequestInit) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const [status, body] = responses.shift() ?? [500, {}];
    return Response.json(body, { status });
  }) as unknown as typeof globalThis.fetch;
  const slept: number[] = [];
  const sleep = async (milliseconds: number) => {
    slept.push(milliseconds);
  };
  return { calls, slept, options: { baseUrl: "https://account.example", fetch, sleep } };
}

const authorization: DeviceAuthorization = {
  deviceCode: "device",
  userCode: "ABCDEFGH",
  verificationUri: "https://account.example/device",
  verificationUriComplete: "https://account.example/device?user_code=ABCDEFGH",
  expiresIn: 600,
  interval: 5,
};

describe("OvertChat Cloud client", () => {
  it("starts the device flow as the CLI client", async () => {
    const { calls, options } = server([
      [200, {
        device_code: "device",
        user_code: "ABCDEFGH",
        verification_uri: "https://account.example/device",
        verification_uri_complete: "https://account.example/device?user_code=ABCDEFGH",
        expires_in: 600,
        interval: 5,
      }],
    ]);
    expect(await requestDeviceCode(options)).toEqual(authorization);
    expect(calls[0]).toMatchObject({
      url: "https://account.example/api/auth/device/code",
      method: "POST",
      body: { client_id: "overtchat-cli" },
    });
  });

  it("polls at the server's pace until the code is approved", async () => {
    const { calls, slept, options } = server([
      [400, { error: "authorization_pending" }],
      [400, { error: "slow_down" }],
      [200, { access_token: "session-token", token_type: "Bearer" }],
    ]);
    expect(await waitForApproval(authorization, options)).toBe("session-token");
    expect(slept).toEqual([5000, 5000, 10000]);
    expect(calls[0]?.body).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "device",
      client_id: "overtchat-cli",
    });
  });

  it("stops when the code is denied or expires", async () => {
    const denied = server([[400, { error: "access_denied" }]]);
    await expect(waitForApproval(authorization, denied.options)).rejects.toMatchObject({ code: "access_denied" });
    const expired = server([[400, { error: "expired_token" }]]);
    await expect(waitForApproval(authorization, expired.options)).rejects.toMatchObject({ code: "expired_token" });
  });

  it("claims and links with the session as a bearer token", async () => {
    const instance = { id: "i", name: "smiths", hostname: "smiths.overtchat.app", plan: "founder", disabled: false };
    const { calls, options } = server([
      [200, { account: { email: "a@example.com" }, instance: null, spots: { remaining: 3, capacity: 20 } }],
      [201, { instance }],
      [200, {
        instance,
        credential: "oc_credential",
        relay: { host: "relay.overtchat.app", port: 443, serverName: "relay.overtchat.app", caPem: "ca" },
      }],
    ]);
    expect(await fetchAccount("token", options)).toEqual({
      email: "a@example.com",
      instance: null,
      spots: { remaining: 3, capacity: 20 },
    });
    expect(await claimName("token", "smiths", options)).toEqual(instance);
    expect(await linkServer("token", options)).toEqual({
      instance,
      credential: "oc_credential",
      relay: { host: "relay.overtchat.app", port: 443, serverName: "relay.overtchat.app", caPem: "ca" },
    });
    expect(calls.map((call) => call.headers.authorization)).toEqual(["Bearer token", "Bearer token", "Bearer token"]);
    expect(calls[1]).toMatchObject({ url: "https://account.example/api/instance", method: "POST", body: { name: "smiths" } });
  });

  it("explains why a name or link was refused", async () => {
    const { options } = server([
      [200, { available: false, reason: "That name is reserved." }],
      [409, { error: "All founder spots are taken.", code: "full" }],
      [200, { credential: "oc_credential" }],
    ]);
    expect(await checkNameAvailability("token", "www", options)).toEqual({
      available: false,
      reason: "That name is reserved.",
    });
    await expect(claimName("token", "smiths", options)).rejects.toMatchObject({ code: "full" });
    await expect(linkServer("token", options)).rejects.toBeInstanceOf(CloudError);
  });

  it("reports an unreachable service plainly and ignores sign-out failures", async () => {
    const options = {
      baseUrl: "https://account.example",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    };
    await expect(requestDeviceCode(options)).rejects.toThrow("Could not reach OvertChat Cloud");
    await expect(signOut("token", options)).resolves.toBeUndefined();
  });
});
