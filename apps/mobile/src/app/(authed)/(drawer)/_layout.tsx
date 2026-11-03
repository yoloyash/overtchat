import { Drawer } from "expo-router/drawer";
import { getFocusedRouteNameFromRoute } from "expo-router/react-navigation";
import { AppDrawer } from "@/components/drawer/AppDrawer";
import { useTheme } from "@/lib/theme";

export { RouteErrorBoundary as ErrorBoundary } from "@/components/RouteErrorBoundary";

export default function DrawerLayout() {
  const { colors } = useTheme();
  return (
    <Drawer
      screenOptions={{
        drawerType: "front",
        swipeEdgeWidth: 32,
        drawerStyle: { backgroundColor: colors.card, width: 300 },
        overlayColor: "rgba(0,0,0,0.4)",
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
      }}
      // Android Back returns to the screen the user came from, so leaving an
      // agent conversation lands on the list or chat that opened it.
      backBehavior="history"
      drawerContent={(props) => <AppDrawer {...props} />}
    >
      <Drawer.Screen name="chat" />
      {/* A conversation is a destination like a chat: the menu button opens
          the drawer. The Agents stack below holds the new-session home,
          history and folders. */}
      <Drawer.Screen
        name="agent/[id]"
        options={{ title: "", headerTitleAlign: "left" }}
      />
      <Drawer.Screen
        name="agents"
        options={({ route }) => ({
          headerShown: false,
          // Deeper agent screens keep their native Back gesture. The menu
          // button still opens the drawer from a conversation.
          swipeEnabled: (getFocusedRouteNameFromRoute(route) ?? "index") === "index",
        })}
      />
    </Drawer>
  );
}
