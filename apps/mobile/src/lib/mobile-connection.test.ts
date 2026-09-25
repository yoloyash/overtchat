import { describe, expect, it } from "vitest";
import {
  isLocalOnlyServer,
  parseMobileServerUrl,
} from "@overtchat/shared/mobile-connection";

describe("mobile connection QR addresses", () => {
  it.each([
    [" https://CHAT.example.com/// ", "https://chat.example.com"],
    ["http://192.168.1.20:4717", "http://192.168.1.20:4717"],
    ["https://[fd00::123]:4717/", "https://[fd00::123]:4717"],
  ])("normalizes %s", (raw, expected) =>
    expect(parseMobileServerUrl(raw)).toBe(expected),
  );

  it.each([
    "",
    "not a URL",
    "javascript:alert(1)",
    "file:///tmp/server",
    "overtchat://connect",
    "https://user:secret@chat.example.com",
    "https://chat.example.com/login",
    "https://chat.example.com?token=secret",
    "https://chat.example.com#secret",
    "https://chat.example.com\\evil",
    "https://chat.\nexample.com",
    "https://" + "a".repeat(2048),
  ])("rejects unsafe or unrelated QR data: %s", (raw) =>
    expect(parseMobileServerUrl(raw)).toBeNull(),
  );

  it.each([
    "http://localhost:4717",
    "http://dev.localhost",
    "http://localhost.",
    "http://127.0.0.1",
    "http://127.9.2.3",
    "http://[::1]",
    "http://0.0.0.0",
    "http://[::]",
  ])("identifies unusable phone addresses: %s", (url) =>
    expect(isLocalOnlyServer(url)).toBe(true),
  );
  it.each([
    "http://192.168.1.20",
    "http://10.0.0.2",
    "http://172.16.0.1",
    "http://172.31.0.1",
    "http://100.64.1.2",
    "http://chat.local",
    "http://myserver",
    "http://[fd12::1]",
    "http://[fe80::1]",
  ])("allows reachable network addresses: %s", (url) =>
    expect(isLocalOnlyServer(url)).toBe(false),
  );
  it.each([
    "https://chat.example.com",
    "http://172.32.0.1",
    "http://192.169.1.1",
  ])("leaves other addresses unchanged: %s", (url) =>
    expect(isLocalOnlyServer(url)).toBe(false),
  );
});
