"use client";
import { useTranslation } from "react-i18next";
import {
  IMAGE_SIZES,
  IMAGE_QUALITIES,
  type ImageGenerationOptions,
} from "@overtchat/shared";
import { X } from "lucide-react";

export function ImageOptions({
  value,
  model,
  supportsQuality = true,
  configuredSize,
  onChange,
  onClose,
}: {
  value: ImageGenerationOptions;
  model?: string | null;
  supportsQuality?: boolean;
  configuredSize?: string;
  onChange: (value: ImageGenerationOptions) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/60 px-3 py-2 text-xs">
      <span className="font-medium">
        {model
          ? t("chat.image.createTitleWithModel", { model })
          : t("chat.composer.createImage")}
      </span>
      {configuredSize ? (
        <span>
          {t("chat.image.sizeConfigured", {
            size:
              configuredSize === "auto"
                ? t("chat.image.backendDefault")
                : configuredSize,
          })}
        </span>
      ) : (
        <label className="flex items-center gap-1">
          {t("chat.image.sizeLabel")}
          <select
            aria-label={t("chat.image.imageSizeAria")}
            className="rounded border bg-background p-1"
            value={value.size}
            onChange={(event) =>
              onChange({
                ...value,
                size: event.target.value as ImageGenerationOptions["size"],
              })
            }
          >
            {IMAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {t(`chat.image.sizes.${size}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      {supportsQuality && (
        <label className="flex items-center gap-1">
          {t("chat.image.qualityLabel")}
          <select
            aria-label={t("chat.image.imageQualityAria")}
            className="rounded border bg-background p-1"
            value={value.quality}
            onChange={(event) =>
              onChange({
                ...value,
                quality: event.target
                  .value as ImageGenerationOptions["quality"],
              })
            }
          >
            {IMAGE_QUALITIES.map((quality) => (
              <option key={quality} value={quality}>
                {t(`chat.image.qualities.${quality}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label={t("chat.image.removeRequest")}
        className="ml-auto rounded p-1 hover:bg-accent"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
