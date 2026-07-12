import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
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
import { FONT_OPTIONS, FONT_SANS } from "@/lib/fonts";
import { setFontPref, useFontPref } from "@/lib/fontPref";
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
  const fontPref = useFontPref();
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
      await session.refetch();
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
          <Section title="Account" description="Signed in on this device.">
            <Row label="Name" right={user?.name ?? "—"} />
            <Row label="Email" right={user?.email ?? "—"} />
          </Section>

          <Section
            title="Appearance"
            description="Choose how overtchat looks and reads."
          >
            <GroupHeader
              label="Theme"
              sub="Use a fixed theme or follow the system setting."
            />
            {(
              [
                { key: "system", label: "System" },
                { key: "light", label: "Light" },
                { key: "dark", label: "Dark" },
              ] as { key: ThemePref; label: string }[]
            ).map((opt) => (
              <RadioRow
                key={opt.key}
                label={opt.label}
                selected={themePref === opt.key}
                onPress={() => setThemePref(opt.key)}
              />
            ))}

            <Divider />
            <GroupHeader
              label="Chat font"
              sub="Choose the font used throughout the app."
            />
            {FONT_OPTIONS.map((opt) => (
              <RadioRow
                key={opt.id}
                label={opt.label}
                selected={fontPref === opt.id}
                labelFont={FONT_SANS[opt.id].sansRegular}
                onPress={() => setFontPref(opt.id)}
              />
            ))}
          </Section>

          <Section
            title="Manage on web"
            description="Open server settings in your browser."
          >
            <LinkRow
              label="Account"
              sub="Name, email, password, and sessions."
              onPress={() => openOnWeb("/settings/account")}
              colors={colors}
              fonts={fonts}
            />
            <LinkRow
              label="Data"
              sub="Export data and delete chats."
              onPress={() => openOnWeb("/settings/data")}
              colors={colors}
              fonts={fonts}
            />
            {isAdmin ? (
              <>
                <LinkRow
                  label="Models"
                  sub="Provider config and model access."
                  onPress={() => openOnWeb("/settings/models")}
                  colors={colors}
                  fonts={fonts}
                />
                <LinkRow
                  label="Users"
                  sub="Invite and manage members."
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
                  Opens {serverHost} in your browser.
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

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text
          style={[
            styles.sectionTitle,
            { color: colors.foreground, fontFamily: fonts.sansSemiBold },
          ]}
        >
          {title}
        </Text>
        {description ? (
          <Text
            style={[
              styles.sectionDescription,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
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

function GroupHeader({ label, sub }: { label: string; sub: string }) {
  const { colors, fonts } = useTheme();
  return (
    <View style={[styles.row, styles.groupHeaderRow]}>
      <View style={styles.rowText}>
        <Text
          style={[
            styles.rowLabel,
            { color: colors.foreground, fontFamily: fonts.sansMedium },
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
    </View>
  );
}

function RadioRow({
  label,
  selected,
  labelFont,
  onPress,
}: {
  label: string;
  selected: boolean;
  labelFont?: string;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Text
        style={[
          styles.rowLabel,
          {
            color: colors.foreground,
            fontFamily: labelFont ?? fonts.sansRegular,
          },
        ]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.radio,
          {
            borderColor: selected ? colors.primary : colors.border,
          },
        ]}
      >
        {selected ? (
          <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />
        ) : null}
      </View>
    </Pressable>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
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
  section: { gap: 10 },
  sectionHeader: { gap: 2, paddingHorizontal: 4 },
  sectionTitle: {
    fontSize: 15,
  },
  sectionDescription: {
    fontSize: 12,
    lineHeight: 18,
  },
  sectionBody: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  groupHeaderRow: { paddingBottom: 6 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15 },
  rowSub: { fontSize: 12, lineHeight: 17 },
  rowRight: { fontSize: 14, maxWidth: "55%" },
  divider: { height: StyleSheet.hairlineWidth },
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
