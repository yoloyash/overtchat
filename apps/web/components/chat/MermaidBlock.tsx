"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Dialog } from "@base-ui/react/dialog";
import { Code, Copy, Download, Expand, Loader2, X } from "lucide-react";
import { writeText } from "clipboard-polyfill";
import type { CustomRendererProps } from "streamdown";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { renderDiagram, type RenderedDiagram } from "@/lib/chat/render-diagram";
import { DiagramViewport } from "./DiagramViewport";

type Preview = RenderedDiagram & { url: string; source: string; dark: boolean };

export function MermaidBlock({ code, isIncomplete }: CustomRendererProps) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failure, setFailure] = useState<{
    source: string;
    dark: boolean;
    message: string;
  } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null);
  const latestUrl = useRef<string | null>(null);
  const error =
    failure?.source === code && failure.dark === dark ? failure.message : null;
  const ready = preview?.source === code && preview.dark === dark;

  useEffect(() => {
    if (isIncomplete) return;
    let cancelled = false;
    void renderDiagram(code, dark, () => cancelled)
      .then((result) => {
        if (!result || cancelled) return;
        const url = URL.createObjectURL(
          new Blob([result.svg], { type: "image/svg+xml" }),
        );
        if (latestUrl.current) URL.revokeObjectURL(latestUrl.current);
        latestUrl.current = url;
        setPreview({ ...result, url, source: code, dark });
        setFailure(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setFailure({
            source: code,
            dark,
            message:
              reason instanceof Error
                ? reason.message
                : "Unable to render this diagram.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [code, dark, isIncomplete]);

  useEffect(
    () => () => {
      if (latestUrl.current) URL.revokeObjectURL(latestUrl.current);
    },
    [],
  );

  function download() {
    if (!preview) return;
    const anchor = document.createElement("a");
    anchor.href = preview.url;
    anchor.download = "diagram.svg";
    anchor.click();
  }

  return (
    <Dialog.Root open={fullscreen} onOpenChange={setFullscreen}>
      <div
        className="my-4 w-full min-w-0 overflow-hidden rounded-xl border text-foreground"
        data-streamdown="mermaid-block"
      >
        <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-2 py-1.5">
          <span className="pl-1 text-xs text-muted-foreground">Diagram</span>
          <div className="flex items-center gap-0.5">
            {!ready && !error && (
              <Loader2
                className="mr-2 size-3.5 animate-spin motion-reduce:animate-none"
                aria-label="Rendering diagram"
              />
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={showSource ? "Show diagram" : "Show source"}
              title={showSource ? "Show diagram" : "Show source"}
              aria-pressed={showSource}
              onClick={() => setShowSource(!showSource)}
            >
              <Code />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy diagram source"
              title="Copy diagram source"
              onClick={() => {
                void writeText(code)
                  .then(() => toast.success("Diagram source copied"))
                  .catch(() => toast.error("Could not copy diagram source"));
              }}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Download diagram as SVG"
              title="Download diagram as SVG"
              disabled={!ready || !!error}
              onClick={download}
            >
              <Download />
            </Button>
            <Dialog.Trigger
              render={
                <Button
                  ref={expandRef}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="View fullscreen"
                  title="View fullscreen"
                  disabled={!preview || !!error}
                />
              }
            >
              <Expand />
            </Dialog.Trigger>
          </div>
        </div>
        {error ? (
          <div className="space-y-2 p-3 text-sm">
            <p className="text-destructive" role="status">
              Mermaid Error: {error}
            </p>
            <details open={showSource || undefined}>
              <summary className="cursor-pointer text-muted-foreground">
                Show Code
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs">
                {code}
              </pre>
            </details>
          </div>
        ) : (
          <>
            {(showSource || !preview) && (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 text-xs">
                {code}
              </pre>
            )}
            {preview && (
              <div
                hidden={showSource}
                aria-busy={!ready}
                data-diagram-theme={preview.dark ? "dark" : "light"}
              >
                <DiagramViewport image={preview} />
              </div>
            )}
          </>
        )}
      </div>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Popup
          finalFocus={expandRef}
          className="fixed inset-3 z-50 flex flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-xl outline-none sm:inset-6"
        >
          <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
            <Dialog.Title className="text-sm font-medium">Diagram</Dialog.Title>
            <Dialog.Close
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Exit fullscreen"
                  title="Exit fullscreen"
                />
              }
            >
              <X />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Drag to pan. Scroll or pinch to zoom. Use Fit to show the entire
            diagram.
          </Dialog.Description>
          {preview && <DiagramViewport image={preview} fullscreen />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
