import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function request(method: string, origin?: string) {
  return new NextRequest("http://server.test/api/chats", {
    method,
    headers: origin ? { Origin: origin } : undefined,
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
