import { useTranslation } from "react-i18next";
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
  WebRow,
} from "@/components/settings/SettingsUI";
import { useSignInMethods } from "@/lib/queries/signInMethods";
import { useTwoFactorStatus } from "@/lib/queries/twoFactor";
import { toastSuccess } from "@/lib/toast";
export default function Security() {
  const { t } = useTranslation();
  const session = getAuthClient().useSession();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const action = useAction();
  const twoFactor = useTwoFactorStatus();
  const methods = useSignInMethods();
  useUnsavedChanges(!!(current || password || confirm));
  // An account that signs in through the identity provider has no password
  // here to change, and nothing for two-factor to guard.
  if (twoFactor.data?.passwordSignIn === false) {
    const provider =
      methods.data?.sso?.name ?? t("account.mobile.sso.defaultProvider");
    return (
      <SettingsPage title={t("account.title")}>
        <Section>
          <Row title={t("auth.fields.email")} detail={session.data?.user.email} />
        </Section>
        <Section
          title={t("account.sso.title")}
          description={t("account.mobile.sso.description")}
        >
          <Row title={t("account.mobile.sso.signedInWith")} value={provider} />
        </Section>
      </SettingsPage>
    );
  }
  return (
    <SettingsPage title={t("account.title")}>
      <Section>
        <Row title={t("auth.fields.email")} detail={session.data?.user.email} />
      </Section>
      <Section
        title={t("account.password.submit")}
        description={t("account.password.description")}
      >
        <Field
          editable={!action.busy}
          label={t("account.password.currentLabel")}
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          autoComplete="current-password"
        />
        <Field
          editable={!action.busy}
          label={t("account.password.newLabel")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          hint={t("account.mobile.password.newHint")}
        />
        <Field
          editable={!action.busy}
          label={t("account.mobile.password.confirmLabel")}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoComplete="new-password"
        />
      </Section>
      {action.error && <Label error>{action.error}</Label>}
      <Action
        title={
          action.busy
            ? t("account.password.saving")
            : t("account.password.submit")
        }
        disabled={action.busy}
        onPress={() =>
          void action.run(async () => {
            if (!current)
              throw new Error(t("account.mobile.password.errors.currentRequired"));
            if (password.length < 8 || password.length > 128)
              throw new Error(t("account.mobile.password.errors.invalidLength"));
            if (password !== confirm)
              throw new Error(t("account.mobile.password.errors.mismatch"));
            const { error } = await getAuthClient().changePassword({
              currentPassword: current,
              newPassword: password,
              revokeOtherSessions: true,
            });
            if (error)
              throw new Error(
                error.message ?? t("account.mobile.password.errors.changeFailed"),
              );
            setCurrent("");
            setPassword("");
            setConfirm("");
            toastSuccess(t("account.password.updated"));
          })
        }
      />
      <Section title={t("account.twoFactor.title")}>
        <Row
          title={t("account.twoFactor.statusTitle")}
          value={
            twoFactor.data
              ? twoFactor.data.enabled
                ? t("account.mobile.twoFactor.on")
                : t("account.twoFactor.off")
              : "—"
          }
        />
        <WebRow
          title={t("account.mobile.twoFactor.manageTitle")}
          path="/settings/account"
          detail={t("account.mobile.twoFactor.manageDetail")}
        />
      </Section>
    </SettingsPage>
  );
}
