import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Host Connector installer redirect", () => {
  it("keeps the public installer URL pointed at the canonical release asset", () => {
    const redirects = readFileSync(
      path.join(process.cwd(), "public/_redirects"),
      "utf8",
    );

    expect(redirects).toContain(
      "/install-connector.sh https://github.com/yoloyash/overtchat/releases/latest/download/install-connector.sh 302",
    );
  });
});
