import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getMcpServer, toMcpServer } from "@/lib/db/mcpServers";
import { McpServerEditor } from "../McpServerEditor";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/settings/tools");

  const { id } = await params;
  const row = await getMcpServer(id);
  if (!row) redirect("/settings/tools");
  return <McpServerEditor server={toMcpServer(row)} />;
}
