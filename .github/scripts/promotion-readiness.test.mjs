import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
function run(name, setup = "", env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "promotion-test-"));
  try {
    const output = join(dir, "output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", `${setup}\n${step(name)}`], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_REPOSITORY: "test/repo", ...env },
    });
    assert.ifError(result.error);
    return { ...result, output: readFileSync(output, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
