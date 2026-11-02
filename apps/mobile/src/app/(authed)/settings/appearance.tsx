import {
  SettingsPage,
  Section,
  Choice,
} from "@/components/settings/SettingsUI";
import { useThemePref, setThemePref } from "@/lib/appearance";
import { useFontPref, setFontPref } from "@/lib/fontPref";
import { FONT_OPTIONS } from "@/lib/fonts";
import { AccentPicker } from "@/components/ui/AccentPicker";
import { View } from "react-native";
export default function Appearance() {
  const theme = useThemePref();
  const font = useFontPref();
  return (
    <SettingsPage title="Appearance">
      <Section title="Display" description="Saved on this device.">
        <Choice
          title="Theme"
          value={theme}
          onChange={setThemePref}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
        <Choice
          title="Interface font"
          value={font}
          onChange={setFontPref}
          options={FONT_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
        />
      </Section>
      <Section title="Accent color">
        <View style={{ padding: 14 }}>
          <AccentPicker />
        </View>
      </Section>
    </SettingsPage>
  );
}
