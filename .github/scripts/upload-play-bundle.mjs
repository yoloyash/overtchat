#!/usr/bin/env node
/* global console, fetch, process, URLSearchParams */

// Upload a release AAB straight to Google Play and roll it out on a track,
// using the Play Developer API v3 with a service account. The Android build
// runs on a GitHub runner, so this mirrors the iOS job, which uploads to Apple
// itself, instead of relaying through a third-party submission queue.

import { Buffer } from "node:buffer";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://androidpublisher.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

export function parseServiceAccount(json) {
  let key;
  try {
    key = JSON.parse(json);
  } catch {
    throw new Error("The Play service account key is not valid JSON.");
  }
  for (const field of ["client_email", "private_key", "token_uri"]) {
    if (typeof key[field] !== "string" || !key[field].trim()) {
      throw new Error(`The Play service account key is missing ${field}.`);
    }
  }
  if (key.type !== "service_account") {
    throw new Error("The Play service account key is not a service account key.");
  }
  return key;
}

const base64url = (value) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

export function signedAssertion(key, now = Math.floor(Date.now() / 1000)) {
  const header = base64url({ alg: "RS256", typ: "JWT" });
  const claims = base64url({
    iss: key.client_email,
    scope: SCOPE,
    aud: key.token_uri,
    iat: now,
    exp: now + 300,
  });
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .sign(key.private_key, "base64url");
  return `${header}.${claims}.${signature}`;
}

async function readError(response) {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    return body.error?.message ?? body.error_description ?? body.error ?? text;
  } catch {
    return text;
  }
}

/**
 * Google rejects a bundle whose version code the app already has. For a
 * rerun that means an earlier attempt delivered this build.
 */
const alreadyUploaded = (message) =>
  /version code .*already (been )?(used|uploaded)/i.test(message);

export async function uploadPlayBundle({
  key,
  packageName,
  bundlePath,
  versionCode,
  track = "production",
  fetchImpl = fetch,
  log = console.log,
}) {
  const expectedCode = String(versionCode);
  const tokenResponse = await fetchImpl(key.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedAssertion(key),
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Google rejected the service account: ${await readError(tokenResponse)}`);
  }
  const { access_token: token } = await tokenResponse.json();
  const headers = { authorization: `Bearer ${token}` };
  const app = `${API}/androidpublisher/v3/applications/${packageName}`;

  const insert = await fetchImpl(`${app}/edits`, { method: "POST", headers });
  if (!insert.ok) {
    throw new Error(`Play refused to open an edit for ${packageName}: ${await readError(insert)}`);
  }
  const { id: edit } = await insert.json();
  const discard = () =>
    fetchImpl(`${app}/edits/${edit}`, { method: "DELETE", headers }).catch(() => {});

  try {
    const upload = await fetchImpl(
      `${API}/upload/androidpublisher/v3/applications/${packageName}/edits/${edit}/bundles?uploadType=media`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/octet-stream" },
        body: readFileSync(bundlePath),
      },
    );
    if (!upload.ok) {
      const message = await readError(upload);
      if (!alreadyUploaded(message)) {
        throw new Error(`Play rejected ${basename(bundlePath)}: ${message}`);
      }
      // Confirm the live track really carries this build before calling it done.
      const current = await fetchImpl(`${app}/edits/${edit}/tracks/${track}`, { headers });
      const releases = current.ok ? (await current.json()).releases ?? [] : [];
      const release = releases.find((entry) => (entry.versionCodes ?? []).includes(expectedCode));
      if (!release) {
        throw new Error(
          `Play already has version code ${expectedCode}, but the ${track} track does not carry it. Check the Play Console: ${message}`,
        );
      }
      log(
        `::notice::Play already has version code ${expectedCode} on the ${track} track (status ${release.status}); an earlier upload delivered this build.`,
      );
      return { status: "already-uploaded", versionCode: expectedCode, release };
    }
    const bundle = await upload.json();
    if (String(bundle.versionCode) !== expectedCode) {
      throw new Error(
        `Uploaded bundle has version code ${bundle.versionCode}, expected ${expectedCode}.`,
      );
    }

    const release = { status: "completed", versionCodes: [expectedCode] };
    const assign = await fetchImpl(`${app}/edits/${edit}/tracks/${track}`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ track, releases: [release] }),
    });
    if (!assign.ok) {
      throw new Error(`Play refused the ${track} release: ${await readError(assign)}`);
    }

    const commit = await fetchImpl(`${app}/edits/${edit}:commit`, { method: "POST", headers });
    if (!commit.ok) {
      throw new Error(`Play refused to commit the release: ${await readError(commit)}`);
    }
    log(
      `::notice::Uploaded version code ${expectedCode} to the Play ${track} track with status completed. Google may still hold it for review; the Play Console shows the release state.`,
    );
    return { status: "uploaded", versionCode: expectedCode, release };
  } catch (error) {
    await discard();
    throw error;
  }
}

function argument(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    throw new Error(`Missing ${name} <value>.`);
  }
  return args[index + 1];
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let bundlePath;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) index += 1;
    else bundlePath ??= argv[index];
  }
  if (!bundlePath) {
    throw new Error("Usage: upload-play-bundle.mjs <bundle.aab> --app-json <app.json> [--track production]");
  }
  const appJson = JSON.parse(readFileSync(argument(argv, "--app-json"), "utf8")).expo ?? {};
  const packageName = appJson.android?.package;
  const versionCode = appJson.android?.versionCode;
  if (!packageName || !Number.isInteger(versionCode)) {
    throw new Error("The Expo config must declare android.package and an integer android.versionCode.");
  }
  const trackIndex = argv.indexOf("--track");
  const track = trackIndex === -1 ? "production" : argv[trackIndex + 1];
  if (!env.ANDROID_PLAY_SERVICE_ACCOUNT_JSON) {
    throw new Error("Configure ANDROID_PLAY_SERVICE_ACCOUNT_JSON in GitHub Actions secrets.");
  }
  const key = parseServiceAccount(env.ANDROID_PLAY_SERVICE_ACCOUNT_JSON);
  return uploadPlayBundle({ key, packageName, bundlePath, versionCode, track });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
