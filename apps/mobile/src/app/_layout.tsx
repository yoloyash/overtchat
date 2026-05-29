import "@/polyfills";

import * as Sentry from "@sentry/react-native";
import {
  Fraunces_600SemiBold,
} from "@expo-google-fonts/fraunces";
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
} from "@expo-google-fonts/geist";
import {
  GeistMono_400Regular,
} from "@expo-google-fonts/geist-mono";
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
} from "@expo-google-fonts/ibm-plex-sans";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import {
  Roboto_400Regular,
  Roboto_500Medium,
  Roboto_600SemiBold,
} from "@expo-google-fonts/roboto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAudioModeAsync } from "expo-audio";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useState } from "react";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { getAuthClient } from "@/lib/auth/client";
import { useServerUrl } from "@/lib/server-url";
import { useTheme } from "@/lib/theme";

SplashScreen.preventAutoHideAsync();

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    debug: __DEV__,
    sendDefaultPii: false,
  });
}

function RootLayout() {
  const { colors, scheme } = useTheme();
  const [queryClient] = useState(() => new QueryClient());

  const [loaded, error] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    Fraunces_600SemiBold,
    GeistMono_400Regular,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Roboto_400Regular,
    Roboto_500Medium,
    Roboto_600SemiBold,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
  });

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(
      () => {},
    );
  }, []);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <BottomSheetModalProvider>
              <StatusBar style={scheme === "dark" ? "light" : "dark"} />
              <AuthRoutes backgroundColor={colors.background} />
            </BottomSheetModalProvider>
          </SafeAreaProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function AuthRoutes({ backgroundColor }: { backgroundColor: string }) {
  const serverUrl = useServerUrl();

  if (!serverUrl) {
    return (
      <RootStack
        authReady
        hasServer={false}
        hasSession={false}
        backgroundColor={backgroundColor}
      />
    );
  }

  return <SessionRoutes key={serverUrl} backgroundColor={backgroundColor} />;
}

function SessionRoutes({ backgroundColor }: { backgroundColor: string }) {
  const session = getAuthClient().useSession();
  return (
    <RootStack
      authReady={!session.isPending}
      hasServer
      hasSession={Boolean(session.data?.user)}
      backgroundColor={backgroundColor}
    />
  );
}

function RootStack({
  authReady,
  hasServer,
  hasSession,
  backgroundColor,
}: {
  authReady: boolean;
  hasServer: boolean;
  hasSession: boolean;
  backgroundColor: string;
}) {
  useEffect(() => {
    if (authReady) SplashScreen.hideAsync();
  }, [authReady]);

  if (!authReady) return null;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor },
      }}
    >
      <Stack.Protected guard={!hasServer && !hasSession}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={hasServer && !hasSession}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={!hasSession}>
        <Stack.Screen name="server" />
      </Stack.Protected>
      <Stack.Protected guard={hasServer && hasSession}>
        <Stack.Screen name="(authed)" />
      </Stack.Protected>
    </Stack>
  );
}

export default Sentry.wrap(RootLayout);
