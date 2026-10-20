import { auth } from "@/lib/auth/server";

// Old browser-owned histories cannot safely mix with server-owned generations.
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  return new Response("Voice history is saved automatically. Reload to update your client.", { status: 410 });
}
