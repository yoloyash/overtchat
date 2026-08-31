import { Ionicons } from "@expo/vector-icons";
import type { PersonalizationSnapshot } from "@overtchat/shared";
import { Stack } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MemoryManager } from "@/components/personalization/MemoryManager";
import { PersonalizationProfile } from "@/components/personalization/PersonalizationProfile";
import { usePersonalization } from "@/lib/queries/personalization";
import { getServerUrl } from "@/lib/server-url";
import { useTheme } from "@/lib/theme";

export default function PersonalizationScreen() {
  const { colors, fonts } = useTheme();
  const personalization = usePersonalization();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: () => (
            <Text
              style={{
                color: colors.foreground,
                fontFamily: fonts.serifSemiBold,
                fontSize: 18,
              }}
            >
              Personalization
            </Text>
          ),
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          headerBackTitle: "Settings",
        }}
      />
      <KeyboardAvoidingView
        style={[styles.root, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SafeAreaView
          style={styles.root}
          edges={["bottom", "left", "right"]}
        >
          {personalization.isPending ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.mutedForeground} />
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: fonts.sansRegular,
                }}
              >
                Loading personalization…
              </Text>
            </View>
          ) : personalization.error || !personalization.data ? (
            <LoadError
              message={
                personalization.error?.message ??
                "Unable to load personalization."
              }
              onRetry={() => void personalization.refetch()}
            />
          ) : (
            <PersonalizationContent
              data={personalization.data}
              refreshing={personalization.isRefetching}
              onRefresh={() => void personalization.refetch()}
            />
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </>
  );
}

function PersonalizationContent({
  data,
  refreshing,
  onRefresh,
}: {
  data: PersonalizationSnapshot;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.mutedForeground}
        />
      }
    >
      <View style={styles.pageHeader}>
        <Text
          style={[
            styles.pageDescription,
            {
              color: colors.mutedForeground,
              fontFamily: fonts.sansRegular,
            },
          ]}
        >
          Tell OvertChat about you and manage what it remembers between chats.
        </Text>
      </View>
      <PersonalizationProfile
        key={JSON.stringify(data.personalization)}
        personalization={data.personalization}
      />
      <MemoryManager memories={data.memories} usage={data.contextUsage} />
    </ScrollView>
  );
}

function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <View style={styles.center}>
      <Ionicons
        name="alert-circle-outline"
        size={28}
        color={colors.destructive}
      />
      <Text
        accessibilityRole="alert"
        style={[
          styles.loadError,
          { color: colors.foreground, fontFamily: fonts.sansRegular },
        ]}
      >
        {message}
      </Text>
      <View style={styles.errorActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.errorButton,
            {
              backgroundColor: colors.primary,
              borderColor: "transparent",
              borderRadius: radii.md,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.buttonText,
              {
                color: colors.primaryForeground,
                fontFamily: fonts.sansSemiBold,
              },
            ]}
          >
            Retry
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => openOnWeb("/settings/personalization")}
          style={({ pressed }) => [
            styles.errorButton,
            {
              borderColor: colors.border,
              borderRadius: radii.md,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.buttonText,
              { color: colors.foreground, fontFamily: fonts.sansSemiBold },
            ]}
          >
            Open on web
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function openOnWeb(path: string) {
  const serverUrl = getServerUrl();
  if (!serverUrl) return;
  Linking.openURL(`${serverUrl.replace(/\/$/, "")}${path}`).catch(() => {});
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 28,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
    gap: 24,
  },
  pageHeader: { paddingHorizontal: 4 },
  pageDescription: { fontSize: 13, lineHeight: 19 },
  loadError: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  errorActions: { flexDirection: "row", gap: 8 },
  errorButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: { fontSize: 14 },
});
