/**
 * Where the e2e server sends its Google requests. Tests start a stand-in for
 * Google's sign-in and Gmail endpoints at this address.
 */
export const e2eGooglePort = Number(process.env.E2E_PORT ?? "4717") + 2001;

export const e2eGoogleOrigin = `http://127.0.0.1:${e2eGooglePort}`;
