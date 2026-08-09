import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AgentSessionView } from "@/components/agents/AgentSessionView";
import { auth } from "@/lib/auth/server";
import { getOwnedAgentSession } from "@/lib/db/agentConnections";
import { isAgentProviderId } from "@/lib/agents/catalog";

export default async function AgentSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/");
  const owned = await getOwnedAgentSession(id, session.user.id);
  if (!owned) redirect("/");
  if (!isAgentProviderId(owned.connection.provider)) redirect("/");

  return (
    <AgentSessionView
      sessionId={id}
      provider={owned.connection.provider}
      workspaceId={owned.workspace.id}
      workspaceName={owned.workspace.name}
      workspacePath={owned.workspace.path}
      initialSessionName={
        owned.agentSession.name ??
        owned.agentSession.firstMessage ??
        ""
      }
    />
  );
}
