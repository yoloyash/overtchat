import { useState } from "react";
import { View } from "react-native";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { getAuthClient } from "@/lib/auth/client";
import {
  SettingsPage,
  Section,
  Field,
  Action,
  Label,
  useAction,
  useUnsavedChanges,
} from "@/components/settings/SettingsUI";
import { toastSuccess } from "@/lib/toast";
export default function Profile() {
  const session = getAuthClient().useSession();
  return (
    <SettingsPage title="Profile">
      {session.data && (
        <ProfileForm
          initialName={session.data.user.name}
          initialImage={session.data.user.image ?? ""}
          refresh={session.refetch}
        />
      )}
    </SettingsPage>
  );
}
function ProfileForm({
  initialName,
  initialImage,
  refresh,
}: {
  initialName: string;
  initialImage: string;
  refresh: () => unknown;
}) {
  const [name, setName] = useState(initialName);
  const [image, setImage] = useState(initialImage);
  const [saved, setSaved] = useState({
    name: initialName,
    image: initialImage,
  });
  const dirty = name !== saved.name || image !== saved.image;
  const action = useAction();
  useUnsavedChanges(dirty);
  return (
    <>
      <Section title="Identity" description="Visible to people on this server.">
        <View
          style={{ alignItems: "center", paddingTop: 20, paddingBottom: 6 }}
        >
          <UserAvatar name={name} image={image} size={72} />
        </View>
        <Field
          editable={!action.busy}
          label="Display name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          maxLength={100}
        />
        <Field
          editable={!action.busy}
          label="Avatar URL"
          value={image}
          onChangeText={setImage}
          keyboardType="url"
          hint="Optional direct link to an image."
        />
      </Section>
      {action.error && <Label error>{action.error}</Label>}
      <Action
        title={action.busy ? "Saving…" : "Save profile"}
        disabled={action.busy || !dirty}
        onPress={() =>
          void action.run(async () => {
            if (!name.trim()) throw new Error("Enter a display name.");
            if (image.trim()) {
              let valid = false;
              try {
                const url = new URL(image.trim());
                valid =
                  ["http:", "https:"].includes(url.protocol) && !!url.hostname;
              } catch {
                /* Show the field error below. */
              }
              if (!valid) throw new Error("Use an HTTP or HTTPS image URL.");
            }
            const next = { name: name.trim(), image: image.trim() };
            const { error } = await getAuthClient().updateUser({
              name: next.name,
              image: next.image || null,
            });
            if (error)
              throw new Error(error.message ?? "Couldn’t save your profile.");
            setName(next.name);
            setImage(next.image);
            setSaved(next);
            void refresh();
            toastSuccess("Profile saved");
          })
        }
      />
    </>
  );
}
