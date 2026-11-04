import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  main,
  parseServiceAccount,
  signedAssertion,
  uploadPlayBundle,
} from "./upload-play-bundle.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = {
  type: "service_account",
  client_email: "publisher@example.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  token_uri: "https://oauth2.googleapis.com/token",
};
const app = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.overtchat.mobile";

const json = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const failure = (message, status = 400) => json({ error: { code: status, message } }, status);

/** A Play API stand-in that records every call and answers per route. */
function fakePlay(overrides = {}) {
  const calls = [];
  const routes = {
    token: () => json({ access_token: "token" }),
    insert: () => json({ id: "edit-1" }),
    upload: () => json({ versionCode: 33, sha256: "abc" }),
    track: () => json({ track: "production", releases: [{ status: "completed", versionCodes: ["33"] }] }),
    readTrack: () => json({ track: "production", releases: [{ status: "completed", versionCodes: ["33"] }] }),
    commit: () => json({ id: "edit-1" }),
    discard: () => json({}, 204),
    ...overrides,
  };
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, headers: init.headers ?? {}, body: init.body });
    if (url === key.token_uri) return routes.token(init);
    if (url === `${app}/edits` && method === "POST") return routes.insert(init);
    if (url.includes("/upload/androidpublisher/") && url.endsWith("/bundles?uploadType=media")) return routes.upload(init);
    if (url === `${app}/edits/edit-1/tracks/production` && method === "PUT") return routes.track(init);
    if (url === `${app}/edits/edit-1/tracks/production` && method === "GET") return routes.readTrack(init);
    if (url === `${app}/edits/edit-1:commit`) return routes.commit(init);
    if (url === `${app}/edits/edit-1` && method === "DELETE") return routes.discard(init);
    throw new Error(`unexpected request ${method} ${url}`);
  };
  return { calls, fetchImpl, logs: [], log(line) { this.logs.push(line); } };
}

describe("Play bundle upload", () => {
  let directory;
  let bundlePath;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "play-upload-"));
    bundlePath = path.join(directory, "overtchat-v1.24.0.aab");
    writeFileSync(bundlePath, Buffer.from("not really a bundle"));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("signs a short-lived JWT for the Android Publisher scope", () => {
    const assertion = signedAssertion(key, 1_700_000_000);
    const [header, claims, signature] = assertion.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "RS256", typ: "JWT" });
    assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url")), {
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: key.token_uri,
      iat: 1_700_000_000,
      exp: 1_700_000_300,
    });
    assert.ok(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, signature, "base64url"));
  });

  it("rejects keys that are not a service account", () => {
    assert.throws(() => parseServiceAccount("{"), /not valid JSON/);
    assert.throws(() => parseServiceAccount(JSON.stringify({ ...key, private_key: "" })), /missing private_key/);
    assert.throws(() => parseServiceAccount(JSON.stringify({ ...key, type: "authorized_user" })), /not a service account/);
    assert.equal(parseServiceAccount(JSON.stringify(key)).client_email, key.client_email);
  });

  it("uploads the bundle, releases it on the track, and commits the edit", async () => {
    const play = fakePlay();
    const result = await uploadPlayBundle({
      key, packageName: "com.overtchat.mobile", bundlePath, versionCode: 33,
      fetchImpl: play.fetchImpl, log: (line) => play.log(line),
    });
    assert.equal(result.status, "uploaded");
    assert.deepEqual(
      play.calls.map((call) => `${call.method} ${call.url.replace(app, "").replace(key.token_uri, "token")}`),
      [
        "POST token",
        "POST /edits",
        "POST https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/com.overtchat.mobile/edits/edit-1/bundles?uploadType=media",
        "PUT /edits/edit-1/tracks/production",
        "POST /edits/edit-1:commit",
      ],
    );
    const upload = play.calls[2];
    assert.equal(upload.headers["content-type"], "application/octet-stream");
    assert.equal(upload.headers.authorization, "Bearer token");
    assert.equal(Buffer.from(upload.body).toString(), "not really a bundle");
    assert.deepEqual(JSON.parse(play.calls[3].body), {
      track: "production",
      releases: [{ status: "completed", versionCodes: ["33"] }],
    });
    assert.match(play.logs[0], /::notice::Uploaded version code 33/);
  });

  it("treats a version code Play already has as delivered when the track carries it", async () => {
    const play = fakePlay({
      upload: () => failure("APK specifies a version code that has already been used."),
    });
    const result = await uploadPlayBundle({
      key, packageName: "com.overtchat.mobile", bundlePath, versionCode: 33,
      fetchImpl: play.fetchImpl, log: (line) => play.log(line),
    });
    assert.equal(result.status, "already-uploaded");
    assert.match(play.logs[0], /already has version code 33 on the production track \(status completed\)/);
    assert.ok(!play.calls.some((call) => call.url.endsWith(":commit")), "nothing to commit");
  });

  it("fails when Play has the version code but the track does not carry it", async () => {
    const play = fakePlay({
      upload: () => failure("Version code 33 has already been used."),
      readTrack: () => json({ track: "production", releases: [{ status: "completed", versionCodes: ["32"] }] }),
    });
    await assert.rejects(
      uploadPlayBundle({ key, packageName: "com.overtchat.mobile", bundlePath, versionCode: 33, fetchImpl: play.fetchImpl, log() {} }),
      /does not carry it/,
    );
    assert.ok(play.calls.some((call) => call.method === "DELETE"), "the edit is discarded");
  });

  it("discards the edit when the uploaded version code is not the committed one", async () => {
    const play = fakePlay({ upload: () => json({ versionCode: 34 }) });
    await assert.rejects(
      uploadPlayBundle({ key, packageName: "com.overtchat.mobile", bundlePath, versionCode: 33, fetchImpl: play.fetchImpl, log() {} }),
      /version code 34, expected 33/,
    );
    assert.ok(play.calls.some((call) => call.method === "DELETE"));
    assert.ok(!play.calls.some((call) => call.method === "PUT"), "no release is assigned");
  });

  it("surfaces Google's rejection text for other upload failures", async () => {
    const play = fakePlay({ upload: () => failure("Your app bundle is not signed with the expected key.", 403) });
    await assert.rejects(
      uploadPlayBundle({ key, packageName: "com.overtchat.mobile", bundlePath, versionCode: 33, fetchImpl: play.fetchImpl, log() {} }),
      /Play rejected overtchat-v1.24.0.aab: Your app bundle is not signed/,
    );
  });

  it("reports an unusable service account before touching the app", async () => {
    const play = fakePlay({ token: () => json({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, 400) });
    await assert.rejects(
      uploadPlayBundle({ key, packageName: "com.overtchat.mobile", bundlePath, versionCode: 33, fetchImpl: play.fetchImpl, log() {} }),
      /rejected the service account: Invalid JWT Signature/,
    );
    assert.equal(play.calls.length, 1);
  });

  it("reads the package and version code from the Expo config and requires the secret", async () => {
    const appJson = path.join(directory, "app.json");
    writeFileSync(appJson, JSON.stringify({ expo: { android: { package: "com.overtchat.mobile", versionCode: 33 } } }));
    await assert.rejects(main([bundlePath, "--app-json", appJson], {}), /ANDROID_PLAY_SERVICE_ACCOUNT_JSON/);
    writeFileSync(appJson, JSON.stringify({ expo: { android: { package: "com.overtchat.mobile" } } }));
    await assert.rejects(
      main([bundlePath, "--app-json", appJson], { ANDROID_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(key) }),
      /integer android.versionCode/,
    );
    await assert.rejects(main(["--app-json", appJson], {}), /Usage/);
  });
});
