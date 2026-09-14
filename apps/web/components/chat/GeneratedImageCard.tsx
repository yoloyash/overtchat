"use client";

import type { FileUIPart } from "ai";
import {
  IMAGE_SIZE_LABELS,
  isGeneratedImage,
  type ImageToolPart,
} from "@overtchat/shared";
import { Download, ImageIcon, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GeneratedImageCard({
  part,
  streaming,
  onReference,
}: {
  part: ImageToolPart;
  streaming: boolean;
  onReference?: (file: FileUIPart) => void;
}) {
  const pending =
    part.state === "input-streaming" || part.state === "input-available";
  const images = Array.isArray(part.output?.images)
    ? part.output.images.filter(isGeneratedImage)
    : [];
  return (
    <div className="my-3 w-full max-w-lg space-y-3" data-image-generation="">
      <div
        className="flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        {pending && streaming ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ImageIcon className="size-4" />
        )}
        {pending
          ? streaming
            ? part.type === "tool-edit_image"
              ? "Editing image…"
              : "Creating image…"
            : "Image generation stopped"
          : part.state === "output-error"
            ? "Image generation failed"
            : "Image created"}
      </div>
      {part.state === "output-error" && (
        <p className="text-sm text-destructive">
          {part.errorText ?? "The image could not be generated."}
        </p>
      )}
      {images.map((image) => (
        <div
          key={image.id}
          className="overflow-hidden rounded-xl border bg-card"
        >
          <a
            href={image.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open generated image"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={part.output?.prompt ?? "Generated image"}
              className="max-h-[32rem] w-full object-contain"
            />
          </a>
          <div className="flex flex-wrap items-center gap-2 p-2">
            <a
              href={image.url}
              download={image.filename}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent"
            >
              <Download className="size-3.5" /> Download
            </a>
            {onReference && (
              <Button
                size="sm"
                variant="ghost"
                disabled={streaming}
                onClick={() =>
                  onReference({
                    type: "file",
                    url: image.url,
                    mediaType: image.mediaType,
                    filename: image.filename,
                  })
                }
              >
                <Pencil className="size-3.5" /> Edit / Use as reference
              </Button>
            )}
          </div>
        </div>
      ))}
      {part.output && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {part.output.model} · Image details
          </summary>
          <p className="mt-2 whitespace-pre-wrap">{part.output.prompt}</p>
          <p className="mt-1">
            Requested format: {IMAGE_SIZE_LABELS[part.output.size] ?? "Auto"} ·
            Quality: {part.output.quality}
          </p>
        </details>
      )}
    </div>
  );
}
