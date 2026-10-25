import { Stack, router } from "expo-router";
import { HeaderBackButton } from "expo-router/build/react-navigation/elements";
import { useTheme } from "@/lib/theme";

// Deep links into a settings page still return to the settings list.
export const unstable_settings = { initialRouteName: "index" };

export default function SettingsLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          // The list is the root of this stack, so leave settings explicitly.
          headerLeft: (props) => (
            <HeaderBackButton
              {...props}
              label="Back"
              tintColor={colors.foreground}
              onPress={() => router.back()}
            />
          ),
        }}
      />
    </Stack>
  );
}
