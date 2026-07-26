#!/usr/bin/env node
/**
 * Fails if any package listed below resolves to more than one version in the
 * installed tree.
 *
 * Most duplicate dependencies are harmless — npm hoists what it can and nests
 * the rest, and two copies of a leaf utility cost nothing but disk. The Better
 * Auth packages are different, for two reasons that compound:
 *
 *   1. better-auth pins the rest of the family exactly (@better-auth/core,
 *      @better-fetch/fetch, better-call and the adapters are all "=X", not
 *      "^X"), while @better-auth/expo declares @better-auth/core as a caret
 *      peer. npm satisfies the caret with the newest matching minor, so bumping
 *      one package on its own leaves two copies of core in the tree.
 *
 *   2. The admin() plugin contributes session.user.role and auth.api.listUsers
 *      through module augmentation against @better-auth/core's declarations.
 *      TypeScript keys that augmentation to the file it came from, so with two
 *      copies it is registered on one and read from the other. Those members
 *      quietly stop existing and the web build fails to compile.
 *
 * The failure surfaces well downstream of its cause, which is what makes an
 * explicit gate worthwhile: one red "two versions of @better-auth/core" line
 * names the problem, where a wall of TS2339s in unrelated components does not.
 *
 * Run locally with `npm run deps:check`. Add a package here when its
 * correctness depends on there being exactly one copy of it in the tree.
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
    "\nDeduplicate the tree before merging. Bump the Better Auth packages together so " +
      "their internal pins agree, and set the root `overrides` entry for " +
      "@better-auth/core to the version the family resolves to.",
  );
  process.exit(1);
}
