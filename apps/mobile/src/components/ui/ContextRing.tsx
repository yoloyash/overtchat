import Svg, { Circle } from "react-native-svg";
import type { ContextMeterValues } from "@overtchat/shared/context-meter";
import { useTheme } from "@/lib/theme";

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Stroke color for a context reading: muted, then warning, then critical. */
export function useContextTone(
  values: ContextMeterValues | undefined,
): string {
  const { colors, scheme } = useTheme();
  if (values?.critical) return colors.destructive;
  // sRGB equivalents of web's --context-warning colors.
  if (values?.warning) return scheme === "dark" ? "#e1a447" : "#a36500";
  return colors.mutedForeground;
}

/**
 * Context-window usage as a ring, shared by the chat and agent composers. A
 * dashed ring stands in while the limit or the reading is unknown.
 */
export function ContextRing({
  values,
  size = 24,
}: {
  values: ContextMeterValues | undefined;
  size?: number;
}) {
  const { colors } = useTheme();
  const tone = useContextTone(values);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Circle
        cx={12}
        cy={12}
        r={RADIUS}
        fill="none"
        stroke={colors.border}
        strokeWidth={2.5}
      />
      {values?.percentage !== undefined ? (
        values.ringPercentage > 0 && (
          <Circle
            cx={12}
            cy={12}
            r={RADIUS}
            fill="none"
            stroke={tone}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={CIRCUMFERENCE * (1 - values.ringPercentage / 100)}
            rotation={-90}
            origin="12, 12"
          />
        )
      ) : (
        <Circle
          cx={12}
          cy={12}
          r={RADIUS}
          fill="none"
          stroke={tone}
          strokeWidth={2.5}
          strokeDasharray="2 4"
        />
      )}
    </Svg>
  );
}
