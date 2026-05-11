import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { UsersPanel, type UserRow } from "./UsersPanel";

export default async function Page() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/settings/general");

  const result = await auth.api.listUsers({
    query: { limit: 100, sortBy: "createdAt", sortDirection: "desc" },
    headers: h,
  });
  const initial = (result.users ?? []) as UserRow[];

  return <UsersPanel currentUserId={session.user.id} initial={initial} />;
}
