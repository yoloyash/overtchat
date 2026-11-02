import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function request(method: string, origin?: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://server.test/api/chats", {
    method,
    headers: { ...(origin ? { Origin: origin } : {}), ...headers },
  });
}

describe("API proxy CORS", () => {
  it("answers preflight from the desktop app", () => {
    const response = proxy(request("OPTIONS", "overtchat://app"));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("overtchat://app");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("set-auth-token");
  });

  it("adds CORS headers to requests from OvertChat clients", () => {
    const response = proxy(request("GET", "exp://192.168.1.2:8081"));

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("exp://192.168.1.2:8081");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("does not grant CORS to other origins", () => {
    const preflight = proxy(request("OPTIONS", "https://evil.test"));
    const get = proxy(request("GET", "https://evil.test"));

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(get.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("leaves same-origin requests untouched", () => {
    const response = proxy(request("GET"));

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("API proxy cross-site writes", () => {
  const sibling = "https://evil.overtchat.app";

  it("refuses writes a browser marks as same-site or cross-site", () => {
    for (const site of ["same-site", "cross-site"]) {
      const response = proxy(request("POST", sibling, { "Sec-Fetch-Site": site, Host: "victim.overtchat.app" }));
      expect(response.status).toBe(403);
    }
  });

  it("allows same-origin writes and writes from OvertChat clients", () => {
    const sameOrigin = proxy(
      request("POST", "https://victim.overtchat.app", {
        "Sec-Fetch-Site": "same-origin",
        Host: "victim.overtchat.app",
      }),
    );
    const desktop = proxy(request("POST", "overtchat://app", { "Sec-Fetch-Site": "cross-site" }));

    expect(sameOrigin.status).toBe(200);
    expect(desktop.status).toBe(200);
    expect(desktop.headers.get("Access-Control-Allow-Origin")).toBe("overtchat://app");
  });

  it("allows writes without browser markers, like native clients and the CLI", () => {
    expect(proxy(request("POST")).status).toBe(200);
    expect(proxy(request("DELETE", undefined, { Authorization: "Bearer token" })).status).toBe(200);
  });

  it("checks Origin against the host when Sec-Fetch-Site is missing", () => {
    const lan = { Host: "192.168.1.5:4717" };
    expect(proxy(request("POST", "http://192.168.1.5:4717", lan)).status).toBe(200);
    expect(proxy(request("POST", "http://other.lan", lan)).status).toBe(403);
    expect(proxy(request("POST", "null", lan)).status).toBe(403);
    const forwarded = { Host: "app:4717", "X-Forwarded-Host": "chat.example.com" };
    expect(proxy(request("POST", "http://chat.example.com", forwarded)).status).toBe(200);
  });

  it("leaves reads alone", () => {
    expect(proxy(request("GET", sibling, { "Sec-Fetch-Site": "same-site" })).status).toBe(200);
  });
});
