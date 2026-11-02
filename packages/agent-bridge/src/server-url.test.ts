import { describe, expect, it } from "vitest";
import {
  HostConnectorServerUrlError,
  isInsecureHostConnectorServerUrl,
  normalizeHostConnectorServerUrl,
} from "./index";

function errorCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HostConnectorServerUrlError ? error.code : "other";
  }
}

describe("normalizeHostConnectorServerUrl", () => {
  it.each([
    ["http://127.0.0.1:4718/", "http://127.0.0.1:4718"],
    ["http://localhost:4718/path?x=1#y", "http://localhost:4718/path"],
    ["http://[::1]:4718", "http://[::1]:4718"],
    ["https://chat.example.com/", "https://chat.example.com"],
    ["https://user:pw@chat.example.com", "https://chat.example.com"],
  ])("accepts %s by default", (input, expected) => {
    expect(normalizeHostConnectorServerUrl(input)).toBe(expected);
  });

  it.each([
    "http://192.168.0.5:4718",
    "http://10.0.0.2:4718",
    "http://nas.home.arpa:4718",
    "http://100.100.1.2:4718",
    "http://chat.example.com",
  ])("refuses cleartext HTTP to %s unless opted in", (input) => {
    expect(errorCode(() => normalizeHostConnectorServerUrl(input))).toBe(
      "insecure_connector_url",
    );
    expect(() => normalizeHostConnectorServerUrl(input)).toThrow(
      "Non-local OvertChat URLs must use HTTPS.",
    );
    expect(
      normalizeHostConnectorServerUrl(input, { allowInsecureHttp: true }),
    ).toBe(input);
  });

  it("does not let the opt-in relax anything but the HTTPS requirement", () => {
    expect(
      errorCode(() =>
        normalizeHostConnectorServerUrl("ftp://nas.local", {
          allowInsecureHttp: true,
        }),
      ),
    ).toBe("unsupported_connector_url_protocol");
    expect(
      errorCode(() =>
        normalizeHostConnectorServerUrl("not a url", {
          allowInsecureHttp: true,
        }),
      ),
    ).toBe("invalid_connector_url");
  });
});

describe("isInsecureHostConnectorServerUrl", () => {
  it.each([
    ["http://127.0.0.1:4718", false],
    ["http://localhost:4718", false],
    ["https://192.168.0.5:4718", false],
    ["http://192.168.0.5:4718", true],
    ["http://nas.local:4718", true],
  ])("%s → %s", (input, expected) => {
    expect(isInsecureHostConnectorServerUrl(input)).toBe(expected);
  });
});
