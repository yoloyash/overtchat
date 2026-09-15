import { describe, expect, it } from "vitest";
import { boundDiagram, fitDiagram, zoomDiagram } from "./diagram-viewport";

describe("diagram viewport geometry", () => {
  it("fits wide and tall drawings inside the padded viewport", () => {
    expect(
      fitDiagram({ width: 2000, height: 400 }, { width: 832, height: 432 }),
    ).toBe(0.4);
    expect(
      fitDiagram({ width: 400, height: 2000 }, { width: 832, height: 432 }),
    ).toBe(0.2);
  });

  it("allows a small drawing to use the available space", () => {
    expect(
      fitDiagram({ width: 200, height: 100 }, { width: 832, height: 432 }),
    ).toBe(4);
  });

  it("keeps a zoom gesture anchored to the point under the cursor", () => {
    const content = { width: 1000, height: 1000 };
    const viewport = { width: 500, height: 500 };
    const view = zoomDiagram(
      { scale: 1, x: 0, y: 0 },
      2,
      { x: 100, y: 50 },
      content,
      viewport,
    );
    expect(view).toEqual({ scale: 2, x: -100, y: -50 });
    expect(zoomDiagram(view, 1, { x: 100, y: 50 }, content, viewport)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });

  it("keeps the drawing reachable and centers axes that fit", () => {
    expect(
      boundDiagram(
        { scale: 1, x: 900, y: -900 },
        { width: 1000, height: 100 },
        { width: 500, height: 500 },
      ),
    ).toEqual({ scale: 1, x: 266, y: 0 });
  });
});
