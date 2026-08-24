import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertOwnedImage } from "./assert-owned-image.mjs";

const labels = {
  "org.opencontainers.image.revision": "abc123",
  "org.opencontainers.image.version": "1.2.3",
  "org.opencontainers.image.source": "https://github.com/example/project",
};
const image = {
  image: {
    "linux/amd64": { config: { Labels: labels } },
    "linux/arm64": { config: { Labels: labels } },
  },
};
const expected = {
  revision: "abc123",
  version: "1.2.3",
  source: "https://github.com/example/project",
  platforms: ["linux/amd64", "linux/arm64"],
};

describe("owned image verification", () => {
  it("accepts matching platforms and OCI source metadata", () => {
    assert.doesNotThrow(() => assertOwnedImage(image, expected));
  });

  it("rejects an image built from another revision", () => {
    assert.throws(
      () => assertOwnedImage(image, { ...expected, revision: "different" }),
      /expected different/u,
    );
  });

  it("accepts a single-platform manifest", () => {
    assert.doesNotThrow(() =>
      assertOwnedImage(
        {
          image: {
            os: "linux",
            architecture: "amd64",
            config: { Labels: labels },
          },
        },
        { ...expected, platforms: ["linux/amd64"] },
      ),
    );
  });

  it("rejects a missing platform", () => {
    assert.throws(
      () =>
        assertOwnedImage(image, {
          ...expected,
          platforms: ["linux/s390x"],
        }),
      /missing required platform linux\/s390x/u,
    );
  });
});
