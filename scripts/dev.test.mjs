import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  connectorIdentityChanged,
  developmentPort,
  devRuntimePaths,
  installedCapabilities,
  parseDevOptions,
} from "./dev.mjs";

test("development ports use explicit validated overrides", () => {
  assert.equal(developmentPort(undefined, 4717), 4717);
  assert.equal(developmentPort("4917", 4717), 4917);
  assert.throws(() => developmentPort("0", 4717), /Invalid development port/u);
  assert.throws(() => developmentPort("nope", 4717), /Invalid development port/u);
});

test("development dependencies use the production image pins", async () => {
  const [production, development] = await Promise.all([
    readFile("compose.yml", "utf8"),
    readFile("compose.dev.yml", "utf8"),
  ]);
  const productionImages = new Set(
    [...production.matchAll(/^\s+image:\s+(.+)$/gmu)].map((match) => match[1]),
  );
  const developmentImages = [
    ...development.matchAll(/^\s+image:\s+(.+)$/gmu),
  ].map((match) => match[1]);

  assert.ok(developmentImages.length > 0);
  for (const image of developmentImages) {
    assert.equal(productionImages.has(image), true, `${image} drifted`);
  }
});

test("workspace-only web development explicitly disables Redis", async () => {
  const developmentEnvironment = await readFile(
    "apps/web/.env.development",
    "utf8",
  );

  assert.match(developmentEnvironment, /^REDIS_URL=$/mu);
});

test("development runtime files stay inside the repository-local directory", () => {
  const root = path.resolve("/workspace/overtchat");
  const paths = devRuntimePaths(root);

  assert.equal(paths.runtimeDirectory, path.join(root, ".overtchat-dev"));
  for (const value of Object.values(paths)) {
    assert.equal(path.relative(root, value).startsWith(".."), false);
  }
});

test("connector state is retained only for the same server identity", () => {
  assert.equal(connectorIdentityChanged(null, "new"), false);
  assert.equal(connectorIdentityChanged({ connectorId: "same" }, "same"), false);
  assert.equal(connectorIdentityChanged({ connectorId: "old" }, "new"), true);
  assert.equal(connectorIdentityChanged({ invalid: true }, "new"), true);
});

test("Agent Connections are added without discarding selected capabilities", () => {
  assert.equal(installedCapabilities({}), "agents");
  assert.equal(
    installedCapabilities({
      OVERTCHAT_INSTALLED_CAPABILITIES: "tts,stt",
    }),
    "tts,stt,agents",
  );
  assert.equal(
    installedCapabilities({
      OVERTCHAT_INSTALLED_CAPABILITIES: "agents,tts",
    }),
    "agents,tts",
  );
});

test("development options reject ambiguous and unknown modes", () => {
  assert.deepEqual(parseDevOptions([]), {
    webOnly: false,
    resetConnector: false,
  });
  assert.equal(parseDevOptions(["--web-only"]).webOnly, true);
  assert.equal(parseDevOptions(["--reset-connector"]).resetConnector, true);
  assert.throws(
    () => parseDevOptions(["--web-only", "--reset-connector"]),
    /cannot be combined/u,
  );
  assert.throws(() => parseDevOptions(["--wat"]), /Unknown development option/u);
});
