import { auth } from "@/lib/auth/server";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  return new Response("Voice tools run on the server. Reload to update your client.", { status: 410 });
}
