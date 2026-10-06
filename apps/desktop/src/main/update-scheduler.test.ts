import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test, type TestContext } from "node:test";
import { startUpdateScheduler } from "./update-scheduler";

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 0 });
  const app = new EventEmitter();
  const power = new EventEmitter();
  let checks = 0;
  const stop = startUpdateScheduler(() => { checks++; }, app, power);
  return { app, power, stop, checks: () => checks };
}

test("checks at startup and every ten minutes without user activity", (t) => {
  const f = fixture(t);
  assert.equal(f.checks(), 1);
  t.mock.timers.tick(10 * 60 * 1000 - 1);
  assert.equal(f.checks(), 1);
  t.mock.timers.tick(1);
  assert.equal(f.checks(), 2);
  t.mock.timers.tick(10 * 60 * 1000);
  assert.equal(f.checks(), 3);
  f.stop();
});

test("focus and wake share a one-minute throttle, including after startup and polling", (t) => {
  const f = fixture(t);
  f.app.emit("browser-window-focus");
  f.power.emit("resume");
  assert.equal(f.checks(), 1);
  t.mock.timers.tick(60 * 1000 - 1);
  f.app.emit("browser-window-focus");
  assert.equal(f.checks(), 1);
  t.mock.timers.tick(1);
  f.app.emit("browser-window-focus");
  f.power.emit("resume");
  assert.equal(f.checks(), 2);
  t.mock.timers.tick(60 * 1000);
  f.power.emit("resume");
  f.app.emit("browser-window-focus");
  assert.equal(f.checks(), 3);
  t.mock.timers.tick(8 * 60 * 1000);
  assert.equal(f.checks(), 4);
  f.app.emit("browser-window-focus");
  f.power.emit("resume");
  assert.equal(f.checks(), 4);
  f.stop();
});

test("quitting removes the polling timer and activity listeners", (t) => {
  const f = fixture(t);
  f.app.emit("before-quit");
  assert.equal(f.app.listenerCount("browser-window-focus"), 0);
  assert.equal(f.app.listenerCount("before-quit"), 0);
  assert.equal(f.power.listenerCount("resume"), 0);
  t.mock.timers.tick(20 * 60 * 1000);
  f.app.emit("browser-window-focus");
  f.power.emit("resume");
  assert.equal(f.checks(), 1);
  f.stop();
});
