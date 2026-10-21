import { describe, expect, it } from "vitest";
import { terminalOutputQuote, terminalWebUrl } from "./terminal-presentation";

describe("terminal output actions", () => {
  it("keeps every line of Windows output in the user-reviewed quote", () => {
    expect(terminalOutputQuote("error\r\n\r\n```\rnext")).toBe(
      "Terminal output:\n> error\n> \n> ```\n> next\n\n",
    );
  });

  it("opens web URLs but rejects executable, file and app links emitted by a shell", () => {
    expect(terminalWebUrl("https://example.com/test?q=hello")).toBe(
      "https://example.com/test?q=hello",
    );
    expect(terminalWebUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/",
    );
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,test",
      "file:///etc/passwd",
      "overtchat://app",
      "not a URL",
    ]) {
      expect(terminalWebUrl(value)).toBeNull();
    }
  });
});
