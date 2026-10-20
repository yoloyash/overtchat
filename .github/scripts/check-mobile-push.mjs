#!/usr/bin/env node
/* global console, process */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

export function checkMobilePush(config, projectRoot) {
  const file = config.android?.googleServicesFile;
  if (typeof file !== "string" || !file.trim()) {
    throw new Error(
      "Android push configuration is missing. Provide apps/mobile/google-services.json or a readable GOOGLE_SERVICES_JSON file path on the release runner.",
    );
  }
  let firebase;
  try {
    firebase = JSON.parse(
      readFileSync(path.resolve(projectRoot, file), "utf8"),
    );
  } catch {
    throw new Error(
      "Android Firebase configuration must be a readable JSON file.",
    );
  }
  const project = firebase?.project_info;
  if (
    typeof project?.project_id !== "string" ||
    !project.project_id.trim() ||
    !/^\d+$/.test(project?.project_number ?? "")
  ) {
    throw new Error(
      "Android Firebase configuration is missing project information.",
    );
  }
  const client = Array.isArray(firebase.client)
    ? firebase.client.find(
        (entry) =>
          entry?.client_info?.android_client_info?.package_name ===
          config.android.package,
      )
    : undefined;
  if (!config.android.package || !client) {
    throw new Error(
      "Android Firebase configuration does not contain the app's Android package.",
    );
  }
  if (
    typeof client.client_info.mobilesdk_app_id !== "string" ||
    !client.client_info.mobilesdk_app_id.startsWith(
      `1:${project.project_number}:android:`,
    ) ||
    !Array.isArray(client.api_key) ||
    !client.api_key.some(
      (entry) =>
        typeof entry?.current_key === "string" && entry.current_key.trim(),
    )
  ) {
    throw new Error(
      "Android Firebase configuration is missing a valid app ID or API key.",
    );
  }
  return {
    google_app_id: client.client_info.mobilesdk_app_id,
    gcm_defaultSenderId: project.project_number,
    project_id: project.project_id,
    google_api_key: client.api_key.find(
      (entry) =>
        typeof entry?.current_key === "string" && entry.current_key.trim(),
    ).current_key,
  };
}

export function checkApkResources(resources, expected) {
  for (const [name, value] of Object.entries(expected)) {
    const resource = resources.match(
      new RegExp(`string/${name}\\s*\\n\\s*\\(\\) ("[^"\\n]*")`),
    );
    if (!resource || JSON.parse(resource[1]) !== value) {
      throw new Error(
        `Android APK has missing or mismatched Firebase resource: ${name}.`,
      );
    }
  }
}

function inspectApk(apk, expected) {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk)
    throw new Error("Set ANDROID_HOME or ANDROID_SDK_ROOT to inspect the APK.");
  const buildTools = path.join(sdk, "build-tools");
  const version = readdirSync(buildTools)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .find((entry) => existsSync(path.join(buildTools, entry, "aapt2")));
  if (!version)
    throw new Error("Android SDK build-tools with aapt2 are required.");
  const resources = execFileSync(
    path.join(buildTools, version, "aapt2"),
    ["dump", "resources", apk],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  checkApkResources(resources, expected);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    // This hook runs inside EAS's extracted archive, before prebuild. iOS does
    // not use Firebase; development clients may intentionally omit Android push.
    const skip =
      process.argv.includes("--eas-build") &&
      (process.env.EAS_BUILD_PLATFORM !== "android" ||
        process.env.EAS_BUILD_PROFILE === "development");
    if (!skip) {
      const projectRoot = fileURLToPath(
        new URL("../../apps/mobile/", import.meta.url),
      );
      const require = createRequire(import.meta.url);
      const { expo } = require(path.join(projectRoot, "app.json"));
      const config = require(path.join(projectRoot, "app.config.js"))({
        config: expo,
      });
      const expected = checkMobilePush(config, projectRoot);
      console.log("Android Firebase client configuration is valid.");
      const apkIndex = process.argv.indexOf("--apk");
      if (apkIndex !== -1) {
        const apk = process.argv[apkIndex + 1];
        if (!apk) throw new Error("--apk requires an APK path.");
        inspectApk(apk, expected);
        console.log(
          "Android APK contains the expected Firebase configuration.",
        );
      }
    }
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Android push configuration check failed.",
    );
    process.exitCode = 1;
  }
}
