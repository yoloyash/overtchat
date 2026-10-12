import path from "node:path";

/** Custom-scheme requests may only read files inside the bundled renderer. */
export function rendererFile(directory: string, pathname: string, paths = path): string | null {
  let relative;
  try { relative = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html"; }
  catch { return null; }
  const file = paths.resolve(directory, relative);
  const traversal = paths.relative(directory, file);
  // On Windows, a different drive/UNC share produces an absolute relative()
  // result rather than '..'. Reject both ways of escaping the renderer root.
  if (paths.isAbsolute(traversal) || traversal === ".." || traversal.startsWith(`..${paths.sep}`)) return null;
  return file;
}
