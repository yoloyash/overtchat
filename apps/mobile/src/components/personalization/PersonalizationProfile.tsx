import {
  ABOUT_MAX_LENGTH,
  OCCUPATION_MAX_LENGTH,
  PREFERRED_NAME_MAX_LENGTH,
  type Personalization,
} from "@overtchat/shared";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useUpdatePersonalization } from "@/lib/queries/personalization";
import { useTheme } from "@/lib/theme";
import { toastSuccess } from "@/lib/toast";
import {
  PersonalizationDivider,
  PersonalizationSection,
} from "./PersonalizationSection";

export function PersonalizationProfile({
  personalization,
}: {
  personalization: Personalization;
}) {
  const { colors, radii, fonts } = useTheme();
  const updatePersonalization = useUpdatePersonalization();
  const [enabled, setEnabled] = useState(personalization.enabled);
  const [preferredName, setPreferredName] = useState(
    personalization.preferredName ?? "",
  );
  const [occupation, setOccupation] = useState(
    personalization.occupation ?? "",
  );
  const [about, setAbout] = useState(personalization.about ?? "");
  const [error, setError] = useState("");

  const changed =
    enabled !== personalization.enabled ||
    preferredName.trim() !== (personalization.preferredName ?? "") ||
    occupation.trim() !== (personalization.occupation ?? "") ||
    about.trim() !== (personalization.about ?? "");

  async function save() {
    setError("");
    try {
      await updatePersonalization.mutateAsync({
        enabled,
        preferredName,
        occupation,
        about,
      });
      toastSuccess("Personalization saved");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't save personalization.",
      );
    }
  }

  return (
    <PersonalizationSection
      title="About you"
      description="Empty fields are not added to model context."
    >
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text
            style={[
              styles.rowLabel,
              { color: colors.foreground, fontFamily: fonts.sansRegular },
            ]}
          >
            Use personalization
          </Text>
          <Text
            style={[
              styles.rowSub,
              {
                color: colors.mutedForeground,
                fontFamily: fonts.sansRegular,
              },
            ]}
          >
            Include your profile and memories in chats, and allow models to
            manage memory when asked. Temporary chats never use it.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Use personalization"
          value={enabled}
          onValueChange={(next) => {
            setEnabled(next);
            setError("");
          }}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={colors.background}
        />
      </View>
      <PersonalizationDivider />
      <ProfileField
        label="Preferred name"
        description="What should OvertChat call you?"
        value={preferredName}
        onChangeText={(next) => {
          setPreferredName(next);
          setError("");
        }}
        maxLength={PREFERRED_NAME_MAX_LENGTH}
        placeholder="Optional"
      />
      <PersonalizationDivider />
      <ProfileField
        label="Occupation"
        value={occupation}
        onChangeText={(next) => {
          setOccupation(next);
          setError("");
        }}
        maxLength={OCCUPATION_MAX_LENGTH}
        placeholder="Optional"
      />
      <PersonalizationDivider />
      <ProfileField
        label="More about you"
        description="Interests, values, or preferences to keep in mind."
        value={about}
        onChangeText={(next) => {
          setAbout(next);
          setError("");
        }}
        maxLength={ABOUT_MAX_LENGTH}
        placeholder="Optional"
        multiline
      />
      {error ? (
        <>
          <PersonalizationDivider />
          <Text
            accessibilityRole="alert"
            style={[
              styles.inlineError,
              { color: colors.destructive, fontFamily: fonts.sansRegular },
            ]}
          >
            {error}
          </Text>
        </>
      ) : null}
      <PersonalizationDivider />
      <View style={styles.actionsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save personalization"
          disabled={!changed || updatePersonalization.isPending}
          onPress={() => void save()}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: colors.primary,
              borderRadius: radii.md,
              opacity:
                !changed || updatePersonalization.isPending
                  ? 0.4
                  : pressed
                    ? 0.85
                    : 1,
            },
          ]}
        >
          {updatePersonalization.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <Text
              style={[
                styles.buttonText,
                {
                  color: colors.primaryForeground,
                  fontFamily: fonts.sansSemiBold,
                },
              ]}
            >
              Save
            </Text>
          )}
        </Pressable>
      </View>
    </PersonalizationSection>
  );
}

function ProfileField({
  label,
  description,
  value,
  onChangeText,
  maxLength,
  placeholder,
  multiline = false,
}: {
  label: string;
  description?: string;
  value: string;
  onChangeText: (value: string) => void;
  maxLength: number;
  placeholder: string;
  multiline?: boolean;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <View style={styles.fieldRow}>
      <View style={styles.fieldHeader}>
        <Text
          style={[
            styles.rowLabel,
            { color: colors.foreground, fontFamily: fonts.sansRegular },
          ]}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={[
              styles.rowSub,
              {
                color: colors.mutedForeground,
                fontFamily: fonts.sansRegular,
              },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[
          multiline ? styles.multilineInput : styles.input,
          {
            color: colors.foreground,
            backgroundColor: colors.muted,
            borderColor: colors.border,
            borderRadius: radii.md,
            fontFamily: fonts.sansRegular,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  rowText: { flex: 1, gap: 3 },
  rowLabel: { fontSize: 15 },
  rowSub: { fontSize: 12, lineHeight: 17 },
  fieldRow: { gap: 8, paddingHorizontal: 14, paddingVertical: 13 },
  fieldHeader: { gap: 3 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multilineInput: {
    minHeight: 112,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    lineHeight: 21,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineError: { fontSize: 12, lineHeight: 17, padding: 14 },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    padding: 12,
  },
  primaryButton: {
    minWidth: 96,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  buttonText: { fontSize: 14 },
});
