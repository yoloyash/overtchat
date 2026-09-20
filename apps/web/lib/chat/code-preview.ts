// Keep generated documents separate from the app. This policy allows inline
// CSS/JS and embedded images/fonts, but no fetched resources or API requests.
// The iframe sandbox separately denies same-origin access, forms, and popups.
const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export const MAX_PREVIEW_LENGTH = 1_000_000;

export function htmlPreviewDocument(source: string): string {
  // Put our policy before any generated markup. Parsing the untrusted source
  // happens only inside the sandbox, including full HTML documents/fragments.
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1">${source}`;
}

export function svgPreviewSource(source: string): string {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (
    document.querySelector("parsererror") ||
    root.localName !== "svg" ||
    (root.namespaceURI && root.namespaceURI !== "http://www.w3.org/2000/svg")
  ) {
    throw new Error(
      "This SVG could not be rendered. Its source is still available.",
    );
  }
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Display this only as an image, never as inline DOM or an object/embed.
  // SVG image documents disable scripts and external resource loading.
  return new XMLSerializer().serializeToString(root);
}
