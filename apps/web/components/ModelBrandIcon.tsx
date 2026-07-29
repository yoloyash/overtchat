"use client";

import { modelBrandIconData, type ModelBrandIconId } from "@overtchat/shared";
import { cn } from "@/lib/utils";

export function ModelBrandIcon({
  iconId,
  className,
  title,
}: {
  iconId: ModelBrandIconId | null | undefined;
  className?: string;
  title?: string;
}) {
  const icon = modelBrandIconData(iconId);
  if (!icon) return null;

  return (
    <svg
      aria-hidden
      viewBox={icon.viewBox}
      fill="currentColor"
      className={cn(
        "inline-block size-4 shrink-0 text-muted-foreground",
        className,
      )}
    >
      <title>{title ?? icon.label}</title>
      {icon.paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          fill={path.filled === false ? "none" : undefined}
          fillRule={path.fillRule}
          clipRule={path.fillRule}
          stroke={path.strokeWidth === undefined ? undefined : "currentColor"}
          strokeWidth={path.strokeWidth}
          strokeLinecap={path.strokeLinecap}
          strokeLinejoin={path.strokeLinejoin}
        />
      ))}
    </svg>
  );
}
