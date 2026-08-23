import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertImagePlatforms,
  imagePlatforms,
} from "./assert-image-platforms.mjs";

const manifest = [
  {
    Descriptor: {
      platform: { os: "linux", architecture: "amd64" },
    },
  },
  {
    Descriptor: {
      platform: { os: "unknown", architecture: "unknown" },
    },
  },
  {
    Descriptor: {
      platform: { os: "linux", architecture: "arm64" },
    },
  },
];

describe("image platform verification", () => {
  it("extracts image platforms while tolerating attestation manifests", () => {
    assert.deepEqual(
      [...imagePlatforms(manifest)].sort(),
      ["linux/amd64", "linux/arm64", "unknown/unknown"],
    );
  });

  it("accepts all required platforms", () => {
    assert.doesNotThrow(() =>
      assertImagePlatforms(manifest, ["linux/amd64", "linux/arm64"]),
    );
  });

  it("reports missing platforms", () => {
    assert.throws(
      () => assertImagePlatforms(manifest, ["linux/s390x"]),
      /missing required platforms: linux\/s390x/u,
    );
  });
});
