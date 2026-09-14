"use client";
import {
  IMAGE_SIZES,
  IMAGE_SIZE_LABELS,
  IMAGE_QUALITIES,
  type ImageGenerationOptions,
} from "@overtchat/shared";
import { X } from "lucide-react";

export function ImageOptions({
  value,
  model,
  supportsQuality = true,
  onChange,
  onClose,
}: {
  value: ImageGenerationOptions;
  model?: string | null;
  supportsQuality?: boolean;
  onChange: (value: ImageGenerationOptions) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/60 px-3 py-2 text-xs">
      <span className="font-medium">
        Create image{model ? ` · ${model}` : ""}
      </span>
      <label className="flex items-center gap-1">
        Size
        <select
          aria-label="Image size"
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
              {IMAGE_SIZE_LABELS[size]}
            </option>
          ))}
        </select>
      </label>
      {supportsQuality && (
        <label className="flex items-center gap-1">
          Quality
          <select
            aria-label="Image quality"
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
                {quality}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Remove image request"
        className="ml-auto rounded p-1 hover:bg-accent"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
