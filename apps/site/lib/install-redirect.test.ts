import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Host Connector installer redirect", () => {
  it("keeps generated commands pinned to an immutable connector release", () => {
    const redirects = readFileSync(
      path.join(process.cwd(), "public/_redirects"),
      "utf8",
    );
    const installer = readFileSync(
      path.resolve(process.cwd(), "../../scripts/install-connector.sh"),
      "utf8",
    );
    const packageMetadata = JSON.parse(
      readFileSync(
        path.resolve(process.cwd(), "../connector/package.json"),
        "utf8",
      ),
    ) as { version: string };

    expect(redirects).toContain(
      `/install/connector/${packageMetadata.version} https://github.com/yoloyash/overtchat/releases/download/connector-v${packageMetadata.version}/install-connector.sh 302`,
    );
    expect(redirects).toContain(
      `/install-connector.sh /install/connector/${packageMetadata.version} 302`,
    );
    expect(installer).toContain(
      `connector_version="${packageMetadata.version}"`,
    );
  });
});
