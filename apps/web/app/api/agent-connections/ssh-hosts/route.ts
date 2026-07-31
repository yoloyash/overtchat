import { auth } from "@/lib/auth/server";
import { listConfiguredSshHosts } from "@/lib/agents/runtime/sshConfig";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  return Response.json({ hosts: await listConfiguredSshHosts() });
}
