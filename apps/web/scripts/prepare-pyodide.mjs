import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "pyodide";

const PACKAGES = Object.freeze([
  "numpy",
  "pandas",
  "matplotlib",
  "scipy",
  "scikit-learn",
  "sympy",
  "regex",
  "tiktoken",
  "pytz",
]);

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.dirname(fileURLToPath(import.meta.resolve("pyodide")));
const packageJson = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);
const target = path.join(webRoot, "public", "pyodide");
const markerPath = path.join(target, ".overtchat-pyodide.json");
const marker = JSON.stringify({ version: packageJson.version, packages: PACKAGES });

try {
  if ((await readFile(markerPath, "utf8")) === marker) process.exit(0);
} catch {
  // Missing or stale generated assets are rebuilt below.
}

console.log(
  `Preparing local Pyodide ${packageJson.version} runtime (${PACKAGES.join(", ")})`,
);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

const pyodide = await loadPyodide({ packageCacheDir: target });
await pyodide.loadPackage(PACKAGES);

for (const entry of [
  "package.json",
  "pyodide-lock.json",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "pyodide.js",
  "pyodide.mjs",
  "python_stdlib.zip",
]) {
  await cp(path.join(packageRoot, entry), path.join(target, entry));
}
await writeFile(markerPath, marker);
console.log("Pyodide runtime is ready in public/pyodide");
