import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useState, type ReactNode } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthClient } from "@/lib/auth/client";
import { setThemePref, useThemePref, type ThemePref } from "@/lib/appearance";
import { getServerUrl } from "@/lib/server-url";
import { useTheme } from "@/lib/theme";

export default function SettingsScreen() {
  const { colors, radii, fonts } = useTheme();
  const session = getAuthClient().useSession();
  const user = session.data?.user as
    | { name?: string | null; email?: string | null; role?: string | null }
    | undefined;
  const isAdmin = user?.role === "admin";

  const themePref = useThemePref();
  const [signingOut, setSigningOut] = useState(false);
  const serverUrl = getServerUrl();
  const serverHost = serverUrl ? safeHost(serverUrl) : null;

  function openOnWeb(path: string) {
    if (!serverUrl) return;
    Linking.openURL(`${serverUrl.replace(/\/$/, "")}${path}`).catch(() => {});
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await getAuthClient().signOut();
      router.replace("/");
    } finally {
      setSigningOut(false);
    }
  }

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
              Settings
            </Text>
          ),
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          headerBackTitle: "Back",
        }}
      />
      <SafeAreaView
        style={[styles.root, { backgroundColor: colors.background }]}
        edges={["bottom", "left", "right"]}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <Section title="Account">
            <Row label="Name" right={user?.name ?? "—"} />
            <Row label="Email" right={user?.email ?? "—"} />
          </Section>

          <Section title="Appearance">
            {(
              [
                { key: "system", label: "System" },
                { key: "light", label: "Light" },
                { key: "dark", label: "Dark" },
              ] as { key: ThemePref; label: string }[]
            ).map((opt) => (
              <Pressable
                key={opt.key}
                onPress={() => setThemePref(opt.key)}
                style={({ pressed }) => [
                  styles.row,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text
                  style={[
                    styles.rowLabel,
                    { color: colors.foreground, fontFamily: fonts.sansRegular },
                  ]}
                >
                  {opt.label}
                </Text>
                <View
                  style={[
                    styles.radio,
                    {
                      borderColor:
                        themePref === opt.key ? colors.primary : colors.border,
                    },
                  ]}
                >
                  {themePref === opt.key ? (
                    <View
                      style={[
                        styles.radioDot,
                        { backgroundColor: colors.primary },
                      ]}
                    />
                  ) : null}
                </View>
              </Pressable>
            ))}
          </Section>

          <Section title="Manage on web">
            <LinkRow
              label="Account"
              sub="Name, email, password, sessions"
              onPress={() => openOnWeb("/settings/account")}
              colors={colors}
              fonts={fonts}
            />
            <LinkRow
              label="Data"
              sub="Export, delete chats"
              onPress={() => openOnWeb("/settings/data")}
              colors={colors}
              fonts={fonts}
            />
            {isAdmin ? (
              <>
                <LinkRow
                  label="Models"
                  sub="Provider config and access"
                  onPress={() => openOnWeb("/settings/models")}
                  colors={colors}
                  fonts={fonts}
                />
                <LinkRow
                  label="Users"
                  sub="Invite and manage members"
                  onPress={() => openOnWeb("/settings/users")}
                  colors={colors}
                  fonts={fonts}
                />
              </>
            ) : null}
            {serverHost ? (
              <View style={[styles.row, { paddingTop: 4 }]}>
                <Text
                  style={[
                    styles.rowSub,
                    {
                      color: colors.mutedForeground,
                      fontFamily: fonts.sansRegular,
                    },
                  ]}
                >
                  Opens {serverHost} in your browser
                </Text>
              </View>
            ) : null}
          </Section>

          <Pressable
            accessibilityRole="button"
            onPress={handleSignOut}
            disabled={signingOut}
            style={({ pressed }) => [
              styles.signOut,
              {
                backgroundColor: colors.muted,
                borderRadius: radii.lg,
                opacity: pressed || signingOut ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.signOutText,
                { color: colors.destructive, fontFamily: fonts.sansSemiBold },
              ]}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors, radii, fonts } = useTheme();
  return (
    <View style={styles.section}>
      <Text
        style={[
          styles.sectionTitle,
          { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
        ]}
      >
        {title.toUpperCase()}
      </Text>
      <View
        style={[
          styles.sectionBody,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: radii.lg,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function LinkRow({
  label,
  sub,
  onPress,
  colors,
  fonts,
}: {
  label: string;
  sub: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
  fonts: ReturnType<typeof useTheme>["fonts"];
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={styles.rowText}>
        <Text
          style={[
            styles.rowLabel,
            { color: colors.foreground, fontFamily: fonts.sansRegular },
          ]}
        >
          {label}
        </Text>
        <Text
          style={[
            styles.rowSub,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          {sub}
        </Text>
      </View>
      <Ionicons name="open-outline" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function Row({
  label,
  sub,
  right,
  disabled,
}: {
  label: string;
  sub?: string;
  right?: ReactNode;
  disabled?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View style={[styles.row, { opacity: disabled ? 0.6 : 1 }]}>
      <View style={styles.rowText}>
        <Text
          style={[
            styles.rowLabel,
            { color: colors.foreground, fontFamily: fonts.sansRegular },
          ]}
        >
          {label}
        </Text>
        {sub ? (
          <Text
            style={[
              styles.rowSub,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      {typeof right === "string" ? (
        <Text
          style={[
            styles.rowRight,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
          numberOfLines={1}
        >
          {right}
        </Text>
      ) : (
        right ?? null
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16, paddingVertical: 16, gap: 24, paddingBottom: 32 },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: 0.8,
    paddingHorizontal: 4,
  },
  sectionBody: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15 },
  rowSub: { fontSize: 12 },
  rowRight: { fontSize: 14, maxWidth: "55%" },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  signOut: {
    marginTop: 8,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: { fontSize: 15 },
});
