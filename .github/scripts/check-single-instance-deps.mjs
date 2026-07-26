#!/usr/bin/env node
/**
 * Fails when type-coupled Better Auth packages resolve to multiple versions.
 *
 * Duplicate @better-auth/core versions break Better Auth's TypeScript module
 * augmentation and surface as missing auth fields far from the dependency
 * change. Other duplicate packages are not treated as errors.
 */

import { execFileSync } from "node:child_process";

const WATCHED = [
  "better-auth",
  "@better-auth/core",
  "@better-auth/expo",
  "@better-auth/kysely-adapter",
  "@better-fetch/fetch",
  "better-call",
];

const isCI = Boolean(process.env.GITHUB_ACTIONS);

/** Emits a GitHub Actions annotation when running in CI, a plain line otherwise. */
function fail(message) {
  console.error(isCI ? `::error::${message}` : `error: ${message}`);
}

/** @returns {Map<string, Map<string, string[]>>} name -> version -> locations */
function queryInstalledVersions(names) {
  const selector = names.map((name) => `#${name}`).join(", ");
  const stdout = execFileSync("npm", ["query", selector], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  const byName = new Map();
  for (const node of JSON.parse(stdout)) {
    if (!names.includes(node.name)) continue;
    const versions = byName.get(node.name) ?? new Map();
    const locations = versions.get(node.version) ?? [];
    locations.push(node.location);
    versions.set(node.version, locations);
    byName.set(node.name, versions);
  }
  return byName;
}

const installed = queryInstalledVersions(WATCHED);
let failed = false;

for (const name of WATCHED) {
  const versions = installed.get(name);

  if (!versions) {
    console.log(`skip ${name} (not installed)`);
    continue;
  }

  if (versions.size > 1) {
    failed = true;
    fail(`${name} resolves to ${versions.size} versions: ${[...versions.keys()].sort().join(", ")}`);
    for (const [version, locations] of [...versions].sort()) {
      for (const location of locations) console.error(`    ${version}  ${location}`);
    }
    continue;
  }

  console.log(`ok   ${name}@${[...versions.keys()][0]}`);
}

if (failed) {
  console.error(
    "\nAlign Better Auth versions across every workspace, regenerate package-lock.json " +
      "with npm 10.9.8, and rerun `npm run deps:check`.",
  );
  process.exit(1);
}
