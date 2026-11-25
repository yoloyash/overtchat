"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth/client";
import { signInMethodsQuery, twoFactorQuery } from "@/lib/queries/auth";
import {
  SettingsActions,
  SettingsNotice,
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../SettingsRows";
import { TwoFactorSection } from "./TwoFactorSection";

type AccountFormProps = {
  email: string;
  /** Opens two-factor setup right away, as when coming from the sign-in prompt. */
  startTwoFactorSetup?: boolean;
};

export function AccountForm(props: AccountFormProps) {
  const { t } = useTranslation();
  const { data: status } = useQuery(twoFactorQuery);
  const { data: methods } = useQuery(signInMethodsQuery);
  // An account that signs in through the identity provider has no password
  // here to change, and nothing for two-factor to guard.
  if (status?.passwordSignIn === false) {
    const provider = methods?.sso?.name;
    return (
      <SettingsPage>
        <SettingsPageHeader
          title={t("account.title")}
          description={
            <Trans
              i18nKey="account.signedInAs"
              values={{ email: props.email }}
              components={{ email: <span className="text-foreground" /> }}
            />
          }
        />
        <SettingsSection
          title={t("account.sso.title")}
          description={
            provider
              ? t("account.sso.descriptionWithProvider", { provider })
              : t("account.sso.descriptionDefault")
          }
        />
      </SettingsPage>
    );
  }
  return <PasswordSecurity {...props} />;
}

function PasswordSecurity({
  email,
  startTwoFactorSetup = false,
}: AccountFormProps) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwStatus, setPwStatus] = useState<"idle" | "submitting" | "ok">(
    "idle",
  );

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwStatus("submitting");
    setPwError("");
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (error) {
      setPwStatus("idle");
      setPwError(error.message ?? t("account.password.changeFailed"));
      return;
    }
    setPwStatus("ok");
    setCurrentPassword("");
    setNewPassword("");
  }

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t("account.title")}
        description={
          <Trans
            i18nKey="account.signedInAs"
            values={{ email }}
            components={{ email: <span className="text-foreground" /> }}
          />
        }
      />

      <form onSubmit={changePassword} className="space-y-4">
        {/* Hidden username anchor so password managers associate this
            credential with the signed-in account. */}
        <input
          type="email"
          name="email"
          autoComplete="username"
          defaultValue={email}
          readOnly
          hidden
        />
        <SettingsSection
          title={t("account.password.title")}
          description={t("account.password.description")}
        >
          <SettingsRow
            title={t("account.password.currentLabel")}
            htmlFor="current"
            align="center"
            controlAlign="end"
          >
            <div className="w-full">
              <PasswordInput
                id="current"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setPwStatus("idle");
                  setPwError("");
                }}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            title={t("account.password.newLabel")}
            description={t("account.password.newDescription")}
            htmlFor="new"
            align="center"
            controlAlign="end"
          >
            <div className="w-full">
              <PasswordInput
                id="new"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setPwStatus("idle");
                  setPwError("");
                }}
              />
            </div>
          </SettingsRow>
        </SettingsSection>

        {pwError && <SettingsNotice tone="error">{pwError}</SettingsNotice>}

        <SettingsActions bordered={false}>
          {pwStatus === "ok" && (
            <SettingsNotice tone="success" className="mr-auto">
              {t("account.password.updated")}
            </SettingsNotice>
          )}
          <Button type="submit" disabled={pwStatus === "submitting"}>
            {pwStatus === "submitting"
              ? t("account.password.saving")
              : t("account.password.submit")}
          </Button>
        </SettingsActions>
      </form>

      <TwoFactorSection email={email} startSetup={startTwoFactorSetup} />
    </SettingsPage>
  );
}
