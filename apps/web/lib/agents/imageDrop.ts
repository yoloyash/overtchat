import type { FileDropLabel } from "@/components/chat/FileDropZone";

/** Drop-zone copy for agent sessions, which attach images and nothing else. */
export function agentImageDropLabels(providerLabel: string): {
  overlay: FileDropLabel;
  refused: FileDropLabel;
} {
  return {
    overlay: {
      title: "Drop images to attach",
      description: `PNG, JPEG, GIF, or WebP for ${providerLabel}. Mention other files by path.`,
    },
    refused: {
      title: "This model does not accept images",
      description: `Pick a ${providerLabel} model with image input to attach one.`,
    },
  };
}
