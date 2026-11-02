import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { rendererFile } from "./protocol-path";

test("Windows app requests cannot escape to another drive, UNC share, or parent", () => {
  const root = "C:\\app\\out\\renderer";
  assert.equal(rendererFile(root, "/", path.win32), `${root}\\index.html`);
  assert.equal(rendererFile(root, "/assets/main.js", path.win32), `${root}\\assets\\main.js`);
  for (const request of ["/../main/index.js", "/..%5cmain%5cindex.js", "/D:/private.txt", "/D:%5cprivate.txt", "/%5c%5cserver%5cshare%5cprivate.txt", "/C:/private.txt", "/%zz"]) {
    assert.equal(rendererFile(root, request, path.win32), null, request);
  }
});

test("POSIX app requests stay inside the renderer and allow encoded filenames", () => {
  assert.equal(rendererFile("/app/renderer", "/assets/my%20file.js", path.posix), "/app/renderer/assets/my file.js");
  assert.equal(rendererFile("/app/renderer", "/../private.txt", path.posix), null);
});
