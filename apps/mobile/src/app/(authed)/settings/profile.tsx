import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const session = getAuthClient().useSession();
  return (
    <SettingsPage title={t("profile.title")}>
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
  const { t } = useTranslation();
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
      <Section
        title={t("profile.identity.title")}
        description={t("profile.mobile.identityDescription")}
      >
        <View
          style={{ alignItems: "center", paddingTop: 20, paddingBottom: 6 }}
        >
          <UserAvatar name={name} image={image} size={72} />
        </View>
        <Field
          editable={!action.busy}
          label={t("profile.displayName.title")}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          maxLength={100}
        />
        <Field
          editable={!action.busy}
          label={t("profile.avatarUrl.title")}
          value={image}
          onChangeText={setImage}
          keyboardType="url"
          hint={t("profile.mobile.avatarUrlHint")}
        />
      </Section>
      {action.error && <Label error>{action.error}</Label>}
      <Action
        title={action.busy ? t("profile.saving") : t("profile.save")}
        disabled={action.busy || !dirty}
        onPress={() =>
          void action.run(async () => {
            if (!name.trim()) throw new Error(t("profile.mobile.errors.nameRequired"));
            if (image.trim()) {
              let valid = false;
              try {
                const url = new URL(image.trim());
                valid =
                  ["http:", "https:"].includes(url.protocol) && !!url.hostname;
              } catch {
                /* Show the field error below. */
              }
              if (!valid)
                throw new Error(t("profile.mobile.errors.invalidAvatarUrl"));
            }
            const next = { name: name.trim(), image: image.trim() };
            const { error } = await getAuthClient().updateUser({
              name: next.name,
              image: next.image || null,
            });
            if (error)
              throw new Error(
                error.message ?? t("profile.mobile.errors.saveFailed"),
              );
            setName(next.name);
            setImage(next.image);
            setSaved(next);
            void refresh();
            toastSuccess(t("profile.mobile.saved"));
          })
        }
      />
    </>
  );
}
