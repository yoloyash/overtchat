// Keep generated documents separate from the app. This policy allows inline
// CSS/JS and embedded images/fonts, but no fetched resources or API requests.
// The web iframe sandbox and the native WebView settings separately deny
// same-origin access, forms, popups and navigation.
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
