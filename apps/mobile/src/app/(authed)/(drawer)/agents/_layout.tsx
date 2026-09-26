import { Stack } from "expo-router";
import { DrawerToggleButton } from "expo-router/build/react-navigation/drawer";
import { useTheme } from "@/lib/theme";

export const unstable_settings = { initialRouteName: "index" };

export default function AgentsLayout() {
  const { colors } = useTheme();
  const drawerOptions = {
    headerLeft: () => <DrawerToggleButton tintColor={colors.foreground} />,
  };
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Agents", ...drawerOptions }}
      />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="new" options={{ title: "New agent chat" }} />
      <Stack.Screen name="workspace" />
    </Stack>
  );
}
