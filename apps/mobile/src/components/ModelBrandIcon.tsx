import { modelBrandIconData, type ModelBrandIconId } from "@overtchat/shared";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

export function ModelBrandIcon({
  iconId,
  color,
  size = 16,
  style,
}: {
  iconId: ModelBrandIconId | null | undefined;
  color: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const icon = modelBrandIconData(iconId);
  if (!icon) return null;

  return (
    <Svg
      accessible={false}
      width={size}
      height={size}
      viewBox={icon.viewBox}
      style={style}
    >
      {icon.paths.map((path, index) => (
        <Path
          key={index}
          d={path.d}
          fill={color}
          fillRule={path.fillRule}
          clipRule={path.fillRule}
        />
      ))}
    </Svg>
  );
}
