import Constants from "expo-constants";
import {
  SettingsPage,
  Section,
  Row,
  QueryState,
} from "@/components/settings/SettingsUI";
import { useSettingsQuery } from "@/lib/queries/settings";
export default function About() {
  const query = useSettingsQuery<{ version: string; apiLevel: number }>(
    "/ping",
  );
  return (
    <SettingsPage title="About">
      <Section title="OvertChat">
        <Row
          title="App version"
          value={Constants.expoConfig?.version ?? "Unknown"}
        />
        <Row
          title="Build"
          value={String(
            Constants.expoConfig?.android?.versionCode ??
              Constants.expoConfig?.ios?.buildNumber ??
              "Development",
          )}
        />
        <QueryState query={query} />
        {query.data && (
          <Row title="Server version" value={query.data.version} />
        )}
      </Section>
    </SettingsPage>
  );
}
