#!/usr/bin/env node
/* global console, process */

import { readFileSync } from "node:fs";
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
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const projectRoot = fileURLToPath(
      new URL("../../apps/mobile/", import.meta.url),
    );
    const require = createRequire(import.meta.url);
    const { expo } = require(path.join(projectRoot, "app.json"));
    const config = require(path.join(projectRoot, "app.config.js"))({
      config: expo,
    });
    checkMobilePush(config, projectRoot);
    console.log("Android Firebase client configuration is valid.");
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Android push configuration check failed.",
    );
    process.exitCode = 1;
  }
}
