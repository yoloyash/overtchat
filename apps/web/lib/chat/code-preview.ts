export { htmlPreviewDocument, MAX_PREVIEW_LENGTH } from "@overtchat/shared";

export function svgPreviewSource(source: string, isIncomplete = false): string {
  // A detached template uses the browser's forgiving HTML/SVG parser to close
  // unfinished elements while streaming. Its content stays inert, including
  // scripts and resource URLs, and is only ever serialized into an SVG image.
  // Completed output still gets strict XML validation.
  const template = isIncomplete ? document.createElement("template") : null;
  if (template) template.innerHTML = source;
  const xml = template
    ? null
    : new DOMParser().parseFromString(source, "image/svg+xml");
  const root = template
    ? template.content.firstElementChild
    : xml?.documentElement;
  if (
    !root ||
    xml?.querySelector("parsererror") ||
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
