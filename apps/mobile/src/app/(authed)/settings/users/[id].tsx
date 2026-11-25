import { useTranslation } from "react-i18next";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useState } from "react";
import { Alert } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import type { SettingsUser } from "@overtchat/shared/admin-settings";
import { getAuthClient } from "@/lib/auth/client";
import { queryKeys } from "@/lib/queries/keys";
import { useSettingsQuery, settingsRequest } from "@/lib/queries/settings";
import { AdminGate } from "@/components/settings/AdminGate";
import {
  SettingsPage,
  Section,
  Row,
  Field,
  Choice,
  Action,
  Label,
  QueryState,
  useAction,
  useUnsavedChanges,
} from "@/components/settings/SettingsUI";
import { useSignInMethods } from "@/lib/queries/signInMethods";
import { toastSuccess } from "@/lib/toast";
export default function UserDetails() {
  return (
    <AdminGate>
      <UserScreen />
    </AdminGate>
  );
}
function UserScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSettingsQuery<{ users: SettingsUser[] }>("/users", true);
  const user = query.data?.users.find((u) => u.id === id);
  return (
    <SettingsPage
      title={
        id === "new"
          ? t("users.page.addUser")
          : (user?.name ?? t("users.mobile.detail.fallbackTitle"))
      }
    >
      {id === "new" ? (
        <CreateUser />
      ) : user ? (
        <ManageUser key={id} user={user} />
      ) : (
        <>
          <QueryState query={query} />
          {query.data && <Label>{t("users.mobile.detail.notFound")}</Label>}
        </>
      )}
    </SettingsPage>
  );
}
function CreateUser() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [created, setCreated] = useState(false);
  const action = useAction();
  const client = useQueryClient();
  const methods = useSignInMethods();
  // With passwords off, the account is found by its email at the provider.
  const provider =
    methods.data?.password === false ? methods.data.sso?.name : undefined;
  useUnsavedChanges(!created && !!(name || email || password));
  const roles = [
    { value: "user", label: t("users.roles.user") },
    { value: "admin", label: t("users.mobile.roles.administrator") },
  ] as const;
  return (
    <>
      <Section
        description={
          provider
            ? t("users.addDialog.ssoDescription", { provider })
            : t("users.mobile.create.passwordDescription")
        }
      >
        <Field
          editable={!action.busy && !created}
          label={t("users.addDialog.nameLabel")}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <Field
          editable={!action.busy && !created}
          label={t("users.addDialog.emailLabel")}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          // Another person's credentials must not autofill or save as the admin's.
          autoComplete="off"
        />
        {!provider && (
          <Field
            editable={!action.busy && !created}
            label={t("users.mobile.create.initialPasswordLabel")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="off"
          />
        )}
        <Choice
          disabled={action.busy || created}
          title={t("users.addDialog.roleLabel")}
          value={role}
          onChange={setRole}
          options={roles}
        />
      </Section>
      {action.error && <Label error>{action.error}</Label>}
      <Action
        title={
          created
            ? t("users.toast.createdTitle")
            : action.busy
              ? t("users.addDialog.creating")
              : t("users.mobile.create.submit")
        }
        disabled={action.busy || created}
        onPress={() =>
          void action.run(async () => {
            if (!name.trim() || !email.trim())
              throw new Error(
                t("users.mobile.create.errors.nameAndEmailRequired"),
              );
            if (!provider && (password.length < 8 || password.length > 128))
              throw new Error(
                t("users.mobile.create.errors.invalidPasswordLength"),
              );
            const { error } = await getAuthClient().admin.createUser({
              name: name.trim(),
              email: email.trim(),
              ...(provider ? {} : { password }),
              role,
            });
            if (error)
              throw new Error(
                error.message ?? t("users.mobile.create.errors.createFailed"),
              );
            setCreated(true);
            setPassword("");
            await client.invalidateQueries({
              queryKey: queryKeys.settings("/users"),
            });
            toastSuccess(t("users.toast.createdTitle"));
          })
        }
      />
      {created && (
        <Action
          secondary
          title={t("users.mobile.create.backToUsers")}
          onPress={() => router.back()}
        />
      )}
    </>
  );
}
function ManageUser({ user }: { user: SettingsUser }) {
  const { t } = useTranslation();
  const session = getAuthClient().useSession();
  const self = user.id === session.data?.user.id;
  const [reset, setReset] = useState(false);
  // With passwords off there is nothing to reset; accounts sign in elsewhere.
  const passwords = useSignInMethods().data?.password !== false;
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const action = useAction();
  const client = useQueryClient();
  useUnsavedChanges(!!(current || password || confirm));
  const refresh = () =>
    client.invalidateQueries({ queryKey: queryKeys.settings("/users") });
  const roles = [
    { value: "user", label: t("users.roles.user") },
    { value: "admin", label: t("users.mobile.roles.administrator") },
  ] as const;
  return (
    <>
      <Section title={t("settings.nav.groups.account")}>
        <Row
          title={user.name}
          detail={user.email}
          leading={<UserAvatar name={user.name} email={user.email} size={44} />}
        />
        <Row
          title={t("users.list.columns.created")}
          value={new Date(user.createdAt).toLocaleDateString()}
        />
        {self ? (
          <Row
            title={t("users.addDialog.roleLabel")}
            value={t("users.mobile.detail.roleSelfAdmin")}
          />
        ) : (
          <Choice
            title={t("users.addDialog.roleLabel")}
            value={user.role === "admin" ? "admin" : "user"}
            options={roles}
            disabled={action.busy}
            onChange={(role) => {
              if (role === user.role) return;
              Alert.alert(
                role === "admin"
                  ? t("users.roleDialog.grantTitle")
                  : t("users.roleDialog.removeTitle"),
                role === "admin"
                  ? t("users.mobile.roleDialog.grantMessage", {
                      email: user.email,
                    })
                  : t("users.mobile.roleDialog.removeMessage", {
                      email: user.email,
                    }),
                [
                  { text: t("users.roleDialog.cancel"), style: "cancel" },
                  {
                    text: t("users.mobile.roleDialog.confirm"),
                    onPress: () =>
                      void action.run(async () => {
                        await settingsRequest(
                          `/users/${user.id}/role`,
                          "PATCH",
                          { role },
                        );
                        await refresh();
                        toastSuccess(t("users.mobile.roleDialog.updated"));
                      }),
                  },
                ],
              );
            }}
          />
        )}
      </Section>
      {self ? (
        passwords && (
          <Label muted>{t("users.mobile.detail.selfPasswordHint")}</Label>
        )
      ) : (
        <>
          {passwords && (
            <Section>
              <Row
                title={t("users.resetPasswordDialog.title")}
                icon="key-outline"
                expanded={reset}
                onPress={() => setReset(!reset)}
              />
            </Section>
          )}
          {passwords && reset && (
            <>
              <Section
                title={t("users.resetPasswordDialog.title")}
                description={t("users.mobile.resetPassword.description")}
              >
                <Field
                  editable={!action.busy}
                  label={t("users.resetPasswordDialog.currentPasswordLabel")}
                  value={current}
                  onChangeText={setCurrent}
                  secureTextEntry
                  autoComplete="current-password"
                />
                <Field
                  editable={!action.busy}
                  label={t("users.resetPasswordDialog.replacementPasswordLabel")}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="off"
                />
                <Field
                  editable={!action.busy}
                  label={t("users.resetPasswordDialog.confirmPasswordLabel")}
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry
                  autoComplete="off"
                />
              </Section>
              <Action
                title={
                  action.busy
                    ? t("account.password.saving")
                    : t("users.mobile.resetPassword.submit")
                }
                disabled={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    if (!current)
                      throw new Error(
                        t("account.mobile.password.errors.currentRequired"),
                      );
                    if (password.length < 8 || password.length > 128)
                      throw new Error(
                        t("users.mobile.resetPassword.errors.invalidLength"),
                      );
                    if (password !== confirm)
                      throw new Error(
                        t("users.mobile.resetPassword.errors.mismatch"),
                      );
                    const { error } = await getAuthClient().$fetch(
                      "/admin/reset-user-password",
                      {
                        method: "POST",
                        body: {
                          userId: user.id,
                          currentPassword: current,
                          newPassword: password,
                        },
                      },
                    );
                    if (error)
                      throw new Error(
                        error.message ??
                          t("users.mobile.resetPassword.errors.failed"),
                      );
                    setCurrent("");
                    setPassword("");
                    setConfirm("");
                    setReset(false);
                    toastSuccess(t("users.toast.passwordResetTitle"));
                  })
                }
              />
            </>
          )}
          <Section>
            <Row
              title={t("users.mobile.deleteDialog.action")}
              icon="trash-outline"
              destructive
              disabled={action.busy || !!(current || password || confirm)}
              onPress={() =>
                Alert.alert(
                  t("users.deleteDialog.title"),
                  t("users.mobile.deleteDialog.message", { email: user.email }),
                  [
                    { text: t("users.deleteDialog.cancel"), style: "cancel" },
                    {
                      text: t("users.deleteDialog.delete"),
                      style: "destructive",
                      onPress: () =>
                        void action.run(async () => {
                          const { error } =
                            await getAuthClient().admin.removeUser({
                              userId: user.id,
                            });
                          if (error)
                            throw new Error(
                              error.message ??
                                t("users.mobile.deleteDialog.failed"),
                            );
                          await refresh();
                          router.back();
                          toastSuccess(t("users.toast.deletedTitle"));
                        }),
                    },
                  ],
                )
              }
            />
          </Section>
        </>
      )}
      {action.error && <Label error>{action.error}</Label>}
    </>
  );
}
