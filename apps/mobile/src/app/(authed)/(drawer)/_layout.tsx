import { Drawer } from "expo-router/drawer";
import { useWindowDimensions } from "react-native";
import { AppDrawer } from "@/components/drawer/AppDrawer";
import { useTheme } from "@/lib/theme";

export default function DrawerLayout() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  return (
    <Drawer
      screenOptions={{
        drawerType: "front",
        swipeEdgeWidth: width,
        drawerStyle: { backgroundColor: colors.card, width: 300 },
        overlayColor: "rgba(0,0,0,0.4)",
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
      }}
      drawerContent={(props) => <AppDrawer {...props} />}
    >
      <Drawer.Screen name="chat" />
    </Drawer>
  );
}
