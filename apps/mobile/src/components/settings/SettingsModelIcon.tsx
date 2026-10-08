import { Ionicons } from "@expo/vector-icons";
import {
  modelIconForModel,
  PROVIDERS,
  type ProviderId,
} from "@overtchat/shared/provider-catalog";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { useTheme } from "@/lib/theme";

export function SettingsModelIcon({
  provider,
  model,
}: {
  provider: ProviderId;
  model?: string;
}) {
  const { colors } = useTheme();
  const iconId =
    (model ? modelIconForModel(model) : null) ?? PROVIDERS[provider].iconId;
  return iconId ? (
    <ModelBrandIcon iconId={iconId} color={colors.foreground} size={24} />
  ) : (
    <Ionicons name="cube-outline" size={24} color={colors.mutedForeground} />
  );
}
