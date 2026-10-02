import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createUpdateController } from "./update-controller";
import { createUpdatePreview } from "./update-preview";

test("development preview can exercise restart without quitting or installing", async () => {
  const preview = createUpdatePreview("0.1.0", "ready");
  const controller = createUpdateController(preview.port, "0.1.0", null, () => {});
  preview.begin(controller.block);
  assert.equal(controller.getState().availableVersion, "0.1.1");
  controller.install();
  assert.equal(controller.getState().status, "installing");
  await delay(250);
  assert.equal(controller.getState().status, "ready");
  assert.match(controller.getState().message!, /No update was installed/);
});

test("available preview exercises the click-to-download flow", async () => {
  const preview = createUpdatePreview("0.1.0", "available");
  const controller = createUpdateController(preview.port, "0.1.0", null, () => {});
  preview.begin(controller.block);
  assert.equal(controller.getState().status, "available");
  const download = controller.download();
  assert.equal(controller.getState().status, "downloading");
  assert.equal(controller.getState().downloadPercent, 37);
  await download;
  assert.equal(controller.getState().status, "ready");
});
