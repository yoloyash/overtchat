import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import process from "node:process";
import { URL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const workflow = readFileSync(new URL("../workflows/promote-release.yml", import.meta.url), "utf8");
function step(name) {
  const block = workflow.split(`      - name: ${name}\n`)[1]?.split("\n      - name:")[0];
  assert.ok(block, name);
  assert.ok(!block.includes("continue-on-error:"));
  assert.ok(!block.includes("if: always()"));
  return block.split("        run: |\n")[1].split("\n").map((line) => line.slice(10)).join("\n");
}
function run(name, setup = "", env = {}, cwd = process.cwd()) {
  const dir = mkdtempSync(join(tmpdir(), "promotion-test-"));
  try {
    const output = join(dir, "output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", `${setup}\n${step(name)}`], {
      encoding: "utf8",
      cwd,
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_REPOSITORY: "test/repo", ...env },
    });
    assert.ifError(result.error);
    return { ...result, output: readFileSync(output, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function verifyConnector({ artifactMismatch = false, tagUnavailable = false, redirectMismatch = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "connector-promotion-test-"));
  try {
    const version = "1.2.3";
    const installer = `#!/bin/sh\nconnector_version="${version}"\n`;
    for (const subdir of ["release", "scripts", "apps/site/public"]) mkdirSync(join(dir, subdir), { recursive: true });
    writeFileSync(join(dir, "tag-installer.sh"), installer);
    writeFileSync(join(dir, "release/install-connector.sh"), artifactMismatch ? `${installer}echo modified\n` : installer);
    writeFileSync(join(dir, "scripts/install-connector.sh"), `${installer}echo unreleased\n`);
    const selected = redirectMismatch ? "0.0.1" : version;
    writeFileSync(join(dir, "apps/site/public/_redirects"),
      `/install/connector/${selected} https://github.com/test/repo/releases/download/connector-v${selected}/install-connector.sh 302\n/install-connector.sh /install/connector/${selected} 302\n`);
    let checksums = "";
    for (const platform of ["darwin-amd64", "darwin-arm64", "linux-amd64", "linux-arm64"]) {
      const asset = `overtchat-connector-${platform}`;
      const contents = `fixture ${platform}\n`;
      writeFileSync(join(dir, "release", asset), contents);
      checksums += `${createHash("sha256").update(contents).digest("hex")}  ${asset}\n`;
    }
    writeFileSync(join(dir, "release/connector-checksums.txt"), checksums);
    return run("Verify connector release", `
      gh() {
        if [ "$1" = api ]; then
          [ "$2" = -H ] && [ "$3" = 'Accept: application/vnd.github.raw+json' ] &&
            [ "$4" = "repos/test/repo/contents/scripts/install-connector.sh?ref=connector-v$CONNECTOR_VERSION" ] || return 1
          if [ "$TAG_UNAVAILABLE" = true ]; then echo "Release tag unavailable" >&2; return 1; fi
          cat "$FIXTURE_DIRECTORY/tag-installer.sh"
        else
          [ "$1" = release ] && [ "$2" = download ] && [ "$3" = "connector-v$CONNECTOR_VERSION" ] || return 1
          while [ "$1" != --dir ]; do shift; done
          cp "$FIXTURE_DIRECTORY/release/"* "$2/"
        fi
      }
    `, { CONNECTOR_VERSION: version, FIXTURE_DIRECTORY: dir, TAG_UNAVAILABLE: String(tagUnavailable) }, dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("connector promotion accepts tagged artifacts while main has unreleased installer changes", () => {
  const result = verifyConnector();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, "ready=true\n");
});

test("connector promotion rejects an installer that differs from its release tag", () => {
  const result = verifyConnector({ artifactMismatch: true });
  assert.notEqual(result.status, 0);
  assert.equal(result.output, "");
});

test("connector promotion fails closed when the artifact's release tag cannot be read", () => {
  const result = verifyConnector({ tagUnavailable: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release tag unavailable/);
  assert.equal(result.output, "");
});

test("connector promotion still rejects redirects selecting a different release", () => {
  const result = verifyConnector({ redirectMismatch: true });
  assert.notEqual(result.status, 0);
  assert.equal(result.output, "");
});

for (const name of ["Verify CLI release", "Verify connector release", "Verify container images"]) {
  test(`${name}: unavailable artifacts defer after retries`, () => {
    const result = run(name, "gh() { return 1; }; docker() { return 1; }; sleep() { :; }");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, "ready=false\n");
  });
}

for (const [name, prefix, checksum] of [
  ["Verify CLI release", "overtchat", "overtchat-checksums.txt"],
  ["Verify connector release", "overtchat-connector", "connector-checksums.txt"],
]) {
  test(`${name}: checksum failures remain fatal`, () => {
    const result = run(name, `
      gh() {
        while [ "$1" != "--dir" ]; do shift; done
        local destination="$2"
        for platform in darwin-amd64 darwin-arm64 linux-amd64 linux-arm64; do
          echo corrupt > "$destination/${prefix}-$platform"
          echo "0000000000000000000000000000000000000000000000000000000000000000  ${prefix}-$platform" >> "$destination/${checksum}"
        done
      }
    `);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /FAILED/);
    assert.equal(result.output, "");
  });
}

test("an available image missing a required architecture fails verification", () => {
  const result = run("Verify container images", `docker() { echo '[{"Descriptor":{"platform":{"os":"linux","architecture":"amd64"}}}]'; }`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /linux\/arm64/);
  assert.equal(result.output, "");
});

test("verified images report readiness", () => {
  const result = run("Verify container images", `docker() { echo '[{"Descriptor":{"platform":{"os":"linux","architecture":"amd64"}}},{"Descriptor":{"platform":{"os":"linux","architecture":"arm64"}}}]'; }`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, "ready=true\n");
});

for (const strict of ["true", "false"]) {
  for (const missing of ["", "CLI_READY", "CONNECTOR_READY", "IMAGES_READY"]) {
    test(`promotion: strict=${strict}, missing=${missing || "none"}`, () => {
      const env = { CLI_READY: "true", CONNECTOR_READY: "true", IMAGES_READY: "true", REQUIRE_COMPLETE: strict };
      if (missing) env[missing] = "false";
      const result = run("Require a complete candidate release", "", env);
      assert.equal(result.status, missing && strict === "true" ? 1 : 0, result.stderr);
      assert.equal(result.output, `ready=${missing ? "false" : "true"}\n`);
    });
  }
}
