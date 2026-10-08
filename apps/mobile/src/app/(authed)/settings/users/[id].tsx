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
import { toastSuccess } from "@/lib/toast";
const roles = [
  { value: "user", label: "User" },
  { value: "admin", label: "Administrator" },
] as const;
export default function UserDetails() {
  return (
    <AdminGate>
      <UserScreen />
    </AdminGate>
  );
}
function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSettingsQuery<{ users: SettingsUser[] }>("/users", true);
  const user = query.data?.users.find((u) => u.id === id);
  return (
    <SettingsPage title={id === "new" ? "Add user" : (user?.name ?? "User")}>
      {id === "new" ? (
        <CreateUser />
      ) : user ? (
        <ManageUser key={id} user={user} />
      ) : (
        <>
          <QueryState query={query} />
          {query.data && <Label>User no longer exists.</Label>}
        </>
      )}
    </SettingsPage>
  );
}
function CreateUser() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [created, setCreated] = useState(false);
  const action = useAction();
  const client = useQueryClient();
  useUnsavedChanges(!created && !!(name || email || password));
  return (
    <>
      <Section description="Share the initial password privately. They can change it in Security settings.">
        <Field
          editable={!action.busy && !created}
          label="Name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <Field
          editable={!action.busy && !created}
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
        />
        <Field
          editable={!action.busy && !created}
          label="Initial password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
        />
        <Choice
          disabled={action.busy || created}
          title="Role"
          value={role}
          onChange={setRole}
          options={roles}
        />
      </Section>
      {action.error && <Label error>{action.error}</Label>}
      <Action
        title={
          created ? "User created" : action.busy ? "Creating…" : "Create user"
        }
        disabled={action.busy || created}
        onPress={() =>
          void action.run(async () => {
            if (!name.trim() || !email.trim())
              throw new Error("Enter a name and email address.");
            if (password.length < 8 || password.length > 128)
              throw new Error("Use an initial password of 8–128 characters.");
            const { error } = await getAuthClient().admin.createUser({
              name: name.trim(),
              email: email.trim(),
              password,
              role,
            });
            if (error)
              throw new Error(error.message ?? "Couldn’t create user.");
            setCreated(true);
            setPassword("");
            await client.invalidateQueries({
              queryKey: queryKeys.settings("/users"),
            });
            toastSuccess("User created");
          })
        }
      />
      {created && (
        <Action secondary title="Back to users" onPress={() => router.back()} />
      )}
    </>
  );
}
function ManageUser({ user }: { user: SettingsUser }) {
  const session = getAuthClient().useSession();
  const self = user.id === session.data?.user.id;
  const [reset, setReset] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const action = useAction();
  const client = useQueryClient();
  useUnsavedChanges(!!(current || password || confirm));
  const refresh = () =>
    client.invalidateQueries({ queryKey: queryKeys.settings("/users") });
  return (
    <>
      <Section title="Account">
        <Row
          title={user.name}
          detail={user.email}
          leading={<UserAvatar name={user.name} email={user.email} size={44} />}
        />
        <Row
          title="Created"
          value={new Date(user.createdAt).toLocaleDateString()}
        />
        {self ? (
          <Row title="Role" value="Administrator · You" />
        ) : (
          <Choice
            title="Role"
            value={user.role === "admin" ? "admin" : "user"}
            options={roles}
            disabled={action.busy}
            onChange={(role) => {
              if (role === user.role) return;
              Alert.alert(
                role === "admin"
                  ? "Grant administrator access?"
                  : "Remove administrator access?",
                role === "admin"
                  ? `${user.email} will be able to manage this server, users, and coding agents. They will be signed out on all devices.`
                  : `${user.email} will lose administrator features, their active agent runs will stop, and they will be signed out on all devices.`,
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Change role",
                    onPress: () =>
                      void action.run(async () => {
                        await settingsRequest(
                          `/users/${user.id}/role`,
                          "PATCH",
                          { role },
                        );
                        await refresh();
                        toastSuccess("Role updated");
                      }),
                  },
                ],
              );
            }}
          />
        )}
      </Section>
      {self ? (
        <Label muted>Change your own password in Security settings.</Label>
      ) : (
        <>
          <Section>
            <Row
              title="Reset password"
              icon="key-outline"
              expanded={reset}
              onPress={() => setReset(!reset)}
            />
          </Section>
          {reset && (
            <>
              <Section
                title="Reset password"
                description="This signs the user out on all devices. Share the replacement password privately."
              >
                <Field
                  editable={!action.busy}
                  label="Your current password"
                  value={current}
                  onChangeText={setCurrent}
                  secureTextEntry
                  autoComplete="current-password"
                />
                <Field
                  editable={!action.busy}
                  label="Replacement password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="new-password"
                />
                <Field
                  editable={!action.busy}
                  label="Confirm replacement password"
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry
                  autoComplete="new-password"
                />
              </Section>
              <Action
                title={action.busy ? "Saving…" : "Reset user password"}
                disabled={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    if (!current)
                      throw new Error("Enter your current password.");
                    if (password.length < 8 || password.length > 128)
                      throw new Error("Use a password of 8–128 characters.");
                    if (password !== confirm)
                      throw new Error("Replacement passwords do not match.");
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
                        error.message ?? "Couldn’t reset password.",
                      );
                    setCurrent("");
                    setPassword("");
                    setConfirm("");
                    setReset(false);
                    toastSuccess("Password reset");
                  })
                }
              />
            </>
          )}
          <Section>
            <Row
              title="Delete user"
              icon="trash-outline"
              destructive
              disabled={action.busy || !!(current || password || confirm)}
              onPress={() =>
                Alert.alert(
                  "Delete user?",
                  `${user.email} will no longer be able to sign in. Existing chats and projects are not deleted.`,
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () =>
                        void action.run(async () => {
                          const { error } =
                            await getAuthClient().admin.removeUser({
                              userId: user.id,
                            });
                          if (error)
                            throw new Error(
                              error.message ?? "Couldn’t delete user.",
                            );
                          await refresh();
                          router.back();
                          toastSuccess("User deleted");
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
