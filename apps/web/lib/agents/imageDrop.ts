import type { FileDropLabel } from "@/components/chat/FileDropZone";
import { i18n } from "@overtchat/shared/i18n";

/** Drop-zone copy for agent sessions, which attach images and nothing else. */
export function agentImageDropLabels(providerLabel: string): {
  overlay: FileDropLabel;
  refused: FileDropLabel;
} {
  return {
    overlay: {
      title: i18n.t("agents.composer.imageDropOverlayTitle"),
      description: i18n.t("agents.composer.imageDropOverlayDescription", {
        provider: providerLabel,
      }),
    },
    refused: {
      title: i18n.t("agents.composer.imageDropRefusedTitle"),
      description: i18n.t("agents.composer.imageDropRefusedDescription", {
        provider: providerLabel,
      }),
    },
  };
}
