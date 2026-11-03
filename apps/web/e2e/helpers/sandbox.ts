/**
 * The code sandbox the e2e server calls. Tests start a stand-in at this
 * address unless SANDBOX_URL points at a real sandbox.
 */
export const realSandbox = Boolean(process.env.SANDBOX_URL);

export const e2eSandboxUrl =
  process.env.SANDBOX_URL ??
  `http://127.0.0.1:${Number(process.env.E2E_PORT ?? "4717") + 2000}`;

export const e2eSandboxToken = process.env.SANDBOX_TOKEN ?? "e2e-sandbox-token";
