import assert from "node:assert/strict";
import { test } from "node:test";
import { updateCompatibilityMessage } from "./update-policy";

test("only an exact server API match allows a desktop update", () => {
  assert.equal(updateCompatibilityMessage(2, 2), null);
  assert.match(updateCompatibilityMessage(3, 2)!, /server first/);
  assert.match(updateCompatibilityMessage(1, 2)!, /does not support/);
});

test("missing or malformed feed compatibility data fails closed", () => {
  for (const level of [undefined, null, "2", 0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => updateCompatibilityMessage(level, 2), /compatibility information/);
  }
});
