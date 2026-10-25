"use client";

import { useEffect, useMemo, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import type { UIMessage } from "ai";
import { useTheme } from "next-themes";
import { writeText } from "clipboard-polyfill";
import { CodeBlock, Streamdown } from "streamdown";
import {
  ChevronLeft,
  ChevronRight,
  Code,
  Copy,
  Download,
  Eye,
  FileDown,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import {
  canExportToWord,
  DOCUMENT_TYPE_LABELS,
  documentFilename,
  documentMediaType,
  documentView,
  type DocumentDraft,
  type DocumentType,
} from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { apiUrl } from "@/lib/api-url";
import { cn } from "@/lib/utils";
import { motionClasses } from "@/lib/motion";
import { MESSAGE_MARKDOWN_PLUGINS } from "@/lib/chat/markdown";
import { htmlPreviewDocument, svgPreviewSource } from "@/lib/chat/code-preview";
import { renderDiagram } from "@/lib/chat/render-diagram";
import { DiagramViewport } from "./DiagramViewport";
import { DOCUMENT_ICONS } from "./DocumentCard";
import { SidePanel } from "./SidePanel";

type ShownDocument = DocumentDraft & { version?: number };

const PREVIEWABLE = new Set<DocumentType>(["markdown", "html", "svg", "mermaid"]);

/**
 * The document beside the chat: the version produced by one tool call, with
 * navigation to the document's other saved versions.
 */
export function DocumentPanel({
  messages,
  toolCallId,
  streaming,
  variant = "docked",
  wordExport = true,
  onSelect,
  onClose,
}: {
  messages: UIMessage[];
  toolCallId: string;
  streaming: boolean;
  variant?: "docked" | "overlay";
  /** Word export converts on the server and needs a signed-in session. */
  wordExport?: boolean;
  onSelect: (toolCallId: string) => void;
  onClose: () => void;
}) {
  const view = useMemo(
    () => documentView(messages, toolCallId),
    [messages, toolCallId],
  );
  const [showSource, setShowSource] = useState(false);
  const [exporting, setExporting] = useState(false);
  const missing = !view;
  useEffect(() => {
    // The tool call can disappear when history is edited or regenerated.
    if (missing) onClose();
  }, [missing, onClose]);
  if (!view) return null;

  const saved = view.versions[view.index];
  const document: ShownDocument | undefined = view.draft ?? saved;
  if (!document) return null;
  const writing = Boolean(view.draft) && streaming;
  const previewable = PREVIEWABLE.has(document.type);
  const sourceShown = !previewable || showSource || writing;
  const Icon = DOCUMENT_ICONS[document.type];
  const status = view.draft
    ? writing
      ? "Writing…"
      : "Not saved"
    : view.updating && streaming
      ? `Version ${saved.version} · Updating…`
      : `Version ${saved.version} of ${view.versions.at(-1)!.version}`;

  function save(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function download() {
    save(
      new Blob([document!.content], { type: documentMediaType(document!) }),
      documentFilename(document!),
    );
  }

  async function exportWord() {
    const shown = document!;
    setExporting(true);
    try {
      const response = await fetch(apiUrl("/api/documents/export"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: shown.title,
          type: shown.type,
          content: shown.content,
          format: "docx",
        }),
      });
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      save(await response.blob(), documentFilename(shown, "docx"));
    } catch {
      toast.error({
        title: "Could not export the document",
        description: "Check your connection and try again.",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <SidePanel
      aria-label={`Document: ${document.title}`}
      data-document-panel=""
      variant={variant}
      onClose={onClose}
    >
      {/* One row on wide screens; narrow screens move the toolbar below the
          title so the title stays readable. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {writing ? (
            <Loader2 className={cn("size-4", motionClasses.spinner)} />
          ) : (
            <Icon className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{document.title}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {DOCUMENT_TYPE_LABELS[document.type]}
            {document.type === "code" && document.language
              ? ` · ${document.language}`
              : ""}{" "}
            · {status}
          </p>
        </div>
        <div className="order-last flex w-full items-center gap-0.5 lg:order-none lg:w-auto">
          {view.versions.length > 1 && !view.draft && (
            <div className="flex items-center" role="group" aria-label="Versions">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous version"
                title="Previous version"
                disabled={view.index <= 0}
                onClick={() => onSelect(view.versions[view.index - 1].toolCallId)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next version"
                title="Next version"
                disabled={view.index >= view.versions.length - 1}
                onClick={() => onSelect(view.versions[view.index + 1].toolCallId)}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-0.5 lg:ml-0">
            {previewable && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={showSource ? "Show preview" : "Show source"}
                title={showSource ? "Show preview" : "Show source"}
                aria-pressed={showSource}
                disabled={writing}
                onClick={() => setShowSource((value) => !value)}
              >
                {showSource ? <Eye /> : <Code />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy document"
              title="Copy document"
              disabled={writing}
              onClick={() => {
                void writeText(document.content)
                  .then(() => toast.success("Document copied"))
                  .catch(() => toast.error("Could not copy the document"));
              }}
            >
              <Copy />
            </Button>
            {wordExport && canExportToWord(document) ? (
              <Menu.Root>
                <Menu.Trigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Download document"
                      title="Download"
                      disabled={writing || exporting}
                    />
                  }
                >
                  {exporting ? (
                    <Loader2 className={motionClasses.spinner} />
                  ) : (
                    <Download />
                  )}
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner side="bottom" align="end" sideOffset={4}>
                    <Menu.Popup
                      className={cn(
                        "z-50 w-48 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                        motionClasses.popup,
                      )}
                    >
                      <Menu.Item
                        onClick={download}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                      >
                        <FileDown className="size-3.5 shrink-0 text-muted-foreground" />
                        <span>Markdown (.md)</span>
                      </Menu.Item>
                      <Menu.Item
                        onClick={() => void exportWord()}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                      >
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span>Word (.docx)</span>
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Download document"
                title={`Download ${documentFilename(document)}`}
                disabled={writing}
                onClick={download}
              >
                <Download />
              </Button>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close document"
          title="Close document"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto" data-document-body="">
        {/* A saved version never changes, so remount when the shown version
            does; streamed rendering only expects text appended in place. */}
        <DocumentBody
          key={`${toolCallId}:${saved?.version ?? "draft"}:${sourceShown}`}
          document={document}
          source={sourceShown}
          writing={writing}
        />
      </div>
    </SidePanel>
  );
}

function DocumentBody({
  document,
  source,
  writing,
}: {
  document: ShownDocument;
  source: boolean;
  writing: boolean;
}) {
  if (source) {
    return (
      <div className="[&_[data-streamdown=code-block-header]]:hidden">
        <CodeBlock
          code={document.content}
          language={sourceLanguage(document)}
          isIncomplete={writing}
          className="my-0 min-h-full rounded-none border-0"
        />
      </div>
    );
  }
  switch (document.type) {
    case "markdown":
      return (
        <div className="mx-auto max-w-3xl px-6 py-5">
          <Streamdown
            className="font-sans space-y-3 text-[15px] leading-relaxed"
            plugins={MESSAGE_MARKDOWN_PLUGINS}
            mode={writing ? "streaming" : "static"}
          >
            {document.content}
          </Streamdown>
        </div>
      );
    case "html":
      return (
        <iframe
          title={`${document.title} preview`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={htmlPreviewDocument(document.content)}
          className="block size-full min-h-[24rem] border-0 bg-white"
        />
      );
    case "svg":
      return <SvgPreview source={document.content} />;
    case "mermaid":
      return <MermaidPreview source={document.content} />;
    default:
      return null;
  }
}

function sourceLanguage(document: ShownDocument): string {
  switch (document.type) {
    case "code":
      return document.language ?? "text";
    case "svg":
      return "xml";
    case "mermaid":
      return "text";
    default:
      return document.type;
  }
}

type LoadedImage = { url: string; width: number; height: number };

function useImage(svg: string | null) {
  const [state, setState] = useState<
    { source: string; image?: LoadedImage; error?: string } | null
  >(null);
  useEffect(() => {
    if (svg === null) return;
    let cancelled = false;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const image = new Image();
    image.src = url;
    image
      .decode()
      .then(() => {
        if (cancelled) return;
        if (!image.naturalWidth || !image.naturalHeight) {
          throw new Error("This image has no usable dimensions.");
        }
        setState({
          source: svg,
          image: { url, width: image.naturalWidth, height: image.naturalHeight },
        });
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setState({
            source: svg,
            error: reason instanceof Error ? reason.message : "Unable to render this image.",
          });
        }
      });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [svg]);
  return state?.source === svg ? state : null;
}

function PreviewStatus({ error }: { error?: string }) {
  return error ? (
    <p className="p-4 text-sm text-destructive" role="status">
      {error}
    </p>
  ) : (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" role="status">
      <Loader2 className={cn("size-4", motionClasses.spinner)} /> Rendering…
    </div>
  );
}

function SvgPreview({ source }: { source: string }) {
  const prepared = useMemo(() => {
    try {
      return { svg: svgPreviewSource(source) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Unable to render this SVG.",
      };
    }
  }, [source]);
  const loaded = useImage(prepared.svg ?? null);
  if (prepared.error) return <PreviewStatus error={prepared.error} />;
  if (!loaded?.image) return <PreviewStatus error={loaded?.error} />;
  return (
    <div className="flex size-full min-h-[24rem] flex-col">
      <DiagramViewport image={loaded.image} alt="SVG preview" fullscreen />
    </div>
  );
}

function MermaidPreview({ source }: { source: string }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [rendered, setRendered] = useState<
    { key: string; svg?: string; error?: string } | null
  >(null);
  const key = `${dark}:${source}`;
  useEffect(() => {
    let cancelled = false;
    void renderDiagram(source, dark, () => cancelled)
      .then((result) => {
        if (result && !cancelled) setRendered({ key, svg: result.svg });
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setRendered({
            key,
            error: reason instanceof Error ? reason.message : "Unable to render this diagram.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dark, key, source]);
  const current = rendered?.key === key ? rendered : null;
  const loaded = useImage(current?.svg ?? null);
  if (current?.error) return <PreviewStatus error={current.error} />;
  if (!loaded?.image) return <PreviewStatus error={loaded?.error} />;
  return (
    <div className="flex size-full min-h-[24rem] flex-col">
      <DiagramViewport image={loaded.image} alt="Diagram preview" fullscreen />
    </div>
  );
}
