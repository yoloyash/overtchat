import { useTranslation } from "react-i18next";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useState } from "react";
import { router } from "expo-router";
import type { SettingsUser } from "@overtchat/shared/admin-settings";
import { AdminGate } from "@/components/settings/AdminGate";
import {
  SettingsPage,
  Section,
  Row,
  QueryState,
  SearchField,
  useRefreshOnFocus,
} from "@/components/settings/SettingsUI";
import { useSettingsQuery } from "@/lib/queries/settings";
export default function Users() {
  return (
    <AdminGate>
      <UserList />
    </AdminGate>
  );
}
function UserList() {
  const { t } = useTranslation();
  const query = useSettingsQuery<{ users: SettingsUser[] }>("/users", true);
  useRefreshOnFocus(query.refetch);
  const [search, setSearch] = useState("");
  const users =
    query.data?.users.filter((user) =>
      `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <SettingsPage
      title={t("users.page.title")}
      action={{
        label: t("users.page.addUser"),
        icon: "add",
        onPress: () => router.push("/settings/users/new"),
      }}
    >
      <QueryState query={query} />
      {query.data && (
        <SearchField
          label={t("users.mobile.list.searchLabel")}
          value={search}
          onChangeText={setSearch}
        />
      )}
      <Section
        title={t("users.list.title")}
        description={t("users.page.description")}
      >
        {users.map((user) => (
          <Row
            key={user.id}
            leading={<UserAvatar name={user.name} email={user.email} />}
            navigation
            title={user.name}
            detail={user.email}
            value={
              user.role === "admin"
                ? t("users.roles.admin")
                : t("users.roles.user")
            }
            onPress={() =>
              router.push({
                pathname: "/settings/users/[id]",
                params: { id: user.id },
              })
            }
          />
        ))}
        {query.data && !users.length && (
          <Row
            title={t("users.mobile.list.emptyTitle")}
            detail={t("users.mobile.list.emptyDetail")}
          />
        )}
      </Section>
    </SettingsPage>
  );
}
