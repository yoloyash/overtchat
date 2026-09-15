import { generateId } from "ai";
import type { Size } from "./diagram-viewport";

export type RenderedDiagram = Size & { svg: string };

// Mermaid has global configuration. Serialize initialization and rendering so a
// theme change cannot alter another diagram midway through its render.
let pending: Promise<unknown> = Promise.resolve();

export function renderDiagram(
  source: string,
  dark: boolean,
  cancelled: () => boolean,
) {
  const result = pending.then(async (): Promise<RenderedDiagram | null> => {
    if (cancelled()) return null;
    const { createMermaidPlugin } = await import("@streamdown/mermaid");
    if (cancelled()) return null;
    const renderer = createMermaidPlugin().getMermaid({
      theme: dark ? "dark" : "default",
      securityLevel: "strict",
      fontFamily: "sans-serif",
    });
    const { svg } = await renderer.render(
      `diagram-${generateId()}`,
      source,
    );
    // Mermaid's HTML labels can contain HTML void elements such as <br>.
    // Parse those as HTML, then serialize namespaces and self-closing tags for
    // a valid standalone SVG image (including foreignObject label content).
    const document = new DOMParser().parseFromString(svg, "text/html");
    const root = document.querySelector("svg");
    const [, , width, height] = (root?.getAttribute("viewBox") ?? "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      !root ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error("The diagram has no usable dimensions.");
    }
    root.setAttribute("width", String(width));
    root.setAttribute("height", String(height));
    root.style.maxWidth = "none";
    return { svg: new XMLSerializer().serializeToString(root), width, height };
  });
  pending = result.catch(() => {});
  return result;
}
