import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AgentSessionView } from "@/components/agents/AgentSessionView";
import { auth } from "@/lib/auth/server";
import { getOwnedAgentSession } from "@/lib/db/agentConnections";

export default async function AgentSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const owned = await getOwnedAgentSession(id, session.user.id);
  if (!owned) redirect("/");

  return (
    <AgentSessionView
      sessionId={id}
      workspaceName={owned.workspace.name}
      initialSessionName={
        owned.agentSession.name ??
        owned.agentSession.firstMessage ??
        ""
      }
    />
  );
}
