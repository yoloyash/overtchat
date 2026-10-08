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
  const query = useSettingsQuery<{ users: SettingsUser[] }>("/users", true);
  useRefreshOnFocus(query.refetch);
  const [search, setSearch] = useState("");
  const users =
    query.data?.users.filter((user) =>
      `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <SettingsPage
      title="Users"
      action={{
        label: "Add user",
        icon: "add",
        onPress: () => router.push("/settings/users/new"),
      }}
    >
      <QueryState query={query} />
      {query.data && (
        <SearchField
          label="Search people"
          value={search}
          onChangeText={setSearch}
        />
      )}
      <Section
        title="People"
        description="Manage who can sign in to this server."
      >
        {users.map((user) => (
          <Row
            key={user.id}
            leading={<UserAvatar name={user.name} email={user.email} />}
            navigation
            title={user.name}
            detail={user.email}
            value={user.role === "admin" ? "Admin" : "User"}
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
            title="No matching people"
            detail="Try another name or email address."
          />
        )}
      </Section>
    </SettingsPage>
  );
}
