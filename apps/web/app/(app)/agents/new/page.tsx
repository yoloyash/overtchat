import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAgentProviderId } from "@overtchat/agent-bridge";
import { NewAgentSessionView } from "@/components/agents/NewAgentSessionView";
import { auth } from "@/lib/auth/server";
import { getOwnedAgentWorkspace } from "@/lib/db/agentConnections";

export default async function NewAgentSessionPage({
  searchParams,
}: {
  searchParams: Promise<{
    workspaceId?: string | string[];
    provider?: string | string[];
  }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/");

  const query = await searchParams;
  const workspaceId =
    typeof query.workspaceId === "string" ? query.workspaceId : "";
  const provider = typeof query.provider === "string" ? query.provider : "";
  if (!workspaceId || !isAgentProviderId(provider)) redirect("/");

  const owned = await getOwnedAgentWorkspace(workspaceId, session.user.id);
  if (!owned) redirect("/");

  return (
    <NewAgentSessionView
      provider={provider}
      workspaceId={owned.workspace.id}
      workspaceName={owned.workspace.name}
      workspacePath={owned.workspace.path}
    />
  );
}
