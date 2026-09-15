"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  boundDiagram,
  clamp,
  fitDiagram,
  zoomDiagram,
  MIN_DIAGRAM_HEIGHT,
  MAX_DIAGRAM_HEIGHT,
  type DiagramView,
  type Point,
  type Size,
} from "@/lib/chat/diagram-viewport";

type DiagramImage = Size & { url: string };

export function DiagramViewport({
  image,
  fullscreen = false,
}: {
  image: DiagramImage;
  fullscreen?: boolean;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [height, setHeight] = useState<number | null>(null);
  // A null view follows the available space until the user zooms or pans.
  const [manualView, setManualView] = useState<DiagramView | null>(null);
  const fit = fitDiagram(image, viewport);
  const minScale = Math.min(fit, 1) / 2;
  const maxScale = Math.max(fit * 4, 4);
  const view = useMemo(
    () =>
      manualView
        ? boundDiagram(
            {
              ...manualView,
              scale: clamp(manualView.scale, minScale, maxScale),
            },
            image,
            viewport,
          )
        : { scale: fit, x: 0, y: 0 },
    [manualView, minScale, maxScale, image, viewport, fit],
  );
  const viewRef = useRef(view);
  const pointers = useRef(new Map<number, Point>());
  const resizing = useRef<{ y: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const automaticHeight = clamp(
    ((viewport.width || 640) * image.height) / image.width + 32,
    MIN_DIAGRAM_HEIGHT,
    480,
  );
  const actualHeight = height ?? automaticHeight;

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setViewport({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const commit = useCallback((next: DiagramView) => {
    viewRef.current = next;
    setManualView(next);
  }, []);

  const zoom = useCallback(
    (factor: number, focal: Point = { x: 0, y: 0 }) => {
      const current = viewRef.current;
      commit(
        zoomDiagram(
          current,
          clamp(current.scale * factor, minScale, maxScale),
          focal,
          image,
          viewport,
        ),
      );
    },
    [commit, image, viewport, minScale, maxScale],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      if (!fullscreen && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const pixels =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoom(Math.exp(-clamp(pixels, -200, 200) * 0.005), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      });
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [fullscreen, zoom]);

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    const other = [...pointers.current.entries()].find(
      ([id]) => id !== event.pointerId,
    )?.[1];
    const current = viewRef.current;
    if (other) {
      const before = {
        x: (previous.x + other.x) / 2,
        y: (previous.y + other.y) / 2,
      };
      const after = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 };
      const distance = Math.hypot(previous.x - other.x, previous.y - other.y);
      const rect = event.currentTarget.getBoundingClientRect();
      const scaled = zoomDiagram(
        current,
        clamp(
          (current.scale * Math.hypot(next.x - other.x, next.y - other.y)) /
            Math.max(1, distance),
          minScale,
          maxScale,
        ),
        {
          x: before.x - rect.left - rect.width / 2,
          y: before.y - rect.top - rect.height / 2,
        },
        image,
        viewport,
      );
      commit(
        boundDiagram(
          {
            ...scaled,
            x: scaled.x + after.x - before.x,
            y: scaled.y + after.y - before.y,
          },
          image,
          viewport,
        ),
      );
    } else {
      commit(
        boundDiagram(
          {
            ...current,
            x: current.x + next.x - previous.x,
            y: current.y + next.y - previous.y,
          },
          image,
          viewport,
        ),
      );
    }
    pointers.current.set(event.pointerId, next);
  }

  function releasePointer(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    setDragging(pointers.current.size > 0);
  }

  function resize(next: number) {
    setHeight(clamp(next, MIN_DIAGRAM_HEIGHT, MAX_DIAGRAM_HEIGHT));
  }

  return (
    <div className={fullscreen ? "flex min-h-0 flex-1 flex-col" : "min-w-0"}>
      <div className="relative min-h-0 flex-1">
        <div
          ref={canvasRef}
          role="region"
          aria-label={
            fullscreen ? "Fullscreen diagram viewer" : "Diagram viewer"
          }
          tabIndex={0}
          className="relative overflow-hidden bg-background outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          style={{
            height: fullscreen ? "100%" : actualHeight,
            cursor: dragging ? "grabbing" : "grab",
            touchAction: fullscreen || manualView ? "none" : "pan-y",
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || pointers.current.size >= 2) return;
            pointers.current.set(event.pointerId, {
              x: event.clientX,
              y: event.clientY,
            });
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }}
          onPointerMove={movePointer}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
          onLostPointerCapture={releasePointer}
          onKeyDown={(event) => {
            if (event.key === "+" || event.key === "=") zoom(1.25);
            else if (event.key === "-") zoom(0.8);
            else if (event.key === "0") setManualView(null);
            else if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key,
              )
            ) {
              const current = viewRef.current;
              commit(
                boundDiagram(
                  {
                    ...current,
                    x:
                      current.x +
                      (event.key === "ArrowLeft"
                        ? 40
                        : event.key === "ArrowRight"
                          ? -40
                          : 0),
                    y:
                      current.y +
                      (event.key === "ArrowUp"
                        ? 40
                        : event.key === "ArrowDown"
                          ? -40
                          : 0),
                  },
                  image,
                  viewport,
                ),
              );
            } else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {/* SVG images isolate diagram markup and IDs from the chat document. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt="Mermaid chart"
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
            style={{
              width: image.width,
              height: image.height,
              transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              visibility: viewport.width ? "visible" : "hidden",
            }}
          />
        </div>
        <div className="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-lg border bg-background/95 p-1 text-xs shadow-sm">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={view.scale <= minScale}
            onClick={() => zoom(0.8)}
          >
            <Minus />
          </Button>
          <span
            className="min-w-10 text-center tabular-nums"
            aria-live="polite"
          >
            {Math.round(view.scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={view.scale >= maxScale}
            onClick={() => zoom(1.25)}
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Fit diagram"
            title="Fit diagram"
            onClick={() => setManualView(null)}
          >
            <Maximize />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Actual size"
            title="Actual size"
            onClick={() => commit({ scale: 1, x: 0, y: 0 })}
          >
            100%
          </Button>
        </div>
      </div>
      {!fullscreen && (
        <div
          role="separator"
          aria-label="Resize diagram"
          aria-orientation="horizontal"
          aria-valuemin={MIN_DIAGRAM_HEIGHT}
          aria-valuemax={MAX_DIAGRAM_HEIGHT}
          aria-valuenow={Math.round(actualHeight)}
          aria-valuetext={`${Math.round(actualHeight)} pixels high`}
          tabIndex={0}
          className="flex h-4 touch-none cursor-ns-resize items-center justify-center border-t bg-muted/30 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            resizing.current = { y: event.clientY, height: actualHeight };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (resizing.current)
              resize(
                resizing.current.height + event.clientY - resizing.current.y,
              );
          }}
          onPointerUp={() => {
            resizing.current = null;
          }}
          onPointerCancel={() => {
            resizing.current = null;
          }}
          onLostPointerCapture={() => {
            resizing.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") resize(actualHeight - 40);
            else if (event.key === "ArrowDown") resize(actualHeight + 40);
            else if (event.key === "Home") resize(MIN_DIAGRAM_HEIGHT);
            else if (event.key === "End") resize(MAX_DIAGRAM_HEIGHT);
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <span className="h-1 w-9 rounded-full bg-muted-foreground/40" />
        </div>
      )}
    </div>
  );
}
