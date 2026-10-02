import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createUpdateController, type UpdatePort } from "./update-controller";

function fixture(unsupported: string | null = null) {
  const events = new EventEmitter();
  let checks = 0, installs = 0, downloads = 0;
  let check: UpdatePort["checkForUpdates"] = async () => {
    events.emit("checking-for-update");
    events.emit("update-not-available", { version: "0.1.0" });
    return null;
  };
  let download: UpdatePort["downloadUpdate"] = async () => {
    events.emit("download-progress", { percent: 42.9 });
    events.emit("update-downloaded", { version: "0.1.1" });
  };
  const controller = createUpdateController({
    on: events.on.bind(events),
    checkForUpdates: () => { checks++; return check(); },
    downloadUpdate: () => { downloads++; return download(); },
    quitAndInstall: (silent, restart) => {
      assert.equal(silent, false);
      assert.equal(restart, true);
      installs++;
    },
  }, "0.1.0", unsupported, () => {});
  return {
    controller, events,
    setCheck: (next: typeof check) => { check = next; },
    setDownload: (next: typeof download) => { download = next; },
    checks: () => checks, downloads: () => downloads, installs: () => installs,
  };
}

test("discovering an update does not download or restart without a click", async () => {
  const f = fixture();
  f.setCheck(async () => {
    f.events.emit("checking-for-update");
    f.events.emit("update-available", { version: "0.1.1" });
    return null;
  });
  await f.controller.check();
  assert.equal(f.controller.getState().status, "available");
  assert.equal(f.downloads(), 0);
  assert.throws(() => f.controller.install(), /Download/);
  assert.equal((await f.controller.download()).status, "ready");
  assert.equal(f.downloads(), 1);
  assert.equal(f.installs(), 0);
  f.controller.install();
  assert.equal(f.controller.getState().status, "installing");
  assert.throws(() => f.controller.install(), /Download/);
  await delay(250);
  assert.equal(f.installs(), 1);
});

test("concurrent checks and downloads share requests; checks cannot interrupt downloads", async () => {
  const f = fixture();
  let finishCheck!: () => void;
  f.setCheck(() => new Promise((resolve) => { finishCheck = () => resolve(null); }));
  const a = f.controller.check(), b = f.controller.check();
  assert.equal(a, b);
  assert.equal(f.checks(), 1);
  finishCheck();
  await a;
  f.events.emit("update-available", { version: "0.1.1" });
  let finishDownload!: () => void;
  f.setDownload(() => new Promise((resolve) => {
    f.events.emit("download-progress", { percent: 42.9 });
    finishDownload = () => { f.events.emit("update-downloaded", { version: "0.1.1" }); resolve(null); };
  }));
  const c = f.controller.download(), d = f.controller.download();
  assert.equal(c, d);
  assert.equal(f.downloads(), 1);
  assert.equal(f.controller.getState().downloadPercent, 42);
  await f.controller.check();
  assert.equal(f.checks(), 1);
  finishDownload();
  await c;
});

test("check and download failures remain recoverable", async () => {
  const f = fixture();
  f.setCheck(async () => { throw new Error("offline"); });
  assert.equal((await f.controller.check()).status, "error");
  f.events.emit("update-available", { version: "0.1.1" });
  f.setDownload(async () => { throw new Error("download failed"); });
  await f.controller.download();
  assert.equal(f.controller.getState().message, "download failed");
  assert.equal(f.controller.getState().status, "error");
  f.setDownload(async () => { f.events.emit("update-downloaded", { version: "0.1.1" }); });
  assert.equal((await f.controller.download()).status, "ready");
  f.events.emit("error", new Error("check failed"));
  assert.equal(f.controller.getState().status, "ready");
});

test("a compatibility failure discards an earlier download and cannot download or restart", async () => {
  const f = fixture();
  f.events.emit("update-downloaded", { version: "0.1.1" });
  f.controller.block("0.2.0", "Update the server first");
  f.events.emit("update-not-available", { version: "0.2.0" });
  assert.equal((await f.controller.download()).status, "blocked");
  assert.equal(f.downloads(), 0);
  assert.throws(() => f.controller.install(), /Download/);
});

test("unsupported builds never check, download, or install", async () => {
  const f = fixture("Manual updates only");
  assert.equal((await f.controller.check()).status, "unsupported");
  assert.equal((await f.controller.download()).status, "unsupported");
  assert.equal(f.checks(), 0);
  assert.equal(f.downloads(), 0);
  assert.throws(() => f.controller.install(), /Download/);
});

test("a changed server cancels installation before Electron quits and leaves the download retryable", async () => {
  const f = fixture();
  f.events.emit("update-downloaded", { version: "0.1.1" });
  let server = "original";
  f.controller.install(() => {
    if (server !== "original") throw new Error("Server changed");
  });
  server = "changed";
  await delay(250);
  assert.equal(f.installs(), 0);
  assert.equal(f.controller.getState().status, "ready");
  assert.equal(f.controller.getState().message, "Server changed");
  f.controller.install();
  await delay(250);
  assert.equal(f.installs(), 1);
});
