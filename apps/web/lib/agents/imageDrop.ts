import type { TFunction } from "i18next";
import type { FileDropLabel } from "@/components/chat/FileDropZone";

/** Drop-zone copy for agent sessions, which attach images and nothing else. */
export function agentImageDropLabels(providerLabel: string, t: TFunction): {
  overlay: FileDropLabel;
  refused: FileDropLabel;
} {
  return {
    overlay: {
      title: t("agents.composer.imageDropOverlayTitle"),
      description: t("agents.composer.imageDropOverlayDescription", {
        provider: providerLabel,
      }),
    },
    refused: {
      title: t("agents.composer.imageDropRefusedTitle"),
      description: t("agents.composer.imageDropRefusedDescription", {
        provider: providerLabel,
      }),
    },
  };
}
