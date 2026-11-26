"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Menu } from "@base-ui/react/menu";
import type { UIMessage } from "ai";
import { useTheme } from "next-themes";
import { writeText } from "clipboard-polyfill";
import { CodeBlock, Streamdown } from "streamdown";
import { useMarkdownLabels } from "@/lib/chat/useMarkdownLabels";
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
import { BackToFilesButton } from "./ChatFiles";
import { SidePanel, SidePanelHeader } from "./SidePanel";
import { SaveToProjectButton } from "@/components/projects/SaveToProjectButton";

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
  onBack,
  onClose,
}: {
  messages: UIMessage[];
  toolCallId: string;
  streaming: boolean;
  variant?: "docked" | "overlay";
  /** Word export converts on the server and needs a signed-in session. */
  wordExport?: boolean;
  onSelect: (toolCallId: string) => void;
  /** Returns to the panel's list of files, where there is one. */
  onBack?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const view = useMemo(
    () => documentView(messages, toolCallId, t),
    [messages, toolCallId, t],
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
      ? t("chat.documents.writing")
      : t("chat.documents.notSaved")
    : view.updating && streaming
      ? t("chat.documents.versionUpdating", { version: saved.version })
      : t("chat.documents.versionOf", {
          version: saved.version,
          total: view.versions.at(-1)!.version,
        });

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
        title: t("chat.documents.exportFailedTitle"),
        description: t("chat.errors.checkConnection"),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <SidePanel
      aria-label={t("chat.documents.panelLabel", { title: document.title })}
      data-document-panel=""
      variant={variant}
      onClose={onClose}
    >
      {/* One row in a wide panel; a narrow one moves the toolbar below the
          title so the title stays readable. */}
      <SidePanelHeader className="flex-wrap gap-x-2 gap-y-1">
        {onBack && <BackToFilesButton onClick={onBack} />}
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
            {t(`chat.documents.types.${document.type}`)}
            {document.type === "code" && document.language
              ? ` · ${document.language}`
              : ""}{" "}
            · {status}
          </p>
        </div>
        <div className="order-last flex w-full items-center gap-0.5 @md/panel:order-none @md/panel:w-auto">
          {view.versions.length > 1 && !view.draft && (
            <div className="flex items-center" role="group" aria-label={t("chat.documents.versions")}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("chat.documents.previousVersion")}
                title={t("chat.documents.previousVersion")}
                disabled={view.index <= 0}
                onClick={() => onSelect(view.versions[view.index - 1].toolCallId)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("chat.documents.nextVersion")}
                title={t("chat.documents.nextVersion")}
                disabled={view.index >= view.versions.length - 1}
                onClick={() => onSelect(view.versions[view.index + 1].toolCallId)}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-0.5 @md/panel:ml-0">
            {previewable && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={showSource ? t("chat.files.showPreview") : t("chat.files.showSource")}
                title={showSource ? t("chat.files.showPreview") : t("chat.files.showSource")}
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
              aria-label={t("chat.documents.copyDocument")}
              title={t("chat.documents.copyDocument")}
              disabled={writing}
              onClick={() => {
                void writeText(document.content)
                  .then(() => toast.success(t("chat.documents.documentCopied")))
                  .catch(() => toast.error(t("chat.documents.copyDocumentFailed")));
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
                      aria-label={t("chat.documents.downloadDocument")}
                      title={t("common.actions.download")}
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
                        {/* eslint-disable-next-line i18next/no-literal-string -- Format name and file extension */}
                        <span>Markdown (.md)</span>
                      </Menu.Item>
                      <Menu.Item
                        onClick={() => void exportWord()}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                      >
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        {/* eslint-disable-next-line i18next/no-literal-string -- Product name and file extension */}
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
                aria-label={t("chat.documents.downloadDocument")}
                title={t("chat.files.downloadNamed", { name: documentFilename(document) })}
                disabled={writing}
                onClick={download}
              >
                <Download />
              </Button>
            )}
            <SaveToProjectButton
              source={{ kind: "document", document }}
              disabled={writing}
            />
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("chat.documents.closeDocument")}
          title={t("chat.documents.closeDocument")}
          onClick={onClose}
        >
          <X />
        </Button>
      </SidePanelHeader>
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
  const markdownLabels = useMarkdownLabels();
  const { t } = useTranslation();
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
            translations={markdownLabels}
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
          title={t("chat.files.previewTitle", { name: document.title })}
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

type PreviewError =
  | {
      kind:
        | "imageNoDimensions"
        | "imageRenderFailed"
        | "svgRenderFailed"
        | "diagramRenderFailed";
    }
  | { kind: "raw"; message: string };

function useImage(svg: string | null) {
  const [state, setState] = useState<
    { source: string; image?: LoadedImage; error?: PreviewError } | null
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
          setState({ source: svg, error: { kind: "imageNoDimensions" } });
          return;
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
            error:
              reason instanceof Error
                ? { kind: "raw", message: reason.message }
                : { kind: "imageRenderFailed" },
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

function PreviewStatus({ error }: { error?: PreviewError }) {
  const { t } = useTranslation();
  return error ? (
    <p className="p-4 text-sm text-destructive" role="status">
      {error.kind === "raw"
        ? error.message
        : t(`chat.documents.${error.kind}`)}
    </p>
  ) : (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" role="status">
      <Loader2 className={cn("size-4", motionClasses.spinner)} /> {t("chat.documents.rendering")}
    </div>
  );
}

function SvgPreview({ source }: { source: string }) {
  const { t } = useTranslation();
  const prepared = useMemo((): { svg?: string; error?: PreviewError } => {
    try {
      return { svg: svgPreviewSource(source, t) };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? { kind: "raw", message: error.message }
            : { kind: "svgRenderFailed" },
      };
    }
  }, [source, t]);
  const loaded = useImage(prepared.svg ?? null);
  if (prepared.error) return <PreviewStatus error={prepared.error} />;
  if (!loaded?.image) return <PreviewStatus error={loaded?.error} />;
  return (
    <div className="flex size-full min-h-[24rem] flex-col">
      <DiagramViewport image={loaded.image} alt={t("chat.documents.svgPreviewAlt")} fullscreen />
    </div>
  );
}

function MermaidPreview({ source }: { source: string }) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [rendered, setRendered] = useState<
    { key: string; svg?: string; error?: PreviewError } | null
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
            error:
              reason instanceof Error
                ? { kind: "raw", message: reason.message }
                : { kind: "diagramRenderFailed" },
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
      <DiagramViewport image={loaded.image} alt={t("chat.documents.diagramPreviewAlt")} fullscreen />
    </div>
  );
}
