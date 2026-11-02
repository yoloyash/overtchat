import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const outdir = path.join(root, "public/openui");
const require = createRequire(new URL("../package.json", import.meta.url));
await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["openui-embed/main.tsx"],
  outdir,
  bundle: true,
  // The monorepo has separate web/native React versions. Every dependency in
  // this browser bundle must use the web renderer's single React instance.
  alias: Object.fromEntries(
    ["react", "react-dom"].map((name) => [
      name,
      path.dirname(require.resolve(`${name}/package.json`)),
    ]),
  ),
  minify: true,
  format: "iife",
  jsx: "automatic",
  target: ["chrome110", "safari16.4"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
// No credentials, conversation data, CDN, remote scripts or API access in this
// static document. Native sends the current card through the WebView bridge.
await writeFile(
  path.join(outdir, "index.html"),
  `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src https: http: data:; font-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<link rel="stylesheet" href="./main.css"></head><body><div id="root"></div><script src="./main.js"></script></body></html>`,
);
console.log("Built the self-hosted OpenUI mobile renderer.");
