import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { StreamdownTranslations } from "streamdown";

/** The markdown renderer's own button and dialog labels, in the active language. */
export function useMarkdownLabels(): Partial<StreamdownTranslations> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      copyCode: t("common.markdown.copyCode"),
      downloadFile: t("common.markdown.downloadFile"),
      downloadDiagram: t("common.markdown.downloadDiagram"),
      downloadDiagramAsSvg: t("common.markdown.downloadDiagramAsSvg"),
      downloadDiagramAsPng: t("common.markdown.downloadDiagramAsPng"),
      downloadDiagramAsMmd: t("common.markdown.downloadDiagramAsMmd"),
      viewFullscreen: t("common.markdown.viewFullscreen"),
      exitFullscreen: t("common.markdown.exitFullscreen"),
      copyTable: t("common.markdown.copyTable"),
      copyTableAsMarkdown: t("common.markdown.copyTableAsMarkdown"),
      copyTableAsCsv: t("common.markdown.copyTableAsCsv"),
      copyTableAsTsv: t("common.markdown.copyTableAsTsv"),
      downloadTable: t("common.markdown.downloadTable"),
      downloadTableAsCsv: t("common.markdown.downloadTableAsCsv"),
      downloadTableAsMarkdown: t("common.markdown.downloadTableAsMarkdown"),
      imageNotAvailable: t("common.markdown.imageNotAvailable"),
      downloadImage: t("common.markdown.downloadImage"),
      openExternalLink: t("common.markdown.openExternalLink"),
      externalLinkWarning: t("common.markdown.externalLinkWarning"),
      close: t("common.markdown.close"),
      copyLink: t("common.markdown.copyLink"),
      copied: t("common.markdown.copied"),
      openLink: t("common.markdown.openLink"),
    }),
    [t],
  );
}
