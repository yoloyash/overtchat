import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { listModelConfigs } from "@/lib/db/modelConfigs";
import type { AdminModelConfig } from "@/lib/config";
import { ModelsPanel } from "./ModelsPanel";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/settings/general");

  const rows = await listModelConfigs();
  const initial: AdminModelConfig[] = rows.map((row) => ({
    id: row.id,
    label: row.label,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: row.model,
    extraBody: row.extraBody,
    sortOrder: row.sortOrder,
  }));

  return <ModelsPanel initial={initial} />;
}
