export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type DiagramView = Point & { scale: number };

export const MIN_DIAGRAM_HEIGHT = 200;
export const MAX_DIAGRAM_HEIGHT = 800;
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function fitDiagram(content: Size, viewport: Size) {
  return Math.min(
    Math.max(1, viewport.width - 32) / content.width,
    Math.max(1, viewport.height - 32) / content.height,
  );
}

export function boundDiagram(
  view: DiagramView,
  content: Size,
  viewport: Size,
): DiagramView {
  const horizontal = Math.max(
    0,
    (content.width * view.scale - viewport.width + 32) / 2,
  );
  const vertical = Math.max(
    0,
    (content.height * view.scale - viewport.height + 32) / 2,
  );
  return {
    scale: view.scale,
    x: horizontal ? clamp(view.x, -horizontal, horizontal) : 0,
    y: vertical ? clamp(view.y, -vertical, vertical) : 0,
  };
}

/** Keep the content under the gesture's focal point in place as its scale changes. */
export function zoomDiagram(
  view: DiagramView,
  scale: number,
  focal: Point,
  content: Size,
  viewport: Size,
): DiagramView {
  const ratio = scale / view.scale;
  return boundDiagram(
    {
      scale,
      x: focal.x - (focal.x - view.x) * ratio,
      y: focal.y - (focal.y - view.y) * ratio,
    },
    content,
    viewport,
  );
}
