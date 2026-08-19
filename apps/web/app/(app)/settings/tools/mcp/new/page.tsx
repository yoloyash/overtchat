import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { McpServerEditor } from "../McpServerEditor";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/settings/tools");
  return <McpServerEditor />;
}
