import assert from "node:assert/strict";
import { test } from "node:test";
import { isAppleNetworkFailure, retryAppleNetwork } from "./desktop-mac-network-retry.mjs";
const disconnected = { status: 68, output: 'api.apple-cloudkit.com Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."' };

test("a dropped Apple ticket connection retries and succeeds", async () => {
  let calls = 0;
  const pauses = [];
  const result = await retryAppleNetwork(async () => ++calls === 1 ? disconnected : { status: 0, output: "validated" },
    { pause: async ms => pauses.push(ms), report: () => {} });
  assert.equal(result.status, 0);
  assert.equal(calls, 2);
  assert.deepEqual(pauses, [15000]);
});

test("repeated ticket disconnections stop after three attempts and remain failures", async () => {
  let calls = 0;
  const pauses = [];
  const result = await retryAppleNetwork(async () => { calls++; return disconnected; },
    { pause: async ms => pauses.push(ms), report: () => {} });
  assert.equal(result.status, 68);
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [15000, 30000]);
});

for (const output of ["Notarization status: Invalid", "codesign: invalid signature", "The staple and validate action failed! Error 68.", "api.apple-cloudkit.com: no ticket found", "other.example NSURLErrorDomain Code=-1005"]) {
  test(`permanent or unrelated failure is not retried: ${output}`, async () => {
    assert.equal(isAppleNetworkFailure(output), false);
    let calls = 0;
    const result = await retryAppleNetwork(async () => { calls++; return { status: 1, output }; },
      { pause: async () => assert.fail("Unexpected retry"), report: () => {} });
    assert.equal(result.status, 1);
    assert.equal(calls, 1);
  });
}
