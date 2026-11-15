import "@/polyfills";
import "@/lib/notifications/client";

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
import { getChatQueueStore } from "@overtchat/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isRunningInExpoGo } from "expo";
import { setAudioModeAsync } from "expo-audio";
import { useFonts } from "expo-font";
import { Stack, useNavigationContainerRef } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { getAuthClient } from "@/lib/auth/client";
import { LAUNCH_SESSION_WAIT_MS, sessionKnown } from "@/lib/auth/launch";
import { useServerUrl } from "@/lib/server-url";
import { useTheme } from "@/lib/theme";

export { RouteErrorBoundary as ErrorBoundary } from "@/components/RouteErrorBoundary";

SplashScreen.preventAutoHideAsync();

// Must be stored in EAS with plain-text visibility: releases build with
// `eas build --local`, which never receives secret-visibility variables.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
// Records the current route on every event, sampled or not, so crashes and
// ANRs say which screen they happened on.
const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: !isRunningInExpoGo(),
});
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    debug: __DEV__,
    sendDefaultPii: false,
    integrations: [navigationIntegration],
    tracesSampleRate: __DEV__ ? 1 : 0.1,
    enableNativeFramesTracking: !isRunningInExpoGo(),
    environment:
      process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ??
      (__DEV__ ? "development" : "production"),
  });
} else if (__DEV__) {
  console.warn(
    "[sentry] EXPO_PUBLIC_SENTRY_DSN is unset — crash reporting is disabled.",
  );
}

function RootLayout() {
  const { colors, scheme } = useTheme();
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    if (navigationRef)
      navigationIntegration.registerNavigationContainer(navigationRef);
  }, [navigationRef]);

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
        <SafeAreaProvider>
          <BottomSheetModalProvider>
            <StatusBar style={scheme === "dark" ? "light" : "dark"} />
            <AuthRoutes backgroundColor={colors.background} />
          </BottomSheetModalProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function AuthRoutes({ backgroundColor }: { backgroundColor: string }) {
  const serverUrl = useServerUrl();
  // Set once the first screens are up, or the launch has waited long enough.
  const [launched, setLaunched] = useState(false);
  const markLaunched = useCallback(() => setLaunched(true), []);
  useEffect(() => {
    const timer = setTimeout(markLaunched, LAUNCH_SESSION_WAIT_MS);
    return () => clearTimeout(timer);
  }, [markLaunched]);

  if (!serverUrl) {
    return (
      <QueryClientScope>
        <RootStack
          authReady
          onReady={markLaunched}
          hasServer={false}
          hasSession={false}
          backgroundColor={backgroundColor}
        />
      </QueryClientScope>
    );
  }

  return (
    <SessionRoutes
      key={serverUrl}
      launched={launched}
      onReady={markLaunched}
      backgroundColor={backgroundColor}
    />
  );
}

function SessionRoutes({
  launched,
  onReady,
  backgroundColor,
}: {
  launched: boolean;
  onReady: () => void;
  backgroundColor: string;
}) {
  const session = getAuthClient().useSession();
  const userId = session.data?.user.id ?? "signed-out";
  return (
    <QueryClientScope key={userId}>
      <RootStack
        // The launch waits behind the splash screen until the session is
        // known. After it, a check in flight leaves the screens up: a
        // signed-out recheck reports an unknown session again, and unmounting
        // the login form would reset its two-factor step. A newly chosen
        // server still starts from an empty stack, before its first check.
        authReady={
          launched
            ? !session.isPending || session.isRefetching
            : sessionKnown(session)
        }
        onReady={onReady}
        hasServer
        hasSession={Boolean(session.data?.user)}
        backgroundColor={backgroundColor}
      />
    </QueryClientScope>
  );
}

function QueryClientScope({ children }: { children: ReactNode }) {
  // This component is remounted when the selected server or authenticated user
  // changes, so server state can never bleed across either identity boundary.
  const [client] = useState(() => new QueryClient());
  useEffect(() => () => getChatQueueStore(client).clear(), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function RootStack({
  authReady,
  onReady,
  hasServer,
  hasSession,
  backgroundColor,
}: {
  authReady: boolean;
  onReady: () => void;
  hasServer: boolean;
  hasSession: boolean;
  backgroundColor: string;
}) {
  useEffect(() => {
    if (!authReady) return;
    SplashScreen.hideAsync();
    onReady();
  }, [authReady, onReady]);

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
