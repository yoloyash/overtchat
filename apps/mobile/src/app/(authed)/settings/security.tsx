import { useState } from "react";
import { getAuthClient } from "@/lib/auth/client";
import {
  SettingsPage,
  Section,
  Row,
  Field,
  Label,
  Action,
  useAction,
  useUnsavedChanges,
} from "@/components/settings/SettingsUI";
import { toastSuccess } from "@/lib/toast";
export default function Security() {
  const session = getAuthClient().useSession();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const action = useAction();
  useUnsavedChanges(!!(current || password || confirm));
  return (
    <SettingsPage title="Security">
      <Section>
        <Row title="Email" detail={session.data?.user.email} />
      </Section>
      <Section
        title="Change password"
        description="Changing your password signs you out of all other sessions."
      >
        <Field
          editable={!action.busy}
          label="Current password"
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          autoComplete="current-password"
        />
        <Field
          editable={!action.busy}
          label="New password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          hint="Use 8–128 characters."
        />
        <Field
          editable={!action.busy}
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoComplete="new-password"
        />
      </Section>
      {action.error && <Label error>{action.error}</Label>}
      <Action
        title={action.busy ? "Saving…" : "Change password"}
        disabled={action.busy}
        onPress={() =>
          void action.run(async () => {
            if (!current) throw new Error("Enter your current password.");
            if (password.length < 8 || password.length > 128)
              throw new Error("Use 8–128 characters for your new password.");
            if (password !== confirm)
              throw new Error("The new passwords do not match.");
            const { error } = await getAuthClient().changePassword({
              currentPassword: current,
              newPassword: password,
              revokeOtherSessions: true,
            });
            if (error)
              throw new Error(error.message ?? "Couldn’t change password.");
            setCurrent("");
            setPassword("");
            setConfirm("");
            toastSuccess("Password updated");
          })
        }
      />
    </SettingsPage>
  );
}
