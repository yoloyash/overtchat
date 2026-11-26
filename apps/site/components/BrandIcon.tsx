import { MODEL_BRAND_ICONS, type ModelBrandIconData } from "@overtchat/shared";

export type BrandIconId = keyof typeof MODEL_BRAND_ICONS;

/** A provider or runtime mark from the shared icon set, drawn in the text color. */
export function BrandIcon({ id }: { id: BrandIconId }) {
  const icon: ModelBrandIconData = MODEL_BRAND_ICONS[id];

  return (
    <svg viewBox={icon.viewBox} fill="currentColor" aria-hidden="true">
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
