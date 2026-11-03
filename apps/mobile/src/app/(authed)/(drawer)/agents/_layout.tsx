import { Stack } from "expo-router";
import { DrawerToggleButton } from "expo-router/build/react-navigation/drawer";
import { useTheme } from "@/lib/theme";

export { RouteErrorBoundary as ErrorBoundary } from "@/components/RouteErrorBoundary";

export const unstable_settings = { initialRouteName: "index" };

/**
 * The Agents half's own screens: a new session (the home, with the drawer
 * button), history, and a folder. Conversations are drawer destinations
 * beside the chat screen instead.
 */
export default function AgentsLayout() {
  const { colors } = useTheme();
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
        options={{
          title: "New agent",
          headerLeft: () => <DrawerToggleButton tintColor={colors.foreground} />,
        }}
      />
      <Stack.Screen name="history" options={{ title: "History" }} />
      <Stack.Screen name="workspace" />
    </Stack>
  );
}
