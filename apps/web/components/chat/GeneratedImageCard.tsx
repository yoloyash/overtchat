"use client";

import type { FileUIPart } from "ai";
import { useTranslation } from "react-i18next";
import {
  isGeneratedImage,
  type ImageToolPart,
} from "@overtchat/shared";
import { Download, ImageIcon, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { serverUrl } from "@/lib/api-url";
import { isSharedGeneratedImage } from "@/lib/sharing";

export function GeneratedImageCard({
  part,
  streaming,
  onReference,
  readOnly = false,
}: {
  part: ImageToolPart;
  streaming: boolean;
  onReference?: (file: FileUIPart) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const pending =
    part.state === "input-streaming" || part.state === "input-available";
  const images = Array.isArray(part.output?.images)
    ? part.output.images.filter((image) => isGeneratedImage(image) || (readOnly && isSharedGeneratedImage(image)))
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
              ? t("chat.image.editing")
              : t("chat.image.creating")
            : t("chat.image.stopped")
          : part.state === "output-error"
            ? t("chat.image.failed")
            : t("chat.image.created")}
      </div>
      {part.state === "output-error" && (
        <p className="text-sm text-destructive">
          {part.errorText ?? t("chat.image.generationFailedFallback")}
        </p>
      )}
      {images.map((image) => (
        <div
          key={image.id}
          className="overflow-hidden rounded-xl border bg-card"
        >
          <a
            href={serverUrl(image.url)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("chat.image.openGenerated")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={serverUrl(image.url)}
              alt={part.output?.prompt ?? t("chat.image.generatedAlt")}
              className="max-h-[32rem] w-full object-contain"
            />
          </a>
          <div className="flex flex-wrap items-center gap-2 p-2">
            <a
              href={serverUrl(image.url)}
              download={image.filename}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent"
            >
              <Download className="size-3.5" /> {t("common.actions.download")}
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
                <Pencil className="size-3.5" /> {t("chat.image.editOrReference")}
              </Button>
            )}
          </div>
        </div>
      ))}
      {part.output && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {t("chat.image.detailsSummary", { model: part.output.model })}
          </summary>
          <p className="mt-2 whitespace-pre-wrap">{part.output.prompt}</p>
          <p className="mt-1">
            {(() => {
              const format =
                part.output.providerSize === "auto"
                  ? t("chat.image.backendDefault")
                  : (part.output.providerSize ??
                    (part.output.size in
                    { auto: 1, "1024x1024": 1, "1536x1024": 1, "1024x1536": 1 }
                      ? t(`chat.image.sizes.${part.output.size}`)
                      : t("chat.image.auto")));
              return part.output.providerSize === undefined
                ? t("chat.image.requestedFormatWithQuality", {
                    format,
                    quality: t(`chat.image.qualities.${part.output.quality}`),
                  })
                : t("chat.image.requestedFormat", { format });
            })()}
          </p>
        </details>
      )}
    </div>
  );
}
