import { auth } from "@/lib/auth/server";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const result = await auth.api.listUsers({
    query: { limit: 100, sortBy: "createdAt", sortDirection: "desc" },
    headers: req.headers,
  });
  return Response.json({ users: result.users ?? [] });
}
