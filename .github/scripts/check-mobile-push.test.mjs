import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import { checkMobilePush } from "./check-mobile-push.mjs";

const config = {
  android: {
    package: "com.overtchat.mobile",
    googleServicesFile: "firebase.json",
  },
};
function firebase() {
  return {
    project_info: { project_id: "test-project", project_number: "123456" },
    client: [
      {
        client_info: {
          android_client_info: { package_name: "com.overtchat.mobile" },
          mobilesdk_app_id: "1:123456:android:abcdef",
        },
        api_key: [{ current_key: "test-key" }],
      },
    ],
  };
}

describe("Android push release preflight", () => {
  let directory;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "mobile-push-check-"));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  function write(value) {
    writeFileSync(path.join(directory, "firebase.json"), JSON.stringify(value));
  }

  it("accepts a valid configuration with a matching Android client", () => {
    const value = firebase();
    value.client.unshift({
      client_info: { android_client_info: { package_name: "another.app" } },
    });
    write(value);
    assert.doesNotThrow(() => checkMobilePush(config, directory));
  });
  it("accepts an absolute file path supplied by the build environment", () => {
    write(firebase());
    assert.doesNotThrow(() =>
      checkMobilePush(
        {
          android: {
            ...config.android,
            googleServicesFile: path.join(directory, "firebase.json"),
          },
        },
        directory,
      ),
    );
  });
  it("rejects missing configuration and unreadable files", () => {
    assert.throws(
      () =>
        checkMobilePush(
          { android: { package: config.android.package } },
          directory,
        ),
      /configuration is missing/,
    );
    assert.throws(() => checkMobilePush(config, directory), /readable JSON/);
  });
  it("exits nonzero when the configured environment path cannot be read", () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./check-mobile-push.mjs", import.meta.url))],
      {
        env: {
          ...process.env,
          GOOGLE_SERVICES_JSON: path.join(directory, "missing.json"),
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /readable JSON/);
  });
  it("rejects malformed JSON without exposing its contents", () => {
    writeFileSync(
      path.join(directory, "firebase.json"),
      "PRIVATE CONFIG CONTENT",
    );
    assert.throws(
      () => checkMobilePush(config, directory),
      (error) => {
        assert.match(error.message, /readable JSON/);
        assert.doesNotMatch(error.message, /PRIVATE CONFIG CONTENT/);
        return true;
      },
    );
  });
  it("rejects missing project information", () => {
    write({ client: firebase().client });
    assert.throws(
      () => checkMobilePush(config, directory),
      /project information/,
    );
  });
  it("rejects a configuration for a different Android package", () => {
    const value = firebase();
    value.client[0].client_info.android_client_info.package_name =
      "another.app";
    write(value);
    assert.throws(() => checkMobilePush(config, directory), /Android package/);
  });
  it("rejects an app ID from a different project", () => {
    const value = firebase();
    value.client[0].client_info.mobilesdk_app_id = "1:999:android:abcdef";
    write(value);
    assert.throws(() => checkMobilePush(config, directory), /valid app ID/);
  });
  it("rejects missing or malformed API keys", () => {
    for (const keys of [undefined, {}, [], [null], [{ current_key: "" }]]) {
      const value = firebase();
      value.client[0].api_key = keys;
      write(value);
      assert.throws(() => checkMobilePush(config, directory), /API key/);
    }
  });
});
