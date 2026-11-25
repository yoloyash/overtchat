#!/usr/bin/env node
/* global console, process */
/**
 * Counts interface text that is still written straight into client code, by
 * running each client's translation lint rules over every path instead of
 * only the migrated ones. See docs/development.md#translations.
 *
 *   npm run i18n:untranslated            totals per directory
 *   npm run i18n:untranslated -- <path>  every finding under a path
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filter = process.argv[2] ? path.resolve(process.argv[2]) : null;
const RULES = new Set(["i18next/no-literal-string", "no-restricted-syntax"]);

let total = 0;
for (const app of ["apps/web", "apps/mobile"]) {
  const result = spawnSync("npx", ["eslint", "--format", "json", "."], {
    cwd: path.join(root, app),
    env: { ...process.env, I18N_AUDIT: "1" },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  let files;
  try {
    files = JSON.parse(result.stdout);
  } catch {
    console.error(result.stderr || result.stdout);
    process.exit(2);
  }
  const byDirectory = new Map();
  for (const file of files) {
    const findings = file.messages.filter((message) => RULES.has(message.ruleId));
    if (findings.length === 0) continue;
    if (filter && !file.filePath.startsWith(filter)) continue;
    const relative = path.relative(root, file.filePath);
    total += findings.length;
    if (filter) {
      for (const { line, column } of findings) console.log(`${relative}:${line}:${column}`);
      continue;
    }
    const directory = path.dirname(relative);
    byDirectory.set(directory, (byDirectory.get(directory) ?? 0) + findings.length);
  }
  for (const [directory, count] of [...byDirectory].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${String(count).padStart(5)}  ${directory}`);
  }
}
console.log(`${String(total).padStart(5)}  total`);
