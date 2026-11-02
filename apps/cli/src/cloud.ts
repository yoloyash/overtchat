// Client for the OvertChat Cloud account service. The CLI signs in with the
// OAuth device authorization flow (RFC 8628), then claims a name and links
// this server, which returns the relay connection and a new credential.

export const DEFAULT_CLOUD_URL = "https://account.overtchat.com";
const CLIENT_ID = "overtchat-cli";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export function cloudUrl(environment = process.env): string {
  return environment.OVERTCHAT_CLOUD_URL?.trim() || DEFAULT_CLOUD_URL;
}

export class CloudError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CloudError";
  }
}

export type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type CloudInstance = {
  id: string;
  name: string;
  hostname: string;
  plan: string;
  disabled: boolean;
};

export type CloudAccount = {
  email: string;
  instance: CloudInstance | null;
  spots: { remaining: number; capacity: number };
};

export type CloudLink = {
  instance: CloudInstance;
  credential: string;
  relay: { host: string; port: number; serverName: string; caPem: string };
};

export type CloudClientOptions = {
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

function client(options: CloudClientOptions) {
  const baseUrl = options.baseUrl ?? cloudUrl();
  const fetchImpl = options.fetch ?? fetch;
  return async function request(
    path: string,
    init: { method?: string; token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, baseUrl), {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new CloudError(`Could not reach OvertChat Cloud at ${baseUrl}. Check this server's internet connection.`);
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body };
  };
}

function message(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === "string" && body.error ? body.error : fallback;
}

export async function requestDeviceCode(options: CloudClientOptions = {}): Promise<DeviceAuthorization> {
  const { status, body } = await client(options)("/api/auth/device/code", {
    method: "POST",
    body: { client_id: CLIENT_ID },
  });
  if (status !== 200 || typeof body.device_code !== "string" || typeof body.user_code !== "string") {
    throw new CloudError("OvertChat Cloud could not start sign-in. Try again later.");
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: String(body.verification_uri),
    verificationUriComplete: String(body.verification_uri_complete ?? body.verification_uri),
    expiresIn: Number(body.expires_in) || 600,
    interval: Number(body.interval) || 5,
  };
}

/** Polls until the code is approved in a browser; returns a session token. */
export async function waitForApproval(
  authorization: DeviceAuthorization,
  options: CloudClientOptions = {},
): Promise<string> {
  const request = client(options);
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let interval = authorization.interval;
  const deadline = Date.now() + authorization.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const { status, body } = await request("/api/auth/device/token", {
      method: "POST",
      body: { grant_type: DEVICE_GRANT, device_code: authorization.deviceCode, client_id: CLIENT_ID },
    });
    if (status === 200 && typeof body.access_token === "string") return body.access_token;
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (body.error === "access_denied") throw new CloudError("Linking was canceled in the browser.", "access_denied");
    if (body.error === "expired_token") break;
    throw new CloudError(message(body, "OvertChat Cloud rejected the sign-in."));
  }
  throw new CloudError("The sign-in code expired. Start again to get a new code.", "expired_token");
}

export async function fetchAccount(token: string, options: CloudClientOptions = {}): Promise<CloudAccount> {
  const { status, body } = await client(options)("/api/instance", { token });
  if (status !== 200) throw new CloudError(message(body, "Could not read your OvertChat Cloud account."));
  const account = body.account as { email?: unknown } | undefined;
  return {
    email: String(account?.email ?? ""),
    instance: (body.instance as CloudInstance | null) ?? null,
    spots: body.spots as CloudAccount["spots"],
  };
}

/** Signed in, so a name held for this account after it was deleted shows as available. */
export async function checkNameAvailability(
  token: string,
  name: string,
  options: CloudClientOptions = {},
): Promise<{ available: true; name: string } | { available: false; reason: string }> {
  const { body } = await client(options)(`/api/names/${encodeURIComponent(name)}`, { token });
  if (body.available === true && typeof body.name === "string") return { available: true, name: body.name };
  return { available: false, reason: message({ error: body.reason }, "That name is not available.") };
}

export async function claimName(token: string, name: string, options: CloudClientOptions = {}): Promise<CloudInstance> {
  const { status, body } = await client(options)("/api/instance", { method: "POST", token, body: { name } });
  if (status !== 201) throw new CloudError(message(body, "Could not claim that name."), String(body.code ?? ""));
  return body.instance as CloudInstance;
}

/** Issues a new credential for this server, which unlinks any previous one. */
export async function linkServer(token: string, options: CloudClientOptions = {}): Promise<CloudLink> {
  const { status, body } = await client(options)("/api/instance/link", { method: "POST", token });
  const relay = body.relay as Partial<CloudLink["relay"]> | undefined;
  if (
    status !== 200 ||
    typeof body.credential !== "string" ||
    typeof relay?.host !== "string" ||
    typeof relay.port !== "number" ||
    typeof relay.serverName !== "string" ||
    typeof relay.caPem !== "string"
  ) {
    throw new CloudError(message(body, "Could not link this server."));
  }
  return {
    instance: body.instance as CloudInstance,
    credential: body.credential,
    relay: { host: relay.host, port: relay.port, serverName: relay.serverName, caPem: relay.caPem },
  };
}

/** Ends the CLI's session; the server keeps only its relay credential. */
export async function signOut(token: string, options: CloudClientOptions = {}): Promise<void> {
  await client(options)("/api/auth/sign-out", { method: "POST", token, body: {} }).catch(() => undefined);
}
